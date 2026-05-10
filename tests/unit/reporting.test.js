const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseReportFilters,
  buildTicketWhere,
  allowedReportTypesFor,
  isResponseBreached,
  isResolutionBreached,
} = require("../../src/services/reporting.service");

test("coordinator report filters are scoped to own unit", () => {
  const user = { role: "COORDINATOR", usfId: 7 };
  const filters = parseReportFilters({ type: "tickets", usfId: "99", format: "pdf" }, user);
  const where = buildTicketWhere(user, filters);
  assert.equal(where.usfId, 7);
  assert.equal(filters.format, "pdf");
});

test("custom report period uses explicit start and end dates", () => {
  const user = { role: "ADMIN", usfId: 1 };
  const filters = parseReportFilters({
    type: "tickets",
    period: "custom",
    startDate: "2026-05-01",
    endDate: "2026-05-10",
  }, user);
  const where = buildTicketWhere(user, filters);

  assert.equal(filters.period, "custom");
  assert.equal(where.createdAt.gte.getFullYear(), 2026);
  assert.equal(where.createdAt.gte.getMonth(), 4);
  assert.equal(where.createdAt.gte.getDate(), 1);
  assert.equal(where.createdAt.lte.getFullYear(), 2026);
  assert.equal(where.createdAt.lte.getMonth(), 4);
  assert.equal(where.createdAt.lte.getDate(), 10);
  assert.equal(where.createdAt.lte.getHours(), 23);
});

test("roles expose only permitted report types", () => {
  const coordinatorTypes = allowedReportTypesFor({ role: "COORDINATOR" }).map((item) => item.value);
  const adminTypes = allowedReportTypesFor({ role: "ADMIN" }).map((item) => item.value);
  assert.equal(coordinatorTypes.includes("technicians"), false);
  assert.equal(coordinatorTypes.includes("inventory"), false);
  assert.equal(adminTypes.includes("technicians"), true);
});

test("SLA breach helpers account for pending overdue tickets", () => {
  const now = new Date("2026-05-09T12:00:00Z");
  const ticket = {
    status: "IN_PROGRESS",
    firstResponseAt: null,
    responseDueAt: new Date("2026-05-09T10:00:00Z"),
    responseBreachedAt: null,
    resolvedAt: null,
    resolutionDueAt: new Date("2026-05-09T11:00:00Z"),
    resolutionBreachedAt: null,
  };
  assert.equal(isResponseBreached(ticket, now), true);
  assert.equal(isResolutionBreached(ticket, now), true);
});
