#!/usr/bin/env node
// Checks that each company in src/config.js maps to exactly one customer in
// Lexware, and shows the email its invoices will go to.
//
//     npm run contacts
//
// Run it after changing a company name here or in Lexware. A mismatch is the
// one setup error that would otherwise only surface on a real job.

require('dotenv').config();
const config = require('../src/config');
const contacts = require('../src/contacts');

(async () => {
  if (!config.lexware.apiKey) {
    console.error('LEXWARE_API_KEY is not set. Put it in .env first.');
    process.exit(1);
  }

  console.log('\nResolving each company to its Lexware customer:\n');
  let bad = 0;

  for (const [key, company] of Object.entries(config.companies)) {
    try {
      // force: skip the cache, so this always reflects Lexware right now.
      const c = await contacts.resolveCompanyContact(key, { force: true });
      const email = contacts.billingEmailFor(key, c);
      const override = company.billingEmailOverride ? '  (override from .env)' : '';
      console.log(`  OK       ${company.label}`);
      console.log(`           -> ${c.name}`);
      console.log(`           -> ${email || 'NO EMAIL ON FILE — invoices cannot be sent'}${override}`);
      if (!email) bad++;
    } catch (e) {
      bad++;
      console.log(`  PROBLEM  ${company.label}`);
      console.log(`           wanted: "${company.contactName}"`);
      console.log(`           ${e.message}`);
    }
    console.log('');
  }

  if (bad) {
    console.log(
      `${bad} compan${bad === 1 ? 'y' : 'ies'} cannot be invoiced yet.\n` +
        'Fix the customer in Lexware, or correct contactName in src/config.js.\n'
    );
    process.exitCode = 2;
  } else {
    console.log('All companies resolved. Invoices will be addressed to the customers above.\n');
  }
})();
