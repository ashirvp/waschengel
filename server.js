require('dotenv').config();
const express = require('express');
const path = require('path');
const config = require('./src/config');
const lexware = require('./src/lexware');
const { sendInvoiceEmail } = require('./src/mailer');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Lets the frontend build its form without hardcoding companies/packages twice.
// Each company sends its own package list, since Ferrari and Lamborghini
// have different services/prices.
app.get('/api/config', (req, res) => {
  res.json({
    companies: Object.fromEntries(
      Object.entries(config.companies).map(([key, c]) => [
        key,
        {
          label: c.label,
          packages: c.packages.map((p) => ({ key: p.key, label: p.label, netPrice: p.netPrice })),
        },
      ])
    ),
  });
});

app.post('/api/invoice', async (req, res) => {
  const { company, customerName, licensePlate, packageKey, email } = req.body || {};

  if (!company || !config.companies[company]) {
    return res.status(400).json({ error: 'Please choose a valid company.' });
  }
  if (!customerName || !customerName.trim()) {
    return res.status(400).json({ error: 'Please enter the customer name.' });
  }
  if (!licensePlate || !licensePlate.trim()) {
    return res.status(400).json({ error: 'Please enter the license plate.' });
  }
  const pkg = config.companies[company].packages.find((p) => p.key === packageKey);
  if (!pkg) {
    return res.status(400).json({ error: 'Please choose a valid service package for this company.' });
  }

  const companyConfig = config.companies[company];
  const recipientEmail = (email && email.trim()) || companyConfig.billingEmail;

  try {
    const contactId = await lexware.getOrCreateCompanyContact(company);

    const introduction = `${pkg.label} — ${customerName.trim()} — Plate: ${licensePlate.trim()}`;

    const created = await lexware.createInvoice({
      contactId,
      introduction,
      lineItem: { name: pkg.label, netPrice: pkg.netPrice },
    });

    const invoice = await lexware.getInvoice(created.id);
    const voucherNumber = invoice.voucherNumber || created.id;

    let emailed = false;
    let emailError = null;
    try {
      const pdfBuffer = await lexware.downloadInvoiceFile(created.id);
      await sendInvoiceEmail({
        to: recipientEmail,
        companyLabel: companyConfig.label,
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
app.listen(PORT, () => {
  console.log(`Garage invoice app running on http://localhost:${PORT}`);
});
