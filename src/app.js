require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const lexware = require('./lexware');
const articles = require('./articles');
const contacts = require('./contacts');
const checks = require('./checks');
const { displayPlate, isPlausiblePlate } = require('./plates');
const { sendInvoiceEmail } = require('./mailer');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Lets the frontend build its form without hardcoding companies/packages twice.
// Each company sends its own package list, since every company has its own
// services and its own prices.
app.get('/api/config', async (req, res) => {
  // Packages come from your Lexware products. Every company gets the same list
  // unless it declares its own `packages` in src/config.js.
  const all = await articles.getPackages();
  // Resolved once per process; the memo in contacts.js makes repeats free.
  const recipients = await contacts.recipients();
  const byKey = new Map(all.map((p) => [p.key, p]));

  // Each company shows only its own packages, in the order listed in config.
  function packagesFor(company) {
    return (company.packages || []).map((t) => byKey.get(articles.slug(t))).filter(Boolean);
  }

  res.json({
    companies: Object.fromEntries(
      Object.entries(config.companies).map(([key, c]) => [
        key,
        {
          label: c.label,
          // Who the invoice is actually addressed to, straight from Lexware.
          // Null until it resolves, so the UI can flag an unresolved company
          // rather than let someone invoice into the dark.
          recipient: recipients[key] || null,
          packages: packagesFor(c).map((p) => ({
            key: p.key,
            label: p.title,
            description: p.description,
            netPrice: p.netPrice,
            taxRate: p.taxRate,
          })),
        },
      ])
    ),
    taxRatePercentage: config.taxRatePercentage,
    // Lets the UI warn staff when prices are the built-in fallback rather than
    // the live ones from Lexware.
    priceSource: articles.status(),
  });
});

// Type-ahead against real Lexware contacts, for garages that already keep their
// customers in Lexware and want to reuse the spelling that's on file there.
app.get('/api/contacts', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 3) return res.json({ contacts: [] });

  try {
    const contacts = await lexware.searchContacts(q, { size: 10 });
    res.json({
      contacts: contacts.map((c) => ({
        id: c.id,
        name: lexware.contactDisplayName(c),
        email: (c.emailAddresses && (c.emailAddresses.business || [])[0]) || null,
      })),
    });
  } catch (err) {
    // Never let a failing lookup block the worker — they can always type a name.
    console.error('Contact lookup failed:', err.detail || err.message);
    res.json({ contacts: [], error: 'Lexware lookup unavailable' });
  }
});

