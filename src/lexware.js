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

async function lexFetch(pathname, options = {}) {
  const res = await fetch(`${config.lexware.baseUrl}${pathname}`, options);
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

// Finds (via cache) or creates the Lexware contact for a given company key
// ("ferrari" / "lamborghini") and returns its contactId.
async function getOrCreateCompanyContact(companyKey) {
  const cache = readContactCache();
  if (cache[companyKey]) {
    return cache[companyKey];
  }

  const company = config.companies[companyKey];
  if (!company) throw new Error(`Unknown company "${companyKey}"`);

  const body = {
    version: 0,
    roles: { customer: {} },
    company: { name: company.contactName || company.label },
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

// Creates a finalized invoice referencing the given contact, with a single
// line item for the chosen service package. Returns { id, voucherNumber }.
async function createInvoice({ contactId, introduction, lineItem }) {
  const body = {
    voucherDate: new Date().toISOString(),
    address: { contactId },
    lineItems: [
      {
        type: 'custom',
        name: lineItem.name,
        quantity: 1,
        unitName: 'Stück',
        unitPrice: {
          currency: 'EUR',
          netAmount: lineItem.netPrice,
          taxRatePercentage: config.taxRatePercentage,
        },
      },
    ],
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
  createInvoice,
  getInvoice,
  downloadInvoiceFile,
};
