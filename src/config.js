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
  // billingEmailOverride
  //              : OPTIONAL. By default the invoice goes to the email on the
  //                Lexware customer record. Set this only to send somewhere
  //                else, e.g. a shared accounts-payable inbox.
  // packages     : OPTIONAL. Omit it and the company offers packageAllowlist
  //                above (the same list for every car). Set it to a list of
  //                titles to give one company a different menu.
  //
  companies: {
    lambo_mclaren: {
      label: 'Lamborghini / McLaren',
      contactName: 'Feser Sportwagen GmbH',
      billingEmailOverride: process.env.LAMBO_MCLAREN_BILLING_EMAIL || null,
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
      billingEmailOverride: process.env.FERRARI_BILLING_EMAIL || null,
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
      billingEmailOverride: process.env.BENTLEY_BILLING_EMAIL || null,
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

  // --- YOUR BUSINESS -------------------------------------------------------
  // Used as the sender name and the signature under the invoice email, so it
  // matches your Lexware letterhead. Public business details (the same ones on
  // your Impressum), not secrets.
  business: {
    name: process.env.BUSINESS_NAME || 'Waschengel GmbH',
    street: process.env.BUSINESS_STREET || 'Äußere Sulzbacher Straße 23',
    zip: process.env.BUSINESS_ZIP || '90491',
    city: process.env.BUSINESS_CITY || 'Nürnberg',
    phone: process.env.BUSINESS_PHONE || '09131/1239258',
    email: process.env.BUSINESS_EMAIL || 'info@waschengel.info',
    web: process.env.BUSINESS_WEB || 'www.waschengel.de',
  },

  // Outgoing email (SMTP) used to send the finished invoice PDF.
  smtp: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
  },
};

// The set of Lexware products the app cares about: every title mentioned by any
// company. Derived rather than typed, so a product added to a company's list
// can't be forgotten here.
module.exports.packageAllowlist = [
  ...new Set(
    Object.values(module.exports.companies).flatMap((c) => c.packages || [])
  ),
];
