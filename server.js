require('dotenv').config();
const express = require('express');
const path = require('path');
const config = require('./src/config');
const lexware = require('./src/lexware');
const articles = require('./src/articles');
const contacts = require('./src/contacts');
const store = require('./src/store');
const { normalizePlate, displayPlate, isPlausiblePlate } = require('./src/plates');
const { sendInvoiceEmail } = require('./src/mailer');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Lets the frontend build its form without hardcoding companies/packages twice.
// Each company sends its own package list, since every company has its own
// services and its own prices.
app.get('/api/config', async (req, res) => {
  // Packages come from your Lexware products. Every company gets the same list
  // unless it declares its own `packages` in src/config.js.
  const all = await articles.getPackages();
  const byKey = new Map(all.map((p) => [p.key, p]));

  function packagesFor(company) {
    if (!Array.isArray(company.packages) || !company.packages.length) return all;
    return company.packages.map((t) => byKey.get(articles.slug(t))).filter(Boolean);
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
          recipient: contacts.cachedRecipient(key),
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

// Plate lookup. This is the first thing the app does when a worker types a
// plate: if we've seen the car before we can fill in the rest of the form.
app.get('/api/vehicle', (req, res) => {
  const plate = req.query.plate;
  if (!isPlausiblePlate(plate)) {
    return res.json({ found: false, plate: displayPlate(plate), suggestions: [] });
  }

  const vehicle = store.findByPlate(plate);
  if (vehicle) {
    // Guard against a company that was renamed or removed in config.js since
    // this car's last visit — better to ask again than to preselect a dead key.
    const known = Boolean(config.companies[vehicle.companyKey]);
    return res.json({
      found: true,
      vehicle: { ...vehicle, companyKey: known ? vehicle.companyKey : null },
      suggestions: [],
    });
  }

  // No exact match: offer near matches so a mistyped plate doesn't silently
  // become a second record for a car we already know.
  res.json({
    found: false,
    plate: displayPlate(plate),
    suggestions: store.searchVehicles(plate).map((v) => ({
      plate: v.plate,
      customerName: v.customerName,
      companyKey: v.companyKey,
    })),
  });
});

app.get('/api/vehicles/recent', (req, res) => {
  res.json({
    vehicles: store.recentVehicles().map((v) => ({
      plate: v.plate,
      customerName: v.customerName,
      companyKey: v.companyKey,
    })),
    stats: store.stats(),
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

app.post('/api/invoice', async (req, res) => {
  const {
    company,
    customerName,
    licensePlate,
    packageKey,
    email,
    lexwareContactId,
    confirmRename,
  } = req.body || {};

  if (!company || !config.companies[company]) {
    return res.status(400).json({ error: 'Please choose a valid company.' });
  }
  if (!customerName || !customerName.trim()) {
    return res.status(400).json({ error: 'Please enter the customer name.' });
  }
  if (!isPlausiblePlate(licensePlate)) {
    return res.status(400).json({ error: 'Please enter the license plate.' });
  }
  const pkg = await articles.findPackage(packageKey);
  if (!pkg) {
    return res.status(400).json({ error: 'Please choose a valid service package.' });
  }
  // A company with its own menu must not be billed for something off it.
  const menu = config.companies[company].packages;
  if (Array.isArray(menu) && menu.length && !menu.some((t) => articles.slug(t) === pkg.key)) {
    return res.status(400).json({ error: 'That package is not available for this company.' });
  }

  const cleanName = customerName.trim();
  const plateKey = normalizePlate(licensePlate);
  const known = store.findByPlate(licensePlate);

  // This plate is already on file under a different name. That is either a typo
  // or a genuine change of owner, and only the worker can tell which — so stop
  // and ask rather than quietly overwriting the record or creating a twin.
  if (known && !confirmRename) {
    const nameChanged = known.customerName.trim().toLowerCase() !== cleanName.toLowerCase();
    const companyChanged = known.companyKey && known.companyKey !== company;
    if (nameChanged || companyChanged) {
      return res.status(409).json({
        error: 'plate_conflict',
        message: 'This plate is already on file with different details.',
        onFile: {
          plate: known.plate,
          customerName: known.customerName,
          companyKey: known.companyKey,
          companyLabel: config.companies[known.companyKey]
            ? config.companies[known.companyKey].label
            : known.companyKey,
          visits: known.visits,
        },
        submitted: { customerName: cleanName, companyKey: company },
      });
    }
  }

  const companyConfig = config.companies[company];

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
    const contactId = contact.id;

    const introduction = `${pkg.title} — ${cleanName} — Plate: ${displayPlate(licensePlate)}`;

    const created = await lexware.createInvoice({
      contactId,
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

    // Record the visit before emailing: the invoice already exists in Lexware
    // at this point, so the registry must reflect that even if the mail fails.
    let vehicle = null;
    try {
      vehicle = await store.recordVisit({
        plate: licensePlate,
        customerName: cleanName,
        companyKey: company,
        packageKey,
        voucherNumber,
        invoiceId: created.id,
        lexwareContactId: lexwareContactId || null,
      });
    } catch (e) {
      console.error('Could not record the vehicle visit:', e.message);
    }

    let emailed = false;
    let emailError = null;
    try {
      const pdfBuffer = await lexware.downloadInvoiceFile(created.id);
      await sendInvoiceEmail({
        to: recipientEmail,
        companyLabel: contact.name || companyConfig.label,
        voucherNumber,
        pdfBuffer,
      });
      emailed = true;
    } catch (e) {
      // Invoice was created successfully in Lexware even if the email fails —
      // surface that clearly instead of pretending the whole thing failed.
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
      plate: displayPlate(licensePlate),
      plateKey,
      visits: vehicle ? vehicle.visits : null,
    });
  } catch (err) {
    console.error('Invoice creation failed:', err.detail || err.message);
    res.status(502).json({
      error: 'Could not create the invoice in Lexware. Please try again or check with the office.',
      detail: err.detail || err.message,
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Garage invoice app running on http://localhost:${PORT}`);
  console.log(`Vehicle registry: ${config.vehicleFile}`);

  // Resolve the Lexware customers now, so a misspelled name shows up in the
  // startup log rather than on the first invoice of the day.
  if (config.lexware.apiKey) {
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
