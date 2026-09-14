// Thin wrapper around the Lexware (formerly lexoffice) public API.
// Docs: https://developers.lexware.io/docs/

const fs = require('fs');
const config = require('./config');

function headers(extra = {}) {
  if (!config.lexware.apiKey) {
    throw new Error('LEXWARE_API_KEY is not set. Add it to your .env file.');
  }
  return {
    Authorization: `Bearer ${config.lexware.apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...extra,
  };
}

// Lexware allows roughly 2 requests/second per API key. One invoice now costs
// several calls (contact search, create, read back, PDF), so requests are put
// through a queue that spaces them out instead of hoping we stay under the cap.
const MIN_REQUEST_GAP_MS = 550;
let requestChain = Promise.resolve();
let lastRequestAt = 0;

function scheduleRequest(run) {
  const result = requestChain.then(async () => {
    const wait = Math.max(0, lastRequestAt + MIN_REQUEST_GAP_MS - Date.now());
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
    return run();
  });
  // Keep the chain alive even when this call rejects, or one failure would
  // permanently wedge every later request behind it.
  requestChain = result.catch(() => {});
  return result;
}

async function lexFetch(pathname, options = {}, attempt = 0) {
  const res = await scheduleRequest(() =>
    fetch(`${config.lexware.baseUrl}${pathname}`, options)
  );

  // 429 means we were still too quick; back off and try once more before
  // telling the worker the invoice failed.
  if (res.status === 429 && attempt < 2) {
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    return lexFetch(pathname, options, attempt + 1);
  }

  if (!res.ok) {
    let detail;
    try {
      detail = await res.json();
    } catch {
      detail = await res.text();
    }
    const err = new Error(`Lexware API ${res.status} ${res.statusText} on ${pathname}`);
    err.status = res.status;
    err.detail = detail;
    throw err;
  }
  return res;
}

// --- Contact cache (so we create each company's contact only once) -------

function readContactCache() {
  try {
    return JSON.parse(fs.readFileSync(config.contactCacheFile, 'utf8'));
  } catch {
    return {};
  }
}

function writeContactCache(cache) {
  fs.mkdirSync(require('path').dirname(config.contactCacheFile), { recursive: true });
  fs.writeFileSync(config.contactCacheFile, JSON.stringify(cache, null, 2));
}

// Searches Lexware contacts. The `name` filter is a substring match and needs
// at least 3 characters, so shorter queries are not worth a round trip.
async function searchContacts(query, { page = 0, size = 25 } = {}) {
  const term = String(query || '').trim();
  if (term.length < 3) return [];

  const params = new URLSearchParams({ name: term, page: String(page), size: String(size) });
  const res = await lexFetch(`/contacts?${params.toString()}`, {
    method: 'GET',
    headers: headers(),
  });
  const data = await res.json();
  return Array.isArray(data.content) ? data.content : [];
}

function contactDisplayName(contact) {
  if (!contact) return '';
  if (contact.company && contact.company.name) return contact.company.name;
  if (contact.person) {
    return [contact.person.firstName, contact.person.lastName].filter(Boolean).join(' ');
  }
  return '';
}

// Finds (via cache, then via the Lexware API) or creates the Lexware contact
// for a given company key and returns its contactId.
//
// The local cache used to be the ONLY guard against duplicates, which meant a
// host that wipes the disk on redeploy silently created a second "Ferrari
// Dealer" on the next invoice. Now the cache is just a shortcut: when it's
// empty we ask Lexware whether the contact already exists before creating one.
async function getOrCreateCompanyContact(companyKey) {
  const cache = readContactCache();
  if (cache[companyKey]) {
    return cache[companyKey];
  }

  const company = config.companies[companyKey];
  if (!company) throw new Error(`Unknown company "${companyKey}"`);

  const wantedName = company.contactName || company.label;

  // Ask Lexware first. A name collision here is what we want: it means the
  // contact survived a redeploy even though our cache file did not.
  try {
    const matches = await searchContacts(wantedName);
    const exact = matches.find(
      (c) => contactDisplayName(c).trim().toLowerCase() === wantedName.trim().toLowerCase()
    );
    if (exact) {
      cache[companyKey] = exact.id;
      writeContactCache(cache);
      return exact.id;
    }
  } catch (e) {
    // A failed search must not block invoicing. Worst case we fall through and
    // create the contact, which is the old behaviour.
    console.error('Contact search failed, falling back to create:', e.message);
  }

  const body = {
    version: 0,
    roles: { customer: {} },
    company: { name: wantedName },
    emailAddresses: {
      business: [company.billingEmail],
    },
    addresses: {
      billing: [
        {
          countryCode: company.address.countryCode,
        },
      ],
    },
  };

  const res = await lexFetch('/contacts', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  const data = await res.json();

  cache[companyKey] = data.id;
  writeContactCache(cache);
  return data.id;
}

// Lists the products/services ("Artikel") from Lexware. These are the service
// packages staff pick from, so prices live in Lexware and not in this repo.
async function listArticles({ maxPages = 10, size = 100 } = {}) {
  const all = [];
  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({ page: String(page), size: String(size) });
    const res = await lexFetch(`/articles?${params.toString()}`, {
      method: 'GET',
      headers: headers(),
    });
    const data = await res.json();
    const content = Array.isArray(data.content) ? data.content : [];
    all.push(...content);
    // `last` is the API's own end-of-pages flag; the length check is a belt-and
    // -braces guard so a missing flag can't spin us through all maxPages.
    if (data.last === true || content.length < size) break;
  }
  return all;
}

// Creates a finalized invoice referencing the given contact, with a single
// line item for the chosen service package. Returns { id, voucherNumber }.
async function createInvoice({ contactId, introduction, lineItem }) {
  // Default to a free-text ("custom") line, which always works. Linking the
  // Lexware article id is opt-in via LEXWARE_LINK_ARTICLES because the exact
  // payload can't be verified without sending a real invoice.
  const line = {
    type: 'custom',
    name: lineItem.name,
    quantity: 1,
    unitName: lineItem.unitName || 'Stück',
    unitPrice: {
      currency: 'EUR',
      netAmount: lineItem.netPrice,
      taxRatePercentage:
        typeof lineItem.taxRate === 'number' ? lineItem.taxRate : config.taxRatePercentage,
    },
  };
  if (lineItem.description) line.description = lineItem.description;
  if (lineItem.articleId) {
    line.id = lineItem.articleId;
    line.type = lineItem.articleType === 'PRODUCT' ? 'material' : 'service';
  }

  const body = {
    voucherDate: new Date().toISOString(),
    address: { contactId },
    lineItems: [line],
    totalPrice: { currency: 'EUR' },
    taxConditions: { taxType: 'net' },
    introduction,
  };

  const res = await lexFetch('/invoices?finalize=true', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return data; // { id, resourceUri, ... }
}

// Retrieves the full invoice (to read its voucherNumber) after creation.
async function getInvoice(invoiceId) {
  const res = await lexFetch(`/invoices/${invoiceId}`, {
    method: 'GET',
    headers: headers(),
  });
  return res.json();
}

// Downloads the invoice PDF as a Buffer.
async function downloadInvoiceFile(invoiceId) {
  const res = await lexFetch(`/invoices/${invoiceId}/file`, {
    method: 'GET',
    headers: headers({ Accept: 'application/pdf' }),
  });
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

module.exports = {
  getOrCreateCompanyContact,
  listArticles,
  searchContacts,
  contactDisplayName,
  createInvoice,
  getInvoice,
  downloadInvoiceFile,
};
