const fs = require("fs");
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const { csvCell } = require("../utils/security");
const { getSystemAssetPath } = require("../utils/systemAssets");

const PDF_COLUMN_PRESETS = {
  tickets: {
    columns: ["ID", "Título", "Unidade", "Setor", "Sala", "Status", "Prioridade", "SLA resposta vencido"],
    weights: [0.45, 2.4, 1.25, 1, 1, 0.9, 0.85, 0.95],
  },
  "attention-units": {
    columns: ["Unidade", "Chamados no período", "Chamados ativos", "Urgentes", "SLA resposta vencido", "SLA resolução vencido", "Cumprimento SLA (%)", "Índice de atenção"],
    weights: [2, 1, 1, 0.8, 1.1, 1.1, 1.1, 1],
  },
  "sla-sectors": {
    columns: ["Unidade", "Setor", "Sala", "Chamados", "Abertos/ativos", "Urgentes", "SLA resposta vencido", "SLA no prazo (%)"],
    weights: [1.5, 1.25, 1.25, 0.7, 0.85, 0.75, 1.05, 0.9],
  },
  categories: {
    columns: ["Categoria", "Chamados", "Urgentes", "Altos", "SLA vencido", "Participação (%)", "Tempo médio resposta (h)"],
    weights: [2.2, 0.8, 0.8, 0.7, 0.9, 1, 1.2],
  },
  inventory: {
    columns: ["Registro", "Unidade", "Setor", "Sala", "Item", "Modelo", "Patrimônio", "Status"],
    weights: [0.9, 1.35, 1.1, 1.1, 1.4, 1.15, 1.05, 0.9],
  },
  technicians: {
    columns: ["Técnico", "Chamados atribuídos", "Ativos", "Resolvidos/fechados", "Urgentes", "Tempo médio resposta (h)", "Tempo médio resolução (h)"],
    weights: [2, 1, 0.8, 1.1, 0.8, 1.2, 1.2],
  },
};

function buildFileBase(report) {
  const date = new Date().toISOString().slice(0, 10);
  const slug = String(report.type || "relatorio").replace(/[^a-z0-9_-]/gi, "-").toLowerCase();
  return `helpdesk-${slug}-${date}`;
}

function asCell(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function reportToCsv(report) {
  const lines = [];
  lines.push([report.title].map(csvCell).join(","));
  lines.push("");
  for (const item of report.summary || []) {
    lines.push([item.label, item.value].map(csvCell).join(","));
  }
  lines.push("");

  for (const section of report.sections) {
    lines.push([section.title].map(csvCell).join(","));
    lines.push(section.columns.map(csvCell).join(","));
    for (const row of section.rows) {
      lines.push(section.columns.map((column) => csvCell(row[column])).join(","));
    }
    lines.push("");
  }

  return `\uFEFF${lines.join("\n")}`;
}

async function reportToXlsx(report, settings, user) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Helpdesk TI";
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.properties.date1904 = false;

  const summary = workbook.addWorksheet("Resumo", {
    views: [{ showGridLines: false }],
  });

  summary.mergeCells("A1:D1");
  summary.getCell("A1").value = `${settings.reportTitlePrefix} - ${report.title}`;
  summary.getCell("A1").font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
  summary.getCell("A1").fill = solidFill(settings.accentColor);
  summary.getCell("A1").alignment = { vertical: "middle" };
  summary.getRow(1).height = 28;
  summary.addRow([]);
  summary.addRow(["Orgao", settings.organizationName]);
  summary.addRow(["Gerado por", user?.nome || "Sistema"]);
  summary.addRow(["Gerado em", new Date().toLocaleString("pt-BR")]);
  summary.addRow([]);
  for (const item of report.summary || []) summary.addRow([item.label, item.value]);
  summary.columns = [{ width: 28 }, { width: 42 }, { width: 18 }, { width: 18 }];
  summary.eachRow((row, rowNumber) => {
    if (rowNumber >= 3) row.getCell(1).font = { bold: true };
  });

  for (const section of report.sections) {
    const sheet = workbook.addWorksheet(safeSheetName(section.title), {
      views: [{ state: "frozen", ySplit: 1 }],
      pageSetup: {
        paperSize: settings.paperSize === "LETTER" ? 1 : 9,
        orientation: settings.orientation || "landscape",
        fitToPage: true,
        fitToWidth: 1,
      },
    });

    sheet.columns = section.columns.map((column) => ({
      header: column,
      key: column,
      width: Math.min(42, Math.max(14, String(column).length + 4)),
    }));

    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = solidFill(settings.accentColor);
    sheet.getRow(1).alignment = { vertical: "middle" };

    section.rows.forEach((row) => sheet.addRow(row));
    sheet.autoFilter = {
      from: "A1",
      to: `${columnLetter(section.columns.length)}${Math.max(1, section.rows.length + 1)}`,
    };

    sheet.eachRow((row, rowNumber) => {
      row.alignment = { vertical: "top", wrapText: true };
      if (rowNumber > 1 && rowNumber % 2 === 0) {
        row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
      }
    });
  }

  return workbook.xlsx.writeBuffer();
}

