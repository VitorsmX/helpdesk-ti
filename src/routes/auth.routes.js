const express = require("express");
const bcrypt = require("bcryptjs");
const { getPrisma } = require("../db");
const { requireAuth } = require("../middleware/auth");
const { authLimiter, writeLimiter } = require("../middleware/rateLimit");
const { passwordIsStrong } = require("../utils/validation");
const {
  createPasswordResetToken,
  findValidPasswordReset,
} = require("../services/passwordReset.service");
const { logger } = require("../utils/logger");
const { passwordRecoveryEnabled } = require("../services/mail.service");
const { AppError } = require("../utils/errors");

const router = express.Router();

function requirePasswordRecoveryEnabled(req, res, next) {
  if (passwordRecoveryEnabled()) return next();
  return next(new AppError({
    code: "PASSWORD_RECOVERY_DISABLED",
    status: 404,
    message: "Recuperação de senha desativada",
    publicMessage: "A recuperação de senha não está disponível neste ambiente.",
  }));
}

router.get("/login", (req, res) => {
  const attemptedLogin = req.session.loginAttempt || "";
  req.session.loginAttempt = null;
  res.render("auth/login", { title: "Login", attemptedLogin });
});

router.get("/forgot-password", requirePasswordRecoveryEnabled, (req, res) => {
  res.render("auth/forgot_password", { title: "Esqueci minha senha" });
});

router.post("/forgot-password", requirePasswordRecoveryEnabled, authLimiter, async (req, res) => {
  const prisma = getPrisma();
  const identifier = String(req.body.identifier || "").trim();

  if (identifier) {
    const user = await prisma.user.findFirst({
      where: {
        ativo: true,
        OR: [{ login: identifier }, { email: identifier }],
      },
    });

    if (user) {
      try {
        await createPasswordResetToken(prisma, user, req);
      } catch (error) {
        logger.warn({ err: error, userId: user.id }, "Falha ao criar reset de senha");
      }
    }
  }

  req.flash("success", "Se o usuário existir e tiver canal de contato configurado, enviaremos as instruções.");
  res.redirect("/forgot-password");
});

router.get("/reset-password/:token", requirePasswordRecoveryEnabled, async (req, res) => {
  const prisma = getPrisma();
  const reset = await findValidPasswordReset(prisma, req.params.token);
  if (!reset) {
    req.flash("error", "Link de redefinição inválido ou expirado.");
    return res.redirect("/forgot-password");
  }

  return res.render("auth/reset_password", {
    title: "Redefinir senha",
    token: req.params.token,
    userName: reset.user.nome,
  });
});

router.post("/reset-password/:token", requirePasswordRecoveryEnabled, authLimiter, async (req, res) => {
  const prisma = getPrisma();
  const reset = await findValidPasswordReset(prisma, req.params.token);
  if (!reset) {
    req.flash("error", "Link de redefinição inválido ou expirado.");
    return res.redirect("/forgot-password");
  }

  const password = String(req.body.password || "");
  const confirmPassword = String(req.body.confirmPassword || "");
  if (password !== confirmPassword) {
    req.flash("error", "As senhas informadas não conferem.");
    return res.redirect(`/reset-password/${req.params.token}`);
  }
  if (!passwordIsStrong(password)) {
    req.flash("error", "A senha deve ter no mínimo 8 caracteres e conter letras e números.");
    return res.redirect(`/reset-password/${req.params.token}`);
  }

  const cost = Number(process.env.BCRYPT_COST || 12);
  const passwordHash = await bcrypt.hash(password, cost);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: reset.userId },
      data: { passwordHash, passwordChangedAt: new Date() },
    }),
    prisma.passwordResetToken.update({
      where: { id: reset.id },
      data: { usedAt: new Date() },
    }),
    prisma.passwordResetToken.updateMany({
      where: { userId: reset.userId, usedAt: null },
      data: { usedAt: new Date() },
    }),
  ]);

  req.flash("success", "Senha redefinida com sucesso. Entre novamente.");
  res.redirect("/login");
});

router.post("/login", authLimiter, async (req, res) => {
  const prisma = getPrisma();
  const login = String(req.body.login || "").trim();
  const password = String(req.body.password || "");

  const user = await prisma.user.findUnique({
    where: { login },
    include: { usf: true },
  });

  if (!user || !user.ativo) {
    req.session.loginAttempt = login;
    logger.warn({ login, ip: req.ip }, "Tentativa de login sem usuário ativo correspondente");
    req.flash(
      "error",
      passwordRecoveryEnabled()
        ? "Não foi possível entrar. Confira o login e a senha. Se o problema continuar, use “Esqueci minha senha” ou fale com o suporte."
        : "Não foi possível entrar. Confira o login e a senha. Se o problema continuar, fale com o suporte.",
    );
    return res.redirect("/login");
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    req.session.loginAttempt = login;
    logger.warn({ userId: user.id, login, ip: req.ip }, "Senha incorreta no login");
    req.flash("error", "Senha não conferiu para este acesso. Verifique letras maiúsculas, minúsculas e tente novamente.");
    return res.redirect("/login");
  }

  req.session.regenerate((err) => {
    if (err) {
      logger.error({ err, userId: user.id }, "Falha ao regenerar sessão");
      req.flash("error", "Não foi possível iniciar a sessão agora. Tente novamente em instantes.");
      return res.redirect("/login");
    }

    req.session.userId = user.id;
    logger.info({ userId: user.id, role: user.role }, "Login realizado");
    req.session.save(() => res.redirect("/"));
  });
});

router.post("/logout", (req, res) => {
  if (req.user) logger.info({ userId: req.user.id }, "Logout realizado");

  const finish = () => {
    res.clearCookie(process.env.SESSION_COOKIE_NAME || "helpdesk.sid");
    res.redirect("/login");
  };

  if (!req.session) return finish();

  req.session.destroy((err) => {
    if (err) logger.warn({ err, userId: req.user?.id }, "Falha ao destruir sessão no logout");
    finish();
  });
});

router.post("/session/renew", requireAuth, writeLimiter, (req, res) => {
  req.session.touch();
  req.session.save((err) => {
    if (err) {
      return res.status(500).json({ ok: false });
    }
    return res.json({ ok: true, renewedAt: new Date().toISOString() });
  });
});

router.get("/account/password", requireAuth, (req, res) => {
  res.render("auth/change_password", { title: "Alterar senha" });
});

router.post("/account/password", requireAuth, writeLimiter, async (req, res) => {
  const prisma = getPrisma();
  const currentPassword = String(req.body.currentPassword || "");
  const newPassword = String(req.body.newPassword || "");
  const confirmPassword = String(req.body.confirmPassword || "");

  if (newPassword !== confirmPassword) {
    req.flash("error", "A nova senha e a confirmação não conferem.");
    return res.redirect("/account/password");
  }
  if (!passwordIsStrong(newPassword)) {
    req.flash("error", "A nova senha deve ter no mínimo 8 caracteres e conter letras e números.");
    return res.redirect("/account/password");
  }

  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  const ok = user ? await bcrypt.compare(currentPassword, user.passwordHash) : false;
  if (!ok) {
    req.flash("error", "Senha atual incorreta.");
    return res.redirect("/account/password");
  }

  const cost = Number(process.env.BCRYPT_COST || 12);
  const passwordHash = await bcrypt.hash(newPassword, cost);
  await prisma.user.update({
    where: { id: req.user.id },
    data: { passwordHash, passwordChangedAt: new Date() },
  });

  req.flash("success", "Senha alterada com sucesso.");
  res.redirect("/");
});

module.exports = router;
