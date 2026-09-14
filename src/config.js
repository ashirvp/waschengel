// ---------------------------------------------------------------------------
// EDIT THIS FILE to change companies, packages, and prices.
// No other file needs to change for everyday adjustments.
//
// Each entry under `companies` becomes ONE button at the top of the app.
// Add a company  -> add a new block. Remove one -> delete its block.
// The app adjusts automatically.
// ---------------------------------------------------------------------------

const path = require('path');

module.exports = {
  // Lexware (formerly lexoffice) API
  lexware: {
    baseUrl: 'https://api.lexware.io/v1',
    apiKey: process.env.LEXWARE_API_KEY,
  },

  // Where we remember the Lexware contactId created for each company, so we
  // don't create duplicate contacts on every invoice.
  contactCacheFile: path.join(__dirname, '..', 'data', 'contacts.json'),

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
