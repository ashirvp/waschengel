// Normal hosts (Fly.io, Render, a VPS, your laptop) start the app here.
// Serverless hosts import src/app.js instead — see api/index.js.

require('dotenv').config();
const app = require('./src/app');
const config = require('./src/config');
const contacts = require('./src/contacts');

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log(`Garage invoice app running on http://localhost:${PORT}`);

  // Resolve the Lexware customers now, so a misspelled name shows up in the
  // startup log rather than on the first job of the day.
  if (require('./src/lexware').isAuthConfigured()) {
    const resolved = await contacts.warmAll();
    Object.entries(resolved).forEach(([key, r]) => {
      const label = config.companies[key].label;
      console.log(
        r.error
          ? `  ${label}: NOT RESOLVED — ${r.error}`
          : `  ${label} -> ${r.name}${r.email ? ' <' + r.email + '>' : ' (no email on file)'}`
      );
    });
  } else {
    console.log('  LEXWARE_API_KEY is not set; customers will resolve on first use.');
  }
});
