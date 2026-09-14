// Resolves each company you invoice to a REAL customer record in Lexware, and
// uses that record's own data (name, email) on the invoice.
//
// These are existing customers with addresses, VAT ids and payment terms
// already set up in Lexware. So the app looks them up by name and refuses to
// invoice if it can't find exactly one — creating a bare stand-in contact
// would produce an invoice with no address and a duplicate in your books,
// which is far worse than a clear error on screen.

const fs = require('fs');
const path = require('path');
const config = require('./config');
const lexware = require('./lexware');

function normalizeName(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Lexware groups addresses by kind; take the first business-ish one we find.
function extractEmail(contact) {
  const e = (contact && contact.emailAddresses) || {};
  const first = (arr) => (Array.isArray(arr) && arr.length ? String(arr[0]).trim() : null);
  return first(e.business) || first(e.office) || first(e.billing) || first(e.other) || first(e.private) || null;
}

// --- cache -----------------------------------------------------------------
// Purely a shortcut. Everything in it can be rebuilt from Lexware, so a lost
// cache file costs one extra API call, never a duplicate contact.

let memo = null;

function readCache() {
  if (memo) return memo;
  try {
    const raw = JSON.parse(fs.readFileSync(config.contactCacheFile, 'utf8'));
    // Older versions stored a bare id string per company; upgrade in place.
    memo = {};
    Object.entries(raw).forEach(([k, v]) => {
      memo[k] = typeof v === 'string' ? { id: v, name: null, email: null } : v;
    });
  } catch {
    memo = {};
  }
  return memo;
}

let cacheWriteWarned = false;

function writeCache() {
  try {
    fs.mkdirSync(path.dirname(config.contactCacheFile), { recursive: true });
    fs.writeFileSync(config.contactCacheFile, JSON.stringify(readCache(), null, 2));
  } catch (e) {
    // Read-only filesystems (Vercel, Lambda) can't keep this. It's only a
    // cache, so carry on — but say so once rather than on every resolve.
    if (!cacheWriteWarned) {
      cacheWriteWarned = true;
      console.warn(`Contact cache is not writable (${e.message}). Continuing without it.`);
    }
  }
}

class ContactError extends Error {
  constructor(message, { companyKey, wantedName, candidates = [] } = {}) {
    super(message);
    this.name = 'ContactError';
    this.companyKey = companyKey;
    this.wantedName = wantedName;
    this.candidates = candidates;
  }
}

// Returns { id, name, email } for the Lexware customer a company bills to.
async function resolveCompanyContact(companyKey, { force = false } = {}) {
  const company = config.companies[companyKey];
  if (!company) throw new ContactError(`Unknown company "${companyKey}"`, { companyKey });

  const wanted = company.contactName;
  if (!wanted) {
    throw new ContactError(
      `No contactName set for "${companyKey}" in src/config.js.`,
      { companyKey }
    );
  }

  const cache = readCache();
  const hit = cache[companyKey];
  // Only trust the cache if it was stored for the name we currently want —
  // otherwise renaming a company in config.js would keep billing the old one.
  if (!force && hit && hit.id && normalizeName(hit.name) === normalizeName(wanted)) {
    return hit;
  }

  const matches = await lexware.searchContacts(wanted, { size: 50 });
  const exact = matches.filter(
    (c) => normalizeName(lexware.contactDisplayName(c)) === normalizeName(wanted)
  );

  if (exact.length > 1) {
    // Two customers with the same name: we must not guess which one gets billed.
    throw new ContactError(
      `Lexware has ${exact.length} customers named "${wanted}". ` +
        'Rename or archive the duplicate so only one remains.',
      { companyKey, wantedName: wanted, candidates: exact.map((c) => c.id) }
    );
  }

  if (exact.length === 1) {
    const c = exact[0];
    const entry = { id: c.id, name: lexware.contactDisplayName(c), email: extractEmail(c) };
    cache[companyKey] = entry;
    writeCache();
    return entry;
  }

  // Nothing matched exactly. Show the near misses, because the usual cause is a
  // small spelling difference between config.js and Lexware.
  const near = matches.map((c) => lexware.contactDisplayName(c)).filter(Boolean).slice(0, 5);

  if (!config.allowContactCreation) {
    throw new ContactError(
      `No customer named "${wanted}" found in Lexware.` +
        (near.length ? ` Did you mean: ${near.join(', ')}?` : '') +
        ' Add the customer in Lexware, or correct contactName in src/config.js.',
      { companyKey, wantedName: wanted, candidates: near }
    );
  }

  // Opt-in escape hatch, off by default. Creates a minimal contact so a brand
  // new setup can invoice before the customer record is filled in properly.
  const res = await lexware.createContact({
    name: wanted,
    email: company.billingEmailOverride,
    countryCode: (company.address && company.address.countryCode) || 'DE',
  });
  const entry = { id: res.id, name: wanted, email: company.billingEmailOverride || null };
  cache[companyKey] = entry;
  writeCache();
  return entry;
}

// Where this company's invoice email goes. The customer record in Lexware is
// the default; the env override exists for sending to a shared AP inbox that
// isn't the contact's own address.
function billingEmailFor(companyKey, contact) {
  const company = config.companies[companyKey] || {};
  return company.billingEmailOverride || (contact && contact.email) || null;
}

// Resolve everything once at startup so the first invoice of the day isn't the
// thing that discovers a misspelled customer name.
async function warmAll() {
  const out = {};
  for (const key of Object.keys(config.companies)) {
    try {
      out[key] = await resolveCompanyContact(key);
    } catch (e) {
      out[key] = { error: e.message };
      console.error(`Company "${key}": ${e.message}`);
    }
  }
  return out;
}

// Who each company bills, for the UI. Resolves if it has to — on a serverless
// host the cache file never persists, so a cache-only view would show every
// company as "not found" even when they all resolve perfectly.
// Never throws: an unresolvable company comes back as null and is flagged
// on screen rather than breaking the page.
async function recipients() {
  const out = {};
  for (const key of Object.keys(config.companies)) {
    try {
      const c = await resolveCompanyContact(key);
      out[key] = { name: c.name, email: billingEmailFor(key, c) };
    } catch {
      out[key] = null;
    }
  }
  return out;
}

module.exports = {
  resolveCompanyContact,
  billingEmailFor,
  warmAll,
  recipients,
  extractEmail,
  ContactError,
  _reset: () => { memo = null; },
};
