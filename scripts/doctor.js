#!/usr/bin/env node
// One command that checks everything and prints a report you can paste back.
//
//     npm run doctor
//
// Secrets are never printed — the API key and SMTP password are reported only
// as "set" or "missing", so the output is safe to share.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const os = require('os');
const config = require('../src/config');
const lexware = require('../src/lexware');
const contacts = require('../src/contacts');
const articles = require('../src/articles');

const results = [];
function line(s = '') { console.log(s); }
function record(ok, label, detail) {
  results.push({ ok, label });
  line(`  ${ok ? 'OK     ' : 'PROBLEM'} ${label}`);
  if (detail) String(detail).split('\n').forEach((d) => line(`           ${d}`));
}

function section(title) {
  line();
  line('─'.repeat(64));
  line(title);
  line('─'.repeat(64));
}

// Report presence, never the value.
function present(v) { return v ? `set (${String(v).length} chars)` : 'MISSING'; }

(async () => {
  line();
  line('Garage Invoice App — setup check');
  line(`Node ${process.version} on ${os.platform()}   ${new Date().toISOString()}`);

  // ---------------------------------------------------------------- config
  section('1. Configuration');
  record(!!config.lexware.apiKey, `LEXWARE_API_KEY: ${present(config.lexware.apiKey)}`);
  record(!!config.smtp.host, `SMTP_HOST: ${config.smtp.host || 'MISSING'}`);
  record(!!config.smtp.user, `SMTP_USER: ${config.smtp.user || 'MISSING'}`);
  record(!!config.smtp.pass, `SMTP_PASS: ${present(config.smtp.pass)}`);
  record(!!config.smtp.from, `SMTP_FROM: ${config.smtp.from || 'MISSING'}`);

  // --------------------------------------------------------------- storage
  section('2. Storage (the vehicle registry)');
  line(`  DATA_DIR: ${config.dataDir}`);

  // A serverless host gives you a read-only app directory and a /tmp that is
  // wiped between invocations. The plate lookup cannot survive there.
  const serverless =
    process.env.VERCEL ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.NETLIFY ||
    process.env.K_SERVICE;
  if (serverless) {
    record(false, 'Running on a serverless host',
      'Vercel/Lambda/Netlify/Cloud Run wipe the filesystem between requests.\n' +
      'The vehicle registry cannot persist here — every car would be forgotten.\n' +
      'Use a host with a real disk, or move the registry to a hosted database.');
  }

  let writable = false;
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    const probe = path.join(config.dataDir, '.doctor-probe');
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    writable = true;
  } catch (e) {
    record(false, 'DATA_DIR is not writable', e.message);
  }
  if (writable) record(true, 'DATA_DIR is writable');

  if (writable && !serverless) {
    const looksTemp = /^\/tmp(\/|$)|^\/var\/tmp(\/|$)/.test(path.resolve(config.dataDir));
    if (looksTemp) {
      record(false, 'DATA_DIR is under /tmp',
        'Most hosts clear /tmp on restart. Point DATA_DIR at a mounted volume.');
    }
  }

  try {
    const v = JSON.parse(fs.readFileSync(config.vehicleFile, 'utf8'));
    const n = Object.keys(v.vehicles || {}).length;
    line(`  Vehicles on file: ${n}`);
  } catch {
    line('  Vehicles on file: 0 (no registry yet — normal before the first invoice)');
  }

  if (!config.lexware.apiKey) {
    section('Stopped');
    line('  Without LEXWARE_API_KEY nothing else can be checked.');
    line('  Put it in .env (copy .env.example to .env) and run this again.');
    line();
    process.exit(1);
  }

  // -------------------------------------------------------------- lexware
  section('3. Lexware connection');
  let profile = null;
  try {
    profile = await lexware.getProfile();
    record(true, 'API key works',
      `Account: ${profile.companyName || '(unnamed)'}` +
      (profile.organizationId ? `\nOrganisation: ${profile.organizationId}` : ''));
  } catch (e) {
    record(false, 'Could not reach Lexware', e.detail ? JSON.stringify(e.detail) : e.message);
    section('Stopped');
    line('  Fix the connection above before checking customers and products.');
    line();
    process.exit(1);
  }

  // ------------------------------------------------------------- customers
  section('4. Customers (who each brand bills)');
  for (const [key, company] of Object.entries(config.companies)) {
    try {
      const c = await contacts.resolveCompanyContact(key, { force: true });
      const email = contacts.billingEmailFor(key, c);

      // Pull the full record so we can say whether it's complete enough to bill.
      let gaps = [];
      try {
        const full = await lexware.getContact(c.id);
        const billing = ((full.addresses || {}).billing || [])[0] || null;
        if (!billing) gaps.push('no billing address');
        else {
          if (!billing.street) gaps.push('address has no street');
          if (!billing.city) gaps.push('address has no city');
          if (!billing.zip) gaps.push('address has no postcode');
        }
        if (!(full.company && full.company.vatRegistrationId)) gaps.push('no VAT id');
        if (!(full.roles && full.roles.customer)) gaps.push('not marked as a customer');
      } catch (e) {
        gaps.push(`could not read the full record (${e.message})`);
      }
      if (!email) gaps.push('NO EMAIL — invoices cannot be sent');

      record(gaps.length === 0, `${company.label} -> ${c.name}`,
        `email: ${email || '(none)'}` + (gaps.length ? `\nincomplete: ${gaps.join(', ')}` : ''));
    } catch (e) {
      record(false, `${company.label}`, `wanted: "${company.contactName}"\n${e.message}`);
    }
  }

  // -------------------------------------------------------------- products
  section('5. Products (the service packages)');
  let live = [];
  try {
    live = await lexware.listArticles();
    record(true, `Lexware returned ${live.length} product(s)`);
  } catch (e) {
    record(false, 'Could not list products', e.detail ? JSON.stringify(e.detail) : e.message);
  }

  if (live.length) {
    line();
    line('  Everything in your account:');
    live.forEach((a) => {
      const p = a.price || {};
      line(`    ${String(a.title || '(untitled)').padEnd(30)} ` +
           `${String((p.netPrice ?? '?') + ' EUR net').padStart(16)}  ${p.taxRate ?? '?'}% VAT`);
    });

    line();
    line('  What staff will be offered:');
    const bySlug = new Map(live.map((a) => [articles.slug(a.title), a]));
    let missing = 0;
    (config.packageAllowlist || []).forEach((title, i) => {
      const hit = bySlug.get(articles.slug(title));
      if (!hit) missing++;
      line(`    ${i + 1}. ${hit ? 'OK     ' : 'MISSING'} ${title}`);
    });
    record(missing === 0, missing === 0
      ? 'All allowlisted packages exist in Lexware'
      : `${missing} allowlisted package(s) match nothing in Lexware`,
      missing ? 'Fix the title in src/config.js or in Lexware so they match.' : null);
  }

  // ------------------------------------------------------------------ smtp
  section('6. Email sending');
  if (!config.smtp.host || !config.smtp.user || !config.smtp.pass) {
    record(false, 'SMTP is not configured', 'Invoices would be created but never emailed.');
  } else {
    try {
      const nodemailer = require('nodemailer');
      const t = nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.secure,
        auth: { user: config.smtp.user, pass: config.smtp.pass },
      });
      await t.verify();
      record(true, `SMTP accepted the login (${config.smtp.host}:${config.smtp.port})`);
    } catch (e) {
      record(false, 'SMTP rejected the connection', e.message);
    }
  }

  // --------------------------------------------------------------- summary
  const bad = results.filter((r) => !r.ok);
  section('Summary');
  line(`  ${results.length - bad.length} of ${results.length} checks passed.`);
  if (bad.length) {
    line();
    bad.forEach((b) => line(`  - ${b.label}`));
    line();
    line('  The app will not work correctly until these are fixed.');
  } else {
    line('  Everything is ready. Send one test invoice to confirm.');
  }
  line();
  line('  This report contains no passwords or keys — safe to paste.');
  line();
  process.exit(bad.length ? 2 : 0);
})().catch((e) => {
  console.error('\nThe check itself crashed:', e.message);
  process.exit(1);
});