function reportToPdf(report, settings, user) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({
      size: settings.paperSize || "A4",
      layout: settings.orientation || "landscape",
      margins: compactMargins(settings),
      autoFirstPage: true,
      bufferPages: true,
    });

    doc.info.Title = `${settings.reportTitlePrefix} - ${report.title}`;
    doc.info.Author = "Helpdesk TI";
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    drawHeader(doc, report, settings, user);
    drawSummary(doc, report, settings);

    for (const section of report.sections) {
      drawSection(doc, report, section, settings);
    }

    drawFooter(doc, settings);
    doc.end();
  });
}

function compactMargins(settings) {
  if (settings.layout === "compact") return { top: 24, left: 26, right: 26, bottom: 34 };
  return { top: 30, left: 32, right: 32, bottom: 38 };
}

function drawHeader(doc, report, settings, user) {
  const startY = doc.y;
  const logoPath = settings.includeLogo && settings.logoFile ? getSystemAssetPath(settings.logoFile) : null;
  let drewLogo = false;

  if (logoPath && fs.existsSync(logoPath)) {
    try {
      doc.image(logoPath, doc.page.margins.left, startY, { fit: [62, 46] });
      drewLogo = true;
    } catch (error) {
      drewLogo = false;
    }
  }

  const titleX = drewLogo ? doc.page.margins.left + 76 : doc.page.margins.left;
  const titleWidth = doc.page.width - titleX - doc.page.margins.right;

  doc.font("Helvetica-Bold")
    .fillColor(settings.accentColor || "#0d6efd")
    .fontSize(8.5)
    .text(settings.organizationName, titleX, startY, { width: titleWidth });
  doc.font("Helvetica-Bold")
    .fillColor("#111827")
    .fontSize(15)
    .text(`${settings.reportTitlePrefix} - ${report.title}`, titleX, doc.y + 3, {
      width: titleWidth,
      lineGap: 1,
    });
  doc.font("Helvetica")
    .fillColor("#6b7280")
    .fontSize(7.5)
    .text(`Gerado em ${new Date().toLocaleString("pt-BR")}${settings.includeGeneratedBy ? ` por ${user?.nome || "Sistema"}` : ""}`, titleX, doc.y + 3, {
      width: titleWidth,
    });

  doc.y = Math.max(doc.y, drewLogo ? startY + 48 : doc.y);
  doc.moveDown(0.55);
  doc.moveTo(doc.page.margins.left, doc.y)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
    .strokeColor(settings.accentColor || "#0d6efd")
    .lineWidth(0.8)
    .stroke();
  doc.moveDown(0.55);

  if (report.description) {
    doc.font("Helvetica")
      .fillColor("#4b5563")
      .fontSize(8)
      .text(report.description, { width: usableWidth(doc), lineGap: 1 });
    doc.moveDown(0.45);
  }
}

