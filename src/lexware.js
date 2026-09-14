// Thin wrapper around the Lexware (formerly lexoffice) public API.
// Docs: https://developers.lexware.io/docs/

const config = require('./config');

// An agent sandbox (Claude Code cloud sessions) can hold the API key outside
// the VM and have its proxy attach the Authorization header after the request
// leaves. There is then no key in the environment and we must NOT send our own
// header. Detected rather than configured: no key AND an outbound proxy.
// In a normal deployment there is no proxy, so a missing key still fails loudly.
const authViaProxy = !config.lexware.apiKey && Boolean(process.env.HTTPS_PROXY || process.env.https_proxy);

function isAuthConfigured() {
  return Boolean(config.lexware.apiKey) || authViaProxy;
}

function describeAuth() {
  if (config.lexware.apiKey) return `API key set (${String(config.lexware.apiKey).length} chars)`;
  if (authViaProxy) return 'API key attached by the sandbox proxy (not visible to this process)';
  return 'MISSING';
}

function headers(extra = {}) {
  if (!isAuthConfigured()) {
    throw new Error('LEXWARE_API_KEY is not set. Add it to your .env file.');
  }
  const h = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...extra,
  };
  // Omitted on purpose when the proxy supplies it.
  if (config.lexware.apiKey) h.Authorization = `Bearer ${config.lexware.apiKey}`;
  return h;
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

// Lexware reports validation failures as a JSON body, not a sentence. Pull the
// useful parts out of it, or the app shows "[object Object]" and nobody can
// tell which field it objected to.
function describeLexwareError(detail) {
  if (!detail) return null;
  if (typeof detail === 'string') return detail.slice(0, 500);

  const parts = [];
  if (detail.message) parts.push(String(detail.message));
  else if (detail.error) parts.push(String(detail.error));

  // 406 validation failures arrive as a list of field-level issues.
  const issues = detail.IssueList || detail.issueList || detail.issues;
  if (Array.isArray(issues)) {
    issues.forEach((i) => {
      const where = i.source || i.field || i.path;
      const what = i.type || i.i18nKey || i.code || i.message;
      if (where || what) parts.push([where, what].filter(Boolean).join(' → '));
    });
  }

  if (!parts.length) {
    try { parts.push(JSON.stringify(detail).slice(0, 500)); } catch { /* ignore */ }
  }
  return parts.join(' | ') || null;
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
    const described = describeLexwareError(detail);
    const err = new Error(
      `Lexware API ${res.status} ${res.statusText} on ${pathname}` +
        (described ? ` — ${described}` : '')
    );
    err.status = res.status;
    err.detail = detail;
    // Always a string, so it can go straight onto a screen.
    err.describe = described || `${res.status} ${res.statusText}`;
    // The whole body in the server log, for anything the summary misses.
    console.error(`Lexware ${res.status} on ${pathname}:`, JSON.stringify(detail));
    throw err;
  }
  return res;
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

// Creates a contact. Only used by the opt-in escape hatch in contacts.js —
// normal operation looks up customers you already have in Lexware.
async function createContact({ name, email, countryCode = 'DE' }) {
  const body = {
    version: 0,
    roles: { customer: {} },
    company: { name },
    addresses: { billing: [{ countryCode }] },
  };
  if (email) body.emailAddresses = { business: [email] };

  const res = await lexFetch('/contacts', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  return res.json();
}

// The account behind the API key. Used by `npm run doctor` to prove the key
// works and to show WHICH Lexware account it belongs to.
async function getProfile() {
  const res = await lexFetch('/profile', { method: 'GET', headers: headers() });
  return res.json();
}

// One contact in full, for checking a customer record is complete enough to
// invoice (address, VAT id, email).
async function getContact(contactId) {
  const res = await lexFetch(`/contacts/${contactId}`, { method: 'GET', headers: headers() });
  return res.json();
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

  const now = new Date().toISOString();

  const body = {
    voucherDate: now,
    address: { contactId },
    lineItems: [line],
    totalPrice: { currency: 'EUR' },
    taxConditions: { taxType: 'net' },
    // Required by Lexware, and it is also the Leistungsdatum on the printed
    // invoice: the day the wash was actually done, which is today.
    // If your account rejects "service", set LEXWARE_SHIPPING_TYPE (other
    // values Lexware documents are: delivery, serviceperiod, deliveryperiod,
    // none) rather than editing this file.
    shippingConditions: {
      shippingDate: now,
      shippingType: config.shippingType,
    },
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
  describeLexwareError,
  isAuthConfigured,
  describeAuth,
  getProfile,
  getContact,
  listArticles,
  searchContacts,
  createContact,
  contactDisplayName,
  createInvoice,
  getInvoice,
  downloadInvoiceFile,
};
