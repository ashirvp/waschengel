// ---------------------------------------------------------------------------
// EDIT THIS FILE to change companies, packages, and prices.
// No other file needs to change for everyday adjustments.
//
// Each entry under `companies` becomes ONE button at the top of the app.
// Add a company  -> add a new block. Remove one -> delete its block.
// The app adjusts automatically.
// ---------------------------------------------------------------------------

const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

module.exports = {
  // Lexware (formerly lexoffice) API
  lexware: {
    baseUrl: 'https://api.lexware.io/v1',
    apiKey: process.env.LEXWARE_API_KEY,
  },

  // Everything the app needs to keep between restarts lives under DATA_DIR.
  // On a host with an ephemeral filesystem, point DATA_DIR at a mounted volume
  // or the vehicle registry is lost on every deploy (see the README).
  dataDir: DATA_DIR,

  // Where we remember the Lexware contactId created for each company. This is
  // only a cache now: if it's missing, we look the contact up in Lexware by
  // name instead of blindly creating a second one.
  contactCacheFile: path.join(DATA_DIR, 'contacts.json'),

  // Plate -> customer/company/history. Lexware has no vehicle entity, so this
  // is the one piece of data the app owns itself.
  vehicleFile: path.join(DATA_DIR, 'vehicles.json'),

  // --- SERVICE PACKAGES -----------------------------------------------------
  //
  // The packages staff can pick are your PRODUCTS IN LEXWARE (Artikel). Prices
  // and descriptions are fetched from there, so changing a price in Lexware is
  // enough — no edit here, no redeploy.
  //
  // This list says WHICH of your Lexware products staff may pick, and in what
  // order. Titles are matched loosely (case, spaces and punctuation are
  // ignored), but the wording must otherwise match the article in Lexware.
  // Run `npm run articles` to print exactly what your account has.
  //
  // Empty list = show every article in your Lexware account.
  packageAllowlist: [
    'Complete Ferrari NW',
    'Complete GW',
    'Complete NW',
    'Servicewäsche Basic',
    'Servicewäsche Plus',
  ],

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
  // key          : short internal id (lowercase, no spaces). Don't reuse one.
  // label        : what staff see on the button.
  // billingEmail : every invoice for this company goes to this address.
  // contactName  : the customer name as it should appear in Lexware.
  // packages     : OPTIONAL. Omit it and the company offers packageAllowlist
  //                above (the same list for every car). Set it to a list of
  //                titles to give one company a different menu.
  //
  companies: {
    lambo_mclaren: {
      label: 'Lamborghini / McLaren',
      billingEmail: process.env.LAMBO_MCLAREN_BILLING_EMAIL || 'invoices@company-one.com',
      contactName: 'Lamborghini / McLaren Dealer',
      address: { countryCode: 'DE' },
    },

    ferrari: {
      label: 'Ferrari',
      billingEmail: process.env.FERRARI_BILLING_EMAIL || 'invoices@company-two.com',
      contactName: 'Ferrari Dealer',
      address: { countryCode: 'DE' },
    },

    bentley: {
      label: 'Bentley',
      billingEmail: process.env.BENTLEY_BILLING_EMAIL || 'invoices@company-three.com',
      contactName: 'Bentley Dealer',
      address: { countryCode: 'DE' },
    },
  },

  // Only used if an article somehow has no tax rate of its own.
  taxRatePercentage: 19,

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