function drawSummary(doc, report, settings) {
  if (!report.summary?.length) return;
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#111827").text("Resumo executivo");
  doc.moveDown(0.28);

  const columns = doc.page.layout === "portrait" ? 2 : 3;
  const gap = 7;
  const width = (usableWidth(doc) - gap * (columns - 1)) / columns;
  const cardHeight = settings.layout === "compact" ? 27 : 31;
  let x = doc.page.margins.left;
  let y = doc.y;

  report.summary.forEach((item, index) => {
    if (index > 0 && index % columns === 0) {
      x = doc.page.margins.left;
      y += cardHeight + 6;
    }
    doc.roundedRect(x, y, width, cardHeight, 3).fillAndStroke("#f8fafc", "#e5e7eb");
    doc.font("Helvetica").fillColor("#6b7280").fontSize(6.7).text(String(item.label), x + 7, y + 5, { width: width - 14, height: 9, ellipsis: true });
    doc.font("Helvetica-Bold").fillColor(settings.accentColor || "#0d6efd").fontSize(10.5).text(String(item.value), x + 7, y + 16, { width: width - 14, height: 12, ellipsis: true });
    x += width + gap;
  });

  doc.y = y + cardHeight + 11;
}

function drawSection(doc, report, section, settings) {
  ensureSpace(doc, 72);
  doc.font("Helvetica-Bold").fillColor("#111827").fontSize(10).text(section.title);
  doc.moveDown(0.35);

  if (!section.rows.length) {
    drawEmptyState(doc, settings);
    return;
  }

  const table = buildTableLayout(doc, report, section);
  drawTableHeader(doc, table, settings);

  const maxRows = Number(process.env.PDF_MAX_ROWS || 250);
  const rows = section.rows.slice(0, maxRows);

  rows.forEach((row, rowIndex) => {
    const rowHeight = measureRowHeight(doc, table, row, settings);
    ensureSpace(doc, rowHeight + 2, () => drawTableHeader(doc, table, settings));
    drawTableRow(doc, table, row, rowHeight, rowIndex);
  });

  if (section.rows.length > maxRows) {
    doc.moveDown(0.5);
    doc.font("Helvetica").fillColor("#6b7280").fontSize(7.5).text("PDF limitado para leitura. Use XLSX para a base completa.");
  }
  doc.moveDown(0.7);
}

function drawEmptyState(doc, settings) {
  const width = usableWidth(doc);
  const y = doc.y;
  doc.roundedRect(doc.page.margins.left, y, width, 54, 5).fillAndStroke("#f8fafc", "#e5e7eb");
  doc.font("Helvetica-Bold").fillColor("#111827").fontSize(10).text("Nenhum registro encontrado para os filtros selecionados.", doc.page.margins.left + 14, y + 13, {
    width: width - 28,
  });
  doc.font("Helvetica").fillColor("#6b7280").fontSize(8).text("Altere o período ou use o modo avançado para ampliar a consulta.", doc.page.margins.left + 14, y + 31, {
    width: width - 28,
  });
  doc.y = y + 68;
}

function buildTableLayout(doc, report, section) {
  const preset = PDF_COLUMN_PRESETS[report.type] || {};
  const availableColumns = new Set(section.columns);
  const columns = (preset.columns || section.columns)
    .filter((column) => availableColumns.has(column))
    .slice(0, 9);

  const fallbackColumns = columns.length ? columns : section.columns.slice(0, 8);
  const weights = fallbackColumns.map((column, index) => {
    const presetIndex = (preset.columns || []).indexOf(column);
    return presetIndex >= 0 ? preset.weights[presetIndex] : 1 + (index === 0 ? 0.3 : 0);
  });

  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const width = usableWidth(doc);
  const colWidths = weights.map((weight) => Math.floor((weight / totalWeight) * width));
  const diff = width - colWidths.reduce((sum, value) => sum + value, 0);
  if (colWidths.length) colWidths[colWidths.length - 1] += diff;

  let x = doc.page.margins.left;
  const positions = colWidths.map((colWidth) => {
    const current = x;
    x += colWidth;
    return current;
  });

  return {
    columns: fallbackColumns,
    colWidths,
    positions,
    headerHeight: 18,
    minRowHeight: 18,
    maxRowHeight: 38,
  };
}

