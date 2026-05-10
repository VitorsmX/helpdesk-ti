const crypto = require("crypto");
const { sendPasswordResetEmail, passwordRecoveryEnabled } = require("./mail.service");
const { logger } = require("../utils/logger");

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function buildBaseUrl(req) {
  return (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
}

async function createPasswordResetToken(prisma, user, req) {
  if (!passwordRecoveryEnabled()) {
    logger.warn({ userId: user.id }, "Tentativa de reset com recuperação de senha desativada");
    return { delivered: false };
  }

  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + Number(process.env.PASSWORD_RESET_TTL_MINUTES || 30) * 60 * 1000);

  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt,
      requestedIp: req.ip,
      userAgent: String(req.get("user-agent") || "").slice(0, 500),
    },
  });

  const resetUrl = `${buildBaseUrl(req)}/reset-password/${token}`;
  const delivered = await sendPasswordResetEmail(user, resetUrl);

  if (!delivered && process.env.NODE_ENV !== "production") {
    logger.info({ userId: user.id, login: user.login }, "Token de redefinição criado em ambiente de desenvolvimento");
  }

  return { delivered };
}

async function findValidPasswordReset(prisma, token) {
  const tokenHash = hashToken(token);
  const reset = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!reset || reset.usedAt || reset.expiresAt < new Date() || !reset.user?.ativo) {
    return null;
  }

  return reset;
}

module.exports = {
  hashToken,
  createPasswordResetToken,
  findValidPasswordReset,
};
