const express = require("express");
const { getPrisma } = require("../db");
const { requireRole } = require("../middleware/auth");
const { buildReport } = require("../services/reporting.service");
const { getReportSettings, normalizeReportSettings } = require("../services/settings.service");
const { sendCsv, sendPdf, sendXlsx } = require("../services/reportExport.service");

const router = express.Router();

router.get("/", requireRole("ADMIN", "TECH", "COORDINATOR"), async (req, res) => {
  const prisma = getPrisma();

  try {
    const [report, defaultSettings] = await Promise.all([
      buildReport(prisma, req.user, req.query),
      getReportSettings(prisma),
    ]);

    const settings = normalizeReportSettings({
      ...defaultSettings,
      layout: req.query.layout || defaultSettings.layout,
      orientation: req.query.orientation || defaultSettings.orientation,
      includeLogo: req.query.includeLogo === "off" ? false : defaultSettings.includeLogo,
      includeGeneratedBy: req.query.includeGeneratedBy === "off" ? false : defaultSettings.includeGeneratedBy,
      accentColor: req.query.accentColor || defaultSettings.accentColor,
    }, defaultSettings);

    if (report.filters.format === "xlsx") return sendXlsx(res, report, settings, req.user);
    if (report.filters.format === "pdf") return sendPdf(res, report, settings, req.user);
    return sendCsv(res, report);
  } catch (error) {
    console.error("Error exporting report:", error);
    res.status(500).send("Erro ao exportar relatório");
  }
});

module.exports = router;
