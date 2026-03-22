const nodemailer = require('nodemailer');

function buildTransport() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;

  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    return null;
  }

  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS
    }
  });
}

async function sendSecureCodeEmail({ to, code }) {
  const transporter = buildTransport();
  if (!transporter || !to) {
    return { sent: false, reason: 'SMTP or recipient missing' };
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;

  await transporter.sendMail({
    from,
    to,
    subject: 'THE PROTECTOR - Secure Message Code',
    text: `Your one-time secure message code is: ${code}`,
    html: `<p>Your one-time secure message code is:</p><h2>${code}</h2><p>This code can be used only once.</p>`
  });

  return { sent: true };
}

module.exports = { sendSecureCodeEmail };