// Setup report in a browser, so checking the configuration doesn't need a
// terminal — useful because the checks have to run where the app runs, which is
// the only place with network access to Lexware.
//
// It reveals customer names, emails and your Lexware account name, so it is
// DISABLED unless ADMIN_TOKEN is set, and the token must match.
app.get('/admin', async (req, res) => {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    return res
      .status(404)
      .type('text/plain')
      .send('Diagnostics are disabled. Set ADMIN_TOKEN in the environment to enable /admin.');
  }

  const given = String(req.query.token || '');
  // Length-independent compare is overkill here, but constant-time is free.
  const ok =
    given.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!ok) {
    return res.status(403).type('text/plain').send('Wrong or missing token.');
  }

  let report;
  try {
    report = await checks.runChecks();
  } catch (e) {
    return res.status(500).type('text/plain').send('The check itself crashed: ' + e.message);
  }

  if (req.query.format === 'text') {
    return res.type('text/plain').send(checks.toText(report));
  }
  res.type('html').send(renderAdmin(report));
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function renderAdmin(report) {
  const { summary } = report;
  const allGood = !summary.failures.length && !report.stopped;

  const body = report.sections
    .map((s) => {
      const notes = s.notes.length
        ? `<pre class="notes">${escapeHtml(s.notes.join('\n'))}</pre>`
        : '';
      const items = s.checks
        .map(
          (c) => `
        <div class="check ${c.ok ? 'ok' : 'bad'}">
          <div class="badge">${c.ok ? 'OK' : 'FIX'}</div>
          <div>
            <div class="label">${escapeHtml(c.label)}</div>
            ${c.detail ? `<pre class="detail">${escapeHtml(c.detail)}</pre>` : ''}
          </div>
        </div>`
        )
        .join('');
      return `<section><h2>${escapeHtml(s.title)}</h2>${notes}${items}</section>`;
    })
    .join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Setup check</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; background:#121316; color:#eef0f3; font-size:15px; line-height:1.45;
         font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,system-ui,sans-serif;
         padding:16px calc(16px + env(safe-area-inset-left)) 40px; }
  .wrap { max-width:760px; margin:0 auto; }
  h1 { font-size:20px; margin:0 0 4px; }
  .sub { color:#9198a3; font-size:13px; margin-bottom:16px; }
  .banner { padding:14px 16px; border-radius:12px; font-weight:600; margin-bottom:18px; }
  .banner.good { background:rgba(53,196,106,.12); border:1px solid rgba(53,196,106,.4); color:#35c46a; }
  .banner.bad  { background:rgba(239,75,82,.12); border:1px solid rgba(239,75,82,.4); color:#ef4b52; }
  section { background:#1b1d22; border:1px solid #2c2f36; border-radius:14px; padding:14px 16px; margin-bottom:14px; }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:.08em; color:#6b7180; margin:0 0 12px; }
  .check { display:flex; gap:10px; align-items:flex-start; padding:9px 0; border-top:1px solid #23262d; }
  .check:first-of-type { border-top:none; }
  .badge { flex:none; min-width:38px; text-align:center; padding:2px 6px; border-radius:6px;
           font-size:11px; font-weight:700; letter-spacing:.04em; }
  .ok .badge  { background:rgba(53,196,106,.15); color:#35c46a; }
  .bad .badge { background:rgba(239,75,82,.15); color:#ef4b52; }
  .label { font-weight:600; word-break:break-word; }
  pre { margin:5px 0 0; white-space:pre-wrap; word-break:break-word;
        font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; color:#9198a3; }
  /* The product table is column-aligned; wrapping it at phone width turns
     every row into two broken lines. Let it scroll sideways instead. */
  pre.notes { margin:0 0 10px; white-space:pre; overflow-x:auto; }
  button { width:100%; min-height:52px; margin-bottom:18px; border:none; border-radius:12px;
           background:#eef0f3; color:#121316; font-family:inherit; font-size:16px; font-weight:700; cursor:pointer; }
  .foot { color:#6b7180; font-size:12px; margin-top:18px; }
</style></head>
<body><div class="wrap">
  <h1>Setup check</h1>
  <div class="sub">${escapeHtml(report.generatedAt)}</div>
  <div class="banner ${allGood ? 'good' : 'bad'}">
    ${summary.passed} of ${summary.total} checks passed.${allGood ? ' Everything is ready — send one test invoice to confirm.' : ''}
  </div>
  <button id="copy">Copy report as text</button>
  ${report.stopped ? `<div class="banner bad">${escapeHtml(report.stopped)}</div>` : ''}
  ${body}
  <p class="foot">No passwords or keys appear in this report — it is safe to share.</p>
</div>
<script>
  document.getElementById('copy').addEventListener('click', function () {
    var btn = this;
    fetch(location.pathname + location.search + '&format=text')
      .then(function (r) { return r.text(); })
      .then(function (t) {
        // The clipboard API needs a secure context; fall back to a textarea.
        if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t);
        var ta = document.createElement('textarea');
        ta.value = t; document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); document.body.removeChild(ta);
      })
      .then(function () { btn.textContent = 'Copied — paste it into the chat'; })
      .catch(function () { btn.textContent = 'Could not copy — add &format=text to the URL'; });
  });
</script>
</body></html>`;
}

app.post('/api/invoice', async (req, res) => {
  const { company, licensePlate, packageKey, email } = req.body || {};

  if (!company || !config.companies[company]) {
    return res.status(400).json({ error: 'Please choose a valid company.' });
  }
  if (!isPlausiblePlate(licensePlate)) {
    return res.status(400).json({ error: 'Please enter the vehicle number.' });
  }

  const pkg = await articles.findPackage(packageKey);
  if (!pkg) {
    return res.status(400).json({ error: 'Please choose a valid service package.' });
  }
  // Each company has its own menu; it must not be billed for something off it.
  const menu = config.companies[company].packages || [];
  if (!menu.some((t) => articles.slug(t) === pkg.key)) {
    return res.status(400).json({ error: 'That package is not available for this company.' });
  }

  const companyConfig = config.companies[company];
  const plate = displayPlate(licensePlate);

  let contact;
  try {
    contact = await contacts.resolveCompanyContact(company);
  } catch (err) {
    // A missing or ambiguous customer is a setup problem, not a transient one.
    // Say exactly what's wrong instead of burying it in a generic failure.
    console.error('Contact resolution failed:', err.message);
    return res.status(502).json({
      error: `Could not find the Lexware customer for ${companyConfig.label}.`,
      detail: err.message,
    });
  }

  const recipientEmail = (email && email.trim()) || contacts.billingEmailFor(company, contact);
  if (!recipientEmail) {
    return res.status(502).json({
      error: `No email address for ${contact.name} in Lexware.`,
      detail:
        'Add a business email to that customer in Lexware, or set a billing email override in .env.',
    });
  }

  try {
    // The vehicle number is the only per-job detail, and this is the only place
    // it lives: on the invoice itself. Nothing is stored anywhere.
    const introduction = `${pkg.title} — Vehicle: ${plate}`;

    const created = await lexware.createInvoice({
      contactId: contact.id,
      introduction,
      lineItem: {
        name: pkg.title,
        description: pkg.description,
        netPrice: pkg.netPrice,
        taxRate: pkg.taxRate,
        unitName: pkg.unitName,
        articleId: config.linkArticlesOnInvoice ? pkg.articleId : null,
        articleType: pkg.articleType,
      },
    });

    const invoice = await lexware.getInvoice(created.id);
    const voucherNumber = invoice.voucherNumber || created.id;

    let emailed = false;
    let emailError = null;
    try {
      const pdfBuffer = await lexware.downloadInvoiceFile(created.id);
      await sendInvoiceEmail({
        to: recipientEmail,
        voucherNumber,
        plate,
        pdfBuffer,
      });
      emailed = true;
    } catch (e) {
      // The invoice exists in Lexware even if the email fails — surface that
      // clearly instead of pretending the whole thing failed.
      emailError = e.message;
      console.error('Email sending failed:', e);
    }

    res.json({
      success: true,
      voucherNumber,
      invoiceId: created.id,
      emailed,
      emailError,
      sentTo: recipientEmail,
      recipientName: contact.name,
      plate,
    });
  } catch (err) {
    console.error('Invoice creation failed:', err.detail || err.message);
    res.status(502).json({
      error: 'Could not create the invoice in Lexware. Please try again or check with the office.',
      detail: err.detail || err.message,
    });
  }
});

module.exports = app;
