const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const appShell = fs.readFileSync(
  path.join(__dirname, "..", "..", "public", "app-shell.js"),
  "utf8",
);
const appCss = fs.readFileSync(
  path.join(__dirname, "..", "..", "public", "app.css"),
  "utf8",
);
const reportDatePicker = fs.readFileSync(
  path.join(__dirname, "..", "..", "public", "report-date-picker.js"),
  "utf8",
);
const reportsIndex = fs.readFileSync(
  path.join(__dirname, "..", "..", "src", "views", "reports", "index.ejs"),
  "utf8",
);
const mainLayout = fs.readFileSync(
  path.join(__dirname, "..", "..", "src", "views", "layouts", "main.ejs"),
  "utf8",
);
const adminRoutes = fs.readFileSync(
  path.join(__dirname, "..", "..", "src", "routes", "admin.routes.js"),
  "utf8",
);

test("app shell keeps regular POST forms URL-encoded for Express and CSRF", () => {
  assert.match(appShell, /function buildPostPayload/);
  assert.match(appShell, /new URLSearchParams\(body\)/);
  assert.match(appShell, /application\/x-www-form-urlencoded;charset=UTF-8/);
});

test("app shell sends CSRF token header and preserves multipart forms", () => {
  assert.match(appShell, /X-CSRF-Token/);
  assert.match(appShell, /function shouldUseMultipart/);
  assert.match(appShell, /multipart\/form-data/);
  assert.match(appShell, /input\[type="file"\]/);
});

test("app shell syncs body state so login background does not leak after AJAX navigation", () => {
  assert.match(appShell, /function syncBodyAttributes/);
  assert.match(appShell, /document\.body\.className = nextBody\.className \|\| ""/);
  assert.match(appShell, /data-/);
});

test("audit log sidebar link avoids legacy redirect during AJAX navigation", () => {
  assert.match(mainLayout, /href="\/admin\/audit"/);
  assert.doesNotMatch(mainLayout, /href="\/admin\/audit-logs"/);
  assert.match(adminRoutes, /router\.get\('\/audit-logs', requireRole\('ADMIN'\), renderAuditLogs\)/);
  assert.doesNotMatch(adminRoutes, /redirect\('\/admin\/audit'\)/);
  assert.match(appShell, /function getSameOriginResponseUrl/);
});

test("login background stays scoped and expanded sidebar does not cover desktop content", () => {
  assert.match(appCss, /body\.login-page\s*{/);
  assert.match(appCss, /body\.login-page[\s\S]*bg-login\.jpg/);
  assert.match(appCss, /body\s*{[\s\S]*background:\s*#f8fafc;/);
  assert.match(appCss, /\.sidebar:hover ~ main\.main-with-sidebar/);
  assert.match(appCss, /margin-left:\s*260px/);
});

test("report custom period uses system date picker instead of native date input", () => {
  assert.match(reportDatePicker, /function initReportDateControls/);
  assert.match(reportDatePicker, /data-date-picker/);
  assert.match(reportDatePicker, /function parseBrDate/);
  assert.match(reportsIndex, /placeholder="dd\/mm\/aaaa"/);
  assert.doesNotMatch(reportsIndex, /type="date"/);
  assert.match(appCss, /\.report-date-picker/);
});
