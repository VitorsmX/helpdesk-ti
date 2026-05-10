const crypto = require("crypto");

class AppError extends Error {
  constructor({
    code = "APP_ERROR",
    message = "Não foi possível concluir a operação.",
    status = 500,
    publicMessage,
    details,
    cause,
  } = {}) {
    super(message, { cause });
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.publicMessage = publicMessage || message;
    this.details = details;
    Error.captureStackTrace?.(this, AppError);
  }
}

function requestErrorId(prefix = "ERR") {
  return `${prefix}-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

function statusTitle(status) {
  if (status === 400) return "Solicitação inválida";
  if (status === 401) return "Login necessário";
  if (status === 403) return "Acesso não autorizado";
  if (status === 404) return "Página não encontrada";
  if (status === 429) return "Muitas tentativas";
  return "Algo não saiu como esperado";
}

function publicErrorMessage(status) {
  if (status === 403) return "Você não tem permissão para acessar ou executar esta ação.";
  if (status === 404) return "O endereço solicitado não foi encontrado.";
  if (status === 429) return "Há muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.";
  return "O sistema registrou o erro para análise. Tente novamente em instantes.";
}

function normalizeError(err, req) {
  const status = Number(err?.status || err?.statusCode || 500);
  const safeStatus = status >= 400 && status < 600 ? status : 500;
  const errorCode = err?.errorCode || err?.code || (safeStatus === 404 ? "NOT_FOUND" : "INTERNAL_ERROR");
  const reference = err?.reference || requestErrorId(safeStatus >= 500 ? "ERR" : "WARN");

  return {
    status: safeStatus,
    title: statusTitle(safeStatus),
    message: err instanceof AppError ? err.publicMessage : publicErrorMessage(safeStatus),
    errorCode,
    reference,
    requestId: req.id || req.headers?.["x-request-id"] || null,
    method: req.method,
    path: req.originalUrl || req.url,
    timestamp: new Date().toISOString(),
  };
}

module.exports = {
  AppError,
  normalizeError,
  requestErrorId,
  publicErrorMessage,
  statusTitle,
};
