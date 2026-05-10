const crypto = require("crypto");

function attachCspNonce(req, res, next) {
  res.locals.cspNonce = crypto.randomBytes(16).toString("base64");
  next();
}

function isInternalStaff(user) {
  return Boolean(user && (user.role === "TECH" || user.role === "ADMIN"));
}

function csvCell(value) {
  const text = String(value ?? "").replace(/"/g, '""');
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe}"`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeJsonForScript(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

module.exports = { attachCspNonce, isInternalStaff, csvCell, escapeHtml, safeJsonForScript };
