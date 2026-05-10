const REPORT_SETTINGS_KEY = "reports.default";

const DEFAULT_REPORT_SETTINGS = Object.freeze({
  organizationName: "Prefeitura Municipal de Capanema - PA",
  reportTitlePrefix: "Relatório de Suporte Técnico",
  footerText: "Helpdesk TI - Prefeitura Municipal de Capanema",
  accentColor: "#0d6efd",
  layout: "classic",
  paperSize: "A4",
  orientation: "landscape",
  includeLogo: true,
  includeGeneratedBy: true,
  logoFile: null,
});

function parseJsonSetting(record, fallback) {
  if (!record || !record.valueJson) return { ...fallback };
  try {
    return { ...fallback, ...JSON.parse(record.valueJson) };
  } catch (error) {
    return { ...fallback };
  }
}

async function getSetting(prisma, key, fallback = {}) {
  const record = await prisma.appSetting.findUnique({ where: { key } });
  return parseJsonSetting(record, fallback);
}

async function upsertSetting(prisma, key, value, updatedById = null) {
  return prisma.appSetting.upsert({
    where: { key },
    update: {
      valueJson: JSON.stringify(value),
      updatedById,
    },
    create: {
      key,
      valueJson: JSON.stringify(value),
      updatedById,
    },
  });
}

async function getReportSettings(prisma) {
  return getSetting(prisma, REPORT_SETTINGS_KEY, DEFAULT_REPORT_SETTINGS);
}

function normalizeReportSettings(input, previous = DEFAULT_REPORT_SETTINGS) {
  const accentColor = /^#[0-9a-fA-F]{6}$/.test(String(input.accentColor || ""))
    ? String(input.accentColor)
    : previous.accentColor;

  return {
    ...DEFAULT_REPORT_SETTINGS,
    ...previous,
    organizationName: String(input.organizationName || previous.organizationName).trim().slice(0, 140),
    reportTitlePrefix: String(input.reportTitlePrefix || previous.reportTitlePrefix).trim().slice(0, 140),
    footerText: String(input.footerText || previous.footerText || "").trim().slice(0, 180),
    accentColor,
    layout: ["classic", "compact"].includes(input.layout) ? input.layout : previous.layout,
    paperSize: ["A4", "LETTER"].includes(input.paperSize) ? input.paperSize : previous.paperSize,
    orientation: ["portrait", "landscape"].includes(input.orientation) ? input.orientation : previous.orientation,
    includeLogo: input.includeLogo === "on" || input.includeLogo === true,
    includeGeneratedBy: input.includeGeneratedBy === "on" || input.includeGeneratedBy === true,
    logoFile: input.logoFile === undefined ? previous.logoFile : input.logoFile,
  };
}

module.exports = {
  REPORT_SETTINGS_KEY,
  DEFAULT_REPORT_SETTINGS,
  getSetting,
  upsertSetting,
  getReportSettings,
  normalizeReportSettings,
};
