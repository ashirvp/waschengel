// The setup checks, in one place, returning structured results.
//
// Two things render these: `npm run doctor` (terminal) and the /admin page
// (browser). Keeping the logic here means the two can't drift apart, and it
// means the checks can run WHERE THE NETWORK IS — which for most people is the
// deployed app, not their laptop.
//
// Nothing here ever returns a secret. Keys and passwords are reported as
// "set (n chars)" so a report is safe to share.

const config = require('./config');
const lexware = require('./lexware');
const contacts = require('./contacts');
const articles = require('./articles');

function present(v) {
  return v ? `set (${String(v).length} chars)` : 'MISSING';
}

async function runChecks() {
  const sections = [];
  let stopped = null;

  const section = (title) => {
    const s = { title, checks: [], notes: [] };
    sections.push(s);
    return s;
  };
  const check = (s, ok, label, detail) => s.checks.push({ ok, label, detail: detail || null });

  // ------------------------------------------------------------- 1. config
  const cfg = section('Configuration');
  check(cfg, !!config.lexware.apiKey, `LEXWARE_API_KEY: ${present(config.lexware.apiKey)}`);
  check(cfg, !!config.smtp.host, `SMTP_HOST: ${config.smtp.host || 'MISSING'}`);
  check(cfg, !!config.smtp.user, `SMTP_USER: ${config.smtp.user || 'MISSING'}`);
  check(cfg, !!config.smtp.pass, `SMTP_PASS: ${present(config.smtp.pass)}`);
  check(cfg, !!config.smtp.from, `SMTP_FROM: ${config.smtp.from || 'MISSING'}`);

  // The app stores nothing: no database, no files, no DATA_DIR. The vehicle
  // number lives only on the invoice in Lexware, so there is no storage to
  // check and nothing to lose on a redeploy.

  if (!config.lexware.apiKey) {
    stopped = 'Without LEXWARE_API_KEY nothing else can be checked. Add it and run this again.';
    return finish(sections, stopped);
  }

  // ------------------------------------------------------------ 2. lexware
  const lx = section('Lexware connection');
  try {
    const profile = await lexware.getProfile();
    check(lx, true, 'API key works',
      `Account: ${profile.companyName || '(unnamed)'}` +
      (profile.organizationId ? `\nOrganisation: ${profile.organizationId}` : ''));
  } catch (e) {
    check(lx, false, 'Could not reach Lexware', e.detail ? JSON.stringify(e.detail) : e.message);
    stopped = 'Fix the Lexware connection before checking customers and products.';
    return finish(sections, stopped);
  }

  // ---------------------------------------------------------- 3. customers
  const cu = section('Customers (who each brand bills)');
  for (const [key, company] of Object.entries(config.companies)) {
    try {
      const c = await contacts.resolveCompanyContact(key, { force: true });
      const email = contacts.billingEmailFor(key, c);

      // Resolving by name isn't enough: an incomplete record still produces a
      // bad invoice, or one that can never be sent.
      const gaps = [];
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

      check(cu, gaps.length === 0, `${company.label} -> ${c.name}`,
        `email: ${email || '(none)'}` + (gaps.length ? `\nincomplete: ${gaps.join(', ')}` : ''));
    } catch (e) {
      check(cu, false, company.label, `wanted: "${company.contactName}"\n${e.message}`);
    }
  }

  // ----------------------------------------------------------- 4. products
  const pr = section('Products (the service packages)');
  let live = [];
  try {
    live = await lexware.listArticles();
    check(pr, true, `Lexware returned ${live.length} product(s)`);
  } catch (e) {
    check(pr, false, 'Could not list products', e.detail ? JSON.stringify(e.detail) : e.message);
  }

  if (live.length) {
    pr.notes.push('Everything in your account:');
    live.forEach((a) => {
      const p = a.price || {};
      pr.notes.push(
        `  ${String(a.title || '(untitled)').padEnd(30)} ` +
        `${String((p.netPrice ?? '?') + ' EUR net').padStart(16)}  ${p.taxRate ?? '?'}% VAT`
      );
    });

    const bySlug = new Map(live.map((a) => [articles.slug(a.title), a]));
    pr.notes.push('', 'What staff will be offered:');
    let missing = 0;
    (config.packageAllowlist || []).forEach((title, i) => {
      const hit = bySlug.get(articles.slug(title));
      if (!hit) missing++;
      pr.notes.push(`  ${i + 1}. ${hit ? 'OK     ' : 'MISSING'} ${title}`);
    });
    check(pr, missing === 0,
      missing === 0
        ? 'All allowlisted packages exist in Lexware'
        : `${missing} allowlisted package(s) match nothing in Lexware`,
      missing ? 'Fix the title in src/config.js or in Lexware so they match.' : null);
  }

  // --------------------------------------------------------------- 5. smtp
  const sm = section('Email sending');
  if (!config.smtp.host || !config.smtp.user || !config.smtp.pass) {
    check(sm, false, 'SMTP is not configured', 'Invoices would be created but never emailed.');
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
      check(sm, true, `SMTP accepted the login (${config.smtp.host}:${config.smtp.port})`);
    } catch (e) {
      check(sm, false, 'SMTP rejected the connection', e.message);
    }
  }

  return finish(sections, stopped);
}

function finish(sections, stopped) {
  const all = sections.flatMap((s) => s.checks);
  const failures = all.filter((c) => !c.ok);
  return {
    sections,
    stopped,
    summary: { total: all.length, passed: all.length - failures.length, failures },
    generatedAt: new Date().toISOString(),
  };
}

// Plain-text rendering, shared by the CLI and the "copy report" button.
function toText(report) {
  const out = [];
  out.push('Garage Invoice App — setup check');
  out.push(`Node ${process.version}   ${report.generatedAt}`);
  report.sections.forEach((s) => {
    out.push('', '─'.repeat(64), s.title, '─'.repeat(64));
    s.notes.forEach((n) => out.push(`  ${n}`));
    if (s.notes.length && s.checks.length) out.push('');
    s.checks.forEach((c) => {
      out.push(`  ${c.ok ? 'OK     ' : 'PROBLEM'} ${c.label}`);
      if (c.detail) String(c.detail).split('\n').forEach((d) => out.push(`           ${d}`));
    });
  });
  out.push('', '─'.repeat(64), 'Summary', '─'.repeat(64));
  out.push(`  ${report.summary.passed} of ${report.summary.total} checks passed.`);
  if (report.stopped) out.push('', `  ${report.stopped}`);
  if (report.summary.failures.length) {
    out.push('');
    report.summary.failures.forEach((f) => out.push(`  - ${f.label}`));
    out.push('', '  The app will not work correctly until these are fixed.');
  } else if (!report.stopped) {
    out.push('  Everything is ready. Send one test invoice to confirm.');
  }
  out.push('', '  This report contains no passwords or keys — safe to paste.', '');
  return out.join('\n');
}

module.exports = { runChecks, toText };
