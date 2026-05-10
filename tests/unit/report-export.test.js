const test = require("node:test");
const assert = require("node:assert/strict");
const { reportToCsv, reportToPdf, reportToXlsx } = require("../../src/services/reportExport.service");
const { DEFAULT_REPORT_SETTINGS } = require("../../src/services/settings.service");

const report = {
  type: "tickets",
  title: "Chamados detalhados",
  summary: [{ label: "Total", value: 1 }],
  sections: [{
    title: "Chamados detalhados",
    columns: ["ID", "Titulo", "Unidade"],
    rows: [{ ID: 1, Titulo: "Computador sem rede", Unidade: "Maria Rosa Batista" }],
  }],
};

test("CSV export contains summary and data rows", () => {
  const csv = reportToCsv(report);
  assert.match(csv, /Chamados detalhados/);
  assert.match(csv, /Computador sem rede/);
});

test("XLSX export produces a workbook buffer", async () => {
  const buffer = await reportToXlsx(report, DEFAULT_REPORT_SETTINGS, { nome: "Admin" });
  assert.ok(Buffer.from(buffer).length > 1000);
  assert.equal(Buffer.from(buffer).slice(0, 2).toString("utf8"), "PK");
});

test("PDF export produces a PDF buffer", async () => {
  const buffer = await reportToPdf(report, DEFAULT_REPORT_SETTINGS, { nome: "Admin" });
  assert.ok(buffer.length > 1000);
  assert.equal(buffer.slice(0, 4).toString("utf8"), "%PDF");
});

test("PDF export with no rows stays on one page and avoids blank trailing page", async () => {
  const emptyReport = {
    ...report,
    summary: [{ label: "Total", value: 0 }],
    sections: [{ title: "Chamados detalhados", columns: ["ID", "Titulo", "Unidade"], rows: [] }],
  };
  const buffer = await reportToPdf(emptyReport, DEFAULT_REPORT_SETTINGS, { nome: "Admin" });
  const pageCount = (buffer.toString("latin1").match(/\/Type\s*\/Page\b/g) || []).length;
  assert.equal(pageCount, 1);
});