function drawTableHeader(doc, table, settings) {
  const y = doc.y;
  table.columns.forEach((column, index) => {
    const x = table.positions[index];
    const width = table.colWidths[index];
    doc.rect(x, y, width, table.headerHeight).fillAndStroke(settings.accentColor || "#0d6efd", settings.accentColor || "#0d6efd");
    doc.font("Helvetica-Bold").fillColor("#ffffff").fontSize(6.7).text(column, x + 4, y + 5, {
      width: width - 8,
      height: table.headerHeight - 7,
      ellipsis: true,
    });
  });
  doc.y = y + table.headerHeight;
}

function measureRowHeight(doc, table, row, settings) {
  const fontSize = settings.layout === "compact" ? 6.4 : 6.8;
  doc.font("Helvetica").fontSize(fontSize);
  const heights = table.columns.map((column, index) => {
    const text = asCell(row[column]);
    return doc.heightOfString(text || " ", {
      width: table.colWidths[index] - 8,
      lineGap: 0,
    }) + 8;
  });
  return Math.max(table.minRowHeight, Math.min(table.maxRowHeight, Math.ceil(Math.max(...heights))));
}

function drawTableRow(doc, table, row, rowHeight, rowIndex) {
  const y = doc.y;
  const fill = rowIndex % 2 === 0 ? "#ffffff" : "#f8fafc";
  table.columns.forEach((column, index) => {
    const x = table.positions[index];
    const width = table.colWidths[index];
    doc.rect(x, y, width, rowHeight).fillAndStroke(fill, "#e5e7eb");
    doc.font("Helvetica").fillColor("#111827").fontSize(6.7).text(asCell(row[column]), x + 4, y + 5, {
      width: width - 8,
      height: rowHeight - 8,
      ellipsis: true,
      lineGap: 0,
    });
  });
  doc.y = y + rowHeight;
}

function ensureSpace(doc, needed, afterAddPage) {
  const bottom = doc.page.height - doc.page.margins.bottom - 12;
  if (doc.y + needed > bottom) {
    doc.addPage();
    if (afterAddPage) afterAddPage();
  }
}

function drawFooter(doc, settings) {
  const pages = doc.bufferedPageRange();
  for (let i = pages.start; i < pages.start + pages.count; i += 1) {
    doc.switchToPage(i);
    const y = doc.page.height - doc.page.margins.bottom - 22;
    const pageNumber = i - pages.start + 1;
    doc.font("Helvetica")
      .fillColor("#6b7280")
      .fontSize(7)
      .text(`${settings.footerText || "Helpdesk TI"} | Página ${pageNumber}/${pages.count}`, doc.page.margins.left, y, {
        width: usableWidth(doc),
        align: "center",
        height: 10,
        ellipsis: true,
        lineBreak: false,
      });
  }
}

function sendCsv(res, report) {
  const filename = `${buildFileBase(report)}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  return res.send(reportToCsv(report));
}

async function sendXlsx(res, report, settings, user) {
  const filename = `${buildFileBase(report)}.xlsx`;
  const buffer = await reportToXlsx(report, settings, user);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  return res.send(Buffer.from(buffer));
}

async function sendPdf(res, report, settings, user) {
  const filename = `${buildFileBase(report)}.pdf`;
  const buffer = await reportToPdf(report, settings, user);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  return res.send(buffer);
}

function usableWidth(doc) {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

function safeSheetName(value) {
  return String(value || "Relatório").replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Relatório";
}

function columnLetter(index) {
  let n = index;
  let out = "";
  while (n > 0) {
    const mod = (n - 1) % 26;
    out = String.fromCharCode(65 + mod) + out;
    n = Math.floor((n - mod) / 26);
  }
  return out || "A";
}

function solidFill(hex) {
  const clean = String(hex || "#0d6efd").replace("#", "").toUpperCase();
  return { type: "pattern", pattern: "solid", fgColor: { argb: `FF${clean}` } };
}

module.exports = {
  buildFileBase,
  reportToCsv,
  reportToXlsx,
  reportToPdf,
  sendCsv,
  sendXlsx,
  sendPdf,
};
