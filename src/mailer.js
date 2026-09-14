const nodemailer = require('nodemailer');
const config = require('./config');

let transporter;

function getTransporter() {
  if (!transporter) {
    if (!config.smtp.host || !config.smtp.user || !config.smtp.pass) {
      throw new Error(
        'SMTP is not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASS in your .env file.'
      );
    }
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: { user: config.smtp.user, pass: config.smtp.pass },
    });
  }
  return transporter;
}

// The signature under the email, matching the letterhead on the invoice itself
// so the two look like they came from the same place.
function signature() {
  const b = config.business;
  return [
    b.name,
    b.street,
    `${b.zip} ${b.city}`,
    b.phone ? `Tel.: ${b.phone}` : null,
    b.email,
    b.web,
  ]
    .filter(Boolean)
    .join('\n');
}

// The recipients are German dealerships, and the attached invoice is a German
// document — so the mail that carries it is German too.
async function sendInvoiceEmail({ to, voucherNumber, plate, pdfBuffer }) {
  const b = config.business;

  const body = [
    'Guten Tag,',
    '',
    `anbei erhalten Sie unsere Rechnung ${voucherNumber}` +
      (plate ? ` für das Fahrzeug ${plate}.` : '.'),
    '',
    'Mit freundlichen Grüßen',
    b.name,
    '',
    '--',
    signature(),
  ].join('\n');

  await getTransporter().sendMail({
    // Show the company name next to the address, so the dealer's inbox shows
    // "Waschengel GmbH" rather than a bare mailbox address.
    from: { name: b.name, address: config.smtp.from },
    to,
    subject: `Rechnung ${voucherNumber}${plate ? ` – Fahrzeug ${plate}` : ''}`,
    text: body,
    attachments: [
      {
        filename: `Rechnung-${voucherNumber}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  });
}

module.exports = { sendInvoiceEmail };
