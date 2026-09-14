// ---------------------------------------------------------------------------
// EDIT THIS FILE to change companies, packages, and prices.
// No other file needs to change for everyday adjustments.
//
// Each entry under `companies` becomes ONE button at the top of the app.
// Add a company  -> add a new block. Remove one -> delete its block.
// The app adjusts automatically.
// ---------------------------------------------------------------------------

module.exports = {
  // Lexware (formerly lexoffice) API
  lexware: {
    baseUrl: 'https://api.lexware.io/v1',
    apiKey: process.env.LEXWARE_API_KEY,
  },

  // --- SERVICE PACKAGES -----------------------------------------------------
  //
  // The packages staff can pick are your PRODUCTS IN LEXWARE (Artikel). Prices
  // and descriptions are fetched from there, so changing a price in Lexware is
  // enough — no edit here, no redeploy.
  //
  // EACH COMPANY HAS ITS OWN LIST, below in `companies`. A product with its own
  // price per company is simply its own product in Lexware (which is why
  // "Komplett Ferrari NW" is separate from "Komplett NW"); list it under the
  // company it belongs to.
  //
  // Titles are matched loosely (case, spaces and punctuation are ignored), but
  // the wording must otherwise match the article in Lexware. Run
  // `npm run articles` to print exactly what your account has.

  // How long a fetched price list is reused before checking Lexware again.
  articleCacheMs: Number(process.env.ARTICLE_CACHE_MS || 10 * 60 * 1000),

  // Put the Lexware article id on the invoice line instead of writing it as a
  // free-text line. Better bookkeeping (revenue per product), but the exact
  // payload is not something this app can verify against your account, so it
  // is OFF by default. Turn it on, send ONE test invoice, and check it looks
  // right in Lexware before relying on it.
  linkArticlesOnInvoice: process.env.LEXWARE_LINK_ARTICLES === 'true',

  // --- YOUR CUSTOMER COMPANIES ----------------------------------------------
  //
  // Each entry is ONE button in the app, mapped to a REAL customer in Lexware.
  //
  // key          : short internal id (lowercase, no spaces). Don't reuse one.
  // label        : what staff see on the button (the car brand they're holding).
  // contactName  : the customer's name in Lexware, spelled EXACTLY as it is
  //                there. The app looks this up and bills that customer, using
  //                its address, payment terms and email from Lexware. If it
  //                doesn't match a customer, the app says so instead of
  //                inventing one — run `npm run contacts` to check.
  // packages     : OPTIONAL. Omit it and the company offers packageAllowlist
  //                above (the same list for every car). Set it to a list of
  //                titles to give one company a different menu.
  //
  companies: {
    lambo_mclaren: {
      label: 'Lamborghini / McLaren',
      contactName: 'Feser Sportwagen GmbH',
      address: { countryCode: 'DE' },
      packages: [
        'Komplett GW',
        'Komplett NW',
        'Servicewäsche Basic',
        'Servicewäsche Plus',
      ],
    },

    ferrari: {
      label: 'Ferrari',
      contactName: 'Scuderia Feser-Graf GmbH',
      address: { countryCode: 'DE' },
      packages: [
        'Komplett Ferrari NW',
        'Komplett GW',
        'Komplett NW',
        'Servicewäsche Basic',
        'Servicewäsche Plus',
      ],
    },

    bentley: {
      label: 'Bentley',
      contactName: 'Feser- Graf Exclusive Cars GmbH',
      address: { countryCode: 'DE' },
      packages: [
        'Komplett GW',
        'Komplett NW',
        'Servicewäsche Basic',
        'Servicewäsche Plus',
      ],
    },
  },

  // The app bills customers that already exist in Lexware. Leave this off: if a
  // name doesn't match, you want to be told, not to get a bare duplicate
  // contact with no address on a real invoice.
  allowContactCreation: process.env.LEXWARE_CREATE_CONTACTS === 'true',

  // Only used if an article somehow has no tax rate of its own.
  taxRatePercentage: 19,

};

// The set of Lexware products the app cares about: every title mentioned by any
// company. Derived rather than typed, so a product added to a company's list
// can't be forgotten here.
module.exports.packageAllowlist = [
  ...new Set(
    Object.values(module.exports.companies).flatMap((c) => c.packages || [])
  ),
];
