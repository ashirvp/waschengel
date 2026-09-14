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

  // --- YOUR THREE CUSTOMER COMPANIES ---------------------------------------
  //
  // key          : short internal id (lowercase, no spaces). Don't reuse one.
  // label        : what staff see on the button.
  // billingEmail : every invoice for this company goes to this address.
  // contactName  : the customer name as it should appear in Lexware.
  // packages     : this company's own services and prices (net, EUR).
  //
  companies: {
    lambo_mclaren: {
      label: 'Lamborghini / McLaren',
      billingEmail: process.env.LAMBO_MCLAREN_BILLING_EMAIL || 'invoices@company-one.com',
      contactName: 'Lamborghini / McLaren Dealer',
      address: { countryCode: 'DE' },
      packages: [
        { key: 'basic_wash', label: 'Basic Wash', netPrice: 30 },
        { key: 'premium_wash', label: 'Premium Wash', netPrice: 55 },
        { key: 'interior_cleaning', label: 'Interior Cleaning', netPrice: 70 },
        { key: 'smart_repair', label: 'Smart Repair', netPrice: 180 },
        { key: 'ceramic_coating', label: 'Ceramic Coating', netPrice: 450 },
      ],
    },

    ferrari: {
      label: 'Ferrari',
      billingEmail: process.env.FERRARI_BILLING_EMAIL || 'invoices@company-two.com',
      contactName: 'Ferrari Dealer',
      address: { countryCode: 'DE' },
      packages: [
        { key: 'basic_wash', label: 'Basic Wash', netPrice: 25 },
        { key: 'premium_wash', label: 'Premium Wash', netPrice: 45 },
        { key: 'interior_cleaning', label: 'Interior Cleaning', netPrice: 60 },
        { key: 'smart_repair', label: 'Smart Repair', netPrice: 150 },
        { key: 'ceramic_coating', label: 'Ceramic Coating', netPrice: 400 },
      ],
    },

    bentley: {
      label: 'Bentley',
      billingEmail: process.env.BENTLEY_BILLING_EMAIL || 'invoices@company-three.com',
      contactName: 'Bentley Dealer',
      address: { countryCode: 'DE' },
      packages: [
        { key: 'basic_wash', label: 'Basic Wash', netPrice: 35 },
        { key: 'premium_wash', label: 'Premium Wash', netPrice: 60 },
        { key: 'interior_cleaning', label: 'Interior Cleaning', netPrice: 80 },
        { key: 'smart_repair', label: 'Smart Repair', netPrice: 200 },
        { key: 'ceramic_coating', label: 'Ceramic Coating', netPrice: 500 },
      ],
    },
  },

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
