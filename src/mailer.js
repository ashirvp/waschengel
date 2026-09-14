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

async function sendInvoiceEmail({ to, companyLabel, voucherNumber, pdfBuffer }) {
  await getTransporter().sendMail({
    from: config.smtp.from,
    to,
    subject: `Invoice ${voucherNumber} — ${companyLabel}`,
    text: `Please find attached invoice ${voucherNumber}.`,
    attachments: [
      {
        filename: `${voucherNumber}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  });
}

module.exports = { sendInvoiceEmail };
