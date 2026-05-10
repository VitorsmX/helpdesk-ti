const nodemailer = require("nodemailer");
const { createCircuitBreaker } = require("../utils/resilience");

function smtpEnabled() {
  return String(process.env.SMTP_ENABLED || "false").toLowerCase() === "true";
}

function smtpConfigured() {
  return Boolean(
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS,
  );
}

function passwordRecoveryEnabled() {
  return smtpEnabled() && smtpConfigured();
}

function createTransport() {
  if (!passwordRecoveryEnabled()) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "false") === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function sendPasswordResetEmailUnsafe(user, resetUrl) {
  const transport = createTransport();
  if (!transport || !user.email) return false;

  await transport.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: user.email,
    subject: "Redefinição de senha - Helpdesk TI",
    text: [
      `Olá, ${user.nome}.`,
      "",
      "Recebemos uma solicitação para redefinir sua senha no Helpdesk TI.",
      "Use o link abaixo. Ele expira em 30 minutos e só pode ser usado uma vez:",
      "",
      resetUrl,
      "",
      "Se você não solicitou essa alteração, ignore esta mensagem e avise a equipe de TI.",
    ].join("\n"),
  });
  return true;
}

const sendPasswordResetEmail = createCircuitBreaker(
  "smtp-password-reset",
  sendPasswordResetEmailUnsafe,
  {
    failureThreshold: 3,
    resetAfterMs: Number(process.env.SMTP_CIRCUIT_RESET_MS || 60000),
    timeoutMs: Number(process.env.SMTP_TIMEOUT_MS || 15000),
  },
);

module.exports = {
  smtpEnabled,
  smtpConfigured,
  passwordRecoveryEnabled,
  sendPasswordResetEmail,
};
