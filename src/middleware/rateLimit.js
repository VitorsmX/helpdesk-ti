const rateLimit = require("express-rate-limit");

function makeLimiter({ windowMs, limit, message }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message,
  });
}

const generalLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_GENERAL || 600),
  message: "Muitas requisições. Aguarde alguns minutos e tente novamente.",
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_LOGIN || 10),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: "Muitas tentativas de login. Aguarde alguns minutos.",
});

const writeLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_WRITE || 120),
  message: "Muitas operações em pouco tempo. Aguarde alguns minutos.",
});

const uploadLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_UPLOAD || 30),
  message: "Muitos uploads em pouco tempo. Aguarde alguns minutos.",
});

module.exports = { generalLimiter, authLimiter, writeLimiter, uploadLimiter };
