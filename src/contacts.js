// Resolves each company you invoice to a REAL customer record in Lexware, and
// uses that record's own data (name, email) on the invoice.
//
// These are existing customers with addresses, VAT ids and payment terms
// already set up in Lexware. So the app looks them up by name and refuses to
// invoice if it can't find exactly one — creating a bare stand-in contact
// would produce an invoice with no address and a duplicate in your books,
// which is far worse than a clear error on screen.

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
// In memory for the life of the process, and nowhere else. Rebuilt from Lexware
// whenever it's empty, which costs one lookup per company per cold start. That
// keeps the app completely stateless: no disk, no database, nothing to back up
// and nothing to lose on a redeploy.

let memo = {};

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

  const hit = memo[companyKey];
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
    memo[companyKey] = entry;
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
  const entry = { id: res.id, name: wanted, email: null };
  memo[companyKey] = entry;
  return entry;
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
      out[key] = { name: c.name, email: c.email };
    } catch {
      out[key] = null;
    }
  }
  return out;
}

module.exports = {
  resolveCompanyContact,
  warmAll,
  recipients,
  extractEmail,
  ContactError,
  _reset: () => { memo = {}; },
};
