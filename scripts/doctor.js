#!/usr/bin/env node
// Checks the whole setup and prints a report you can paste back.
//
//     npm run doctor
//
// No secrets are printed: the API key and SMTP password appear only as
// "set (n chars)", so the output is safe to share.
//
// If you'd rather not use a terminal, the deployed app serves the same report
// at /admin?token=… — see ADMIN_TOKEN in .env.example.

require('dotenv').config();
const { runChecks, toText } = require('../src/checks');

runChecks()
  .then((report) => {
    console.log(toText(report));
    process.exit(report.summary.failures.length || report.stopped ? 2 : 0);
  })
  .catch((e) => {
    console.error('\nThe check itself crashed:', e.message);
    process.exit(1);
  });
