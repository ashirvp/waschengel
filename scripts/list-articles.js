#!/usr/bin/env node
// Prints the products (Artikel) in your Lexware account and shows which ones
// the app will offer to staff. Run it after changing prices or titles:
//
//     npm run articles
//
// Titles in src/config.js must match these — that's the one thing that breaks
// silently, so this script exists to make the mismatch obvious.

require('dotenv').config();
const config = require('../src/config');
const lexware = require('../src/lexware');
const articles = require('../src/articles');

function eur(n) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n);
}

(async () => {
  if (!config.lexware.apiKey) {
    console.error('LEXWARE_API_KEY is not set. Put it in .env first.');
    process.exit(1);
  }

  let live;
  try {
    live = await lexware.listArticles();
  } catch (e) {
    console.error('Could not reach Lexware:', e.detail || e.message);
    process.exit(1);
  }

  console.log(`\nFound ${live.length} article(s) in Lexware:\n`);
  const seen = new Map();
  live.forEach((a) => {
    const price = a.price || {};
    const key = articles.slug(a.title);
    seen.set(key, a.title);
    console.log(
      `  ${(a.title || '(no title)').padEnd(28)} ` +
        `${eur(price.netPrice || 0).padStart(11)} net   ` +
        `${String(price.taxRate ?? '?').padStart(2)}% VAT   ` +
        `[${a.type || '?'}]${a.articleNumber ? '  #' + a.articleNumber : ''}`
    );
  });

  const allow = config.packageAllowlist || [];
  if (!allow.length) {
    console.log('\npackageAllowlist is empty, so ALL of the above are offered to staff.\n');
    return;
  }

  console.log('\nWhat staff will see (from packageAllowlist in src/config.js):\n');
  let missing = 0;
  allow.forEach((title, i) => {
    const key = articles.slug(title);
    const hit = seen.has(key);
    if (!hit) missing++;
    console.log(`  ${i + 1}. ${hit ? 'OK     ' : 'MISSING'} ${title}`);
  });

  if (missing) {
    console.log(
      `\n${missing} entr${missing === 1 ? 'y' : 'ies'} did not match any Lexware article.\n` +
        'Fix the title in src/config.js (or in Lexware) so they match exactly.\n' +
        'Until then the app falls back to its built-in prices for those.\n'
    );
    process.exitCode = 2;
  } else {
    console.log('\nAll allowlisted packages were found in Lexware.\n');
  }
})();
