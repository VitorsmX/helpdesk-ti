const express = require("express");
const { getPrisma } = require("../db");
const { requireRole } = require("../middleware/auth");
const {
  parseReportFilters,
  buildTicketWhere,
  getReportFormOptions,
  isResponseBreached,
  isResolutionBreached,
} = require("../services/reporting.service");
const { getReportSettings } = require("../services/settings.service");

const router = express.Router();

router.get("/", requireRole("ADMIN", "TECH", "COORDINATOR"), async (req, res) => {
  const prisma = getPrisma();
  const selectedPeriod = req.query.period || "30d";
  const filters = parseReportFilters({ ...req.query, period: selectedPeriod }, req.user);

  try {
    const [tickets, lowStock, options, reportSettings] = await Promise.all([
      prisma.ticket.findMany({
        where: buildTicketWhere(req.user, filters),
        include: {
          usf: true,
          sector: true,
          roomRef: true,
          category: true,
          requester: true,
          assignee: true,
        },
        orderBy: { createdAt: "desc" },
        take: Number(process.env.REPORT_DASHBOARD_MAX_ROWS || 5000),
      }),
      prisma.insumo.findMany({
        where: {
          OR: [
            { quantidadeAtual: 0 },
            { quantidadeAtual: { lte: prisma.insumo.fields.quantidadeMinima } },
          ],
        },
        orderBy: { quantidadeAtual: "asc" },
        take: 10,
      }),
      getReportFormOptions(prisma, req.user),
      getReportSettings(prisma),
    ]);

    const dashboard = buildDashboardFromTickets(tickets, filters.period);

    res.render("reports/index", {
      title: "Dashboard Gerencial",
      stats: {
        totalOpen: dashboard.kpis.totalOpen,
        totalResolved: dashboard.totalResolved,
      },
      kpis: dashboard.kpis,
      alerts: dashboard.alerts,
      topUsfs: dashboard.topUsfs,
      topCategories: dashboard.topCategories,
      byUsf: dashboard.byUsf,
      lowStock,
      trendData: dashboard.trendData,
      techWorkload: dashboard.techWorkload,
      slaDetails: dashboard.slaDetails,
      categoryChart: dashboard.categoryChart,
      slaByUnitChart: dashboard.slaByUnitChart,
      sectorHotspots: dashboard.sectorHotspots,
      selectedPeriod: filters.period,
      reportFilters: filters,
      reportOptions: options,
      reportSettings,
    });
  } catch (error) {
    console.error("Error loading dashboard:", error);
    res.status(500).send("Erro ao carregar dashboard");
  }
});

function buildDashboardFromTickets(tickets, selectedPeriod) {
  const now = new Date();
  const activeTickets = tickets.filter((ticket) => !["RESOLVED", "CLOSED"].includes(ticket.status));
  const resolvedTickets = tickets.filter((ticket) => ["RESOLVED", "CLOSED"].includes(ticket.status));
  const responseBreachedTickets = tickets.filter((ticket) => isResponseBreached(ticket, now));
  const responseOnTime = tickets.length - responseBreachedTickets.length;
  const slaRate = tickets.length > 0 ? ((responseOnTime / tickets.length) * 100).toFixed(1) : "0.0";

  const responseHours = tickets
    .filter((ticket) => ticket.firstResponseAt)
    .map((ticket) => hoursBetween(ticket.createdAt, ticket.firstResponseAt));

  const kpis = {
    totalOpen: activeTickets.length,
    avgResponseTime: average(responseHours).toFixed(1),
    slaRate,
    criticalAlerts: responseBreachedTickets.length
      + tickets.filter((ticket) => isResolutionBreached(ticket, now)).length
      + activeTickets.filter((ticket) => ticket.priority === "URGENT").length,
  };

  return {
    totalResolved: resolvedTickets.length,
    kpis,
    alerts: {
      slaBreached: responseBreachedTickets.length,
      stockZero: 0,
      condemned: tickets.filter((ticket) => ticket.resolution === "SEM_REPARO_EQUIPAMENTO_CONDENADO").length,
      waitingParts: tickets.filter((ticket) => ticket.status === "WAITING" && !ticket.resolution).length,
    },
    topUsfs: buildTopUsfs(tickets),
    topCategories: buildTopCategories(tickets),
    byUsf: buildByUsf(tickets),
    trendData: buildTrendData(tickets, selectedPeriod),
    techWorkload: buildTechWorkload(tickets),
    slaDetails: buildSlaDetails(tickets),
    categoryChart: buildCategoryChart(tickets),
    slaByUnitChart: buildSlaByUnitChart(tickets),
    sectorHotspots: buildSectorHotspots(tickets),
  };
}

function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

function buildTopUsfs(tickets) {
  const now = new Date();
  return [...groupBy(tickets, (ticket) => ticket.usf?.nome || "Desconhecida").entries()]
    .map(([nome, group]) => ({
      nome,
      total_chamados: group.length,
      urgentes: group.filter((ticket) => ticket.priority === "URGENT").length,
      sla_breach: group.filter((ticket) => isResponseBreached(ticket, now)).length,
    }))
    .sort((a, b) => (b.sla_breach - a.sla_breach) || (b.total_chamados - a.total_chamados))
    .slice(0, 5);
}

function buildTopCategories(tickets) {
  return [...groupBy(tickets, (ticket) => ticket.category?.nome || "Sem categoria").entries()]
    .map(([nome, group]) => ({
      nome,
      total: group.length,
      percentage: tickets.length ? ((group.length / tickets.length) * 100).toFixed(1) : "0.0",
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);
}

function buildByUsf(tickets) {
  return [...groupBy(tickets, (ticket) => ticket.usf?.nome || "Desconhecida").entries()]
    .map(([usfName, group]) => ({ usfName, count: group.length }))
    .sort((a, b) => b.count - a.count);
}

function buildTrendData(tickets) {
  const days = 7;
  const rows = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - i);
    const next = new Date(day);
    next.setDate(day.getDate() + 1);
    const group = tickets.filter((ticket) => {
      const created = new Date(ticket.createdAt);
      return created >= day && created < next;
    });
    rows.push({
      dia: day.toISOString(),
      total_chamados: group.length,
      urgentes: group.filter((ticket) => ticket.priority === "URGENT").length,
      resolvidos: group.filter((ticket) => ["RESOLVED", "CLOSED"].includes(ticket.status)).length,
    });
  }
  return rows;
}

function buildTechWorkload(tickets) {
  return [...groupBy(tickets.filter((ticket) => ticket.assignee), (ticket) => ticket.assignee.nome).entries()]
    .map(([nome, group], index) => ({
      id: index + 1,
      nome,
      chamados_ativos: group.filter((ticket) => !["RESOLVED", "CLOSED"].includes(ticket.status)).length,
      urgentes: group.filter((ticket) => ticket.priority === "URGENT").length,
      tempo_resposta_medio: average(group.filter((ticket) => ticket.firstResponseAt).map((ticket) => hoursBetween(ticket.createdAt, ticket.firstResponseAt))).toFixed(1),
    }))
    .sort((a, b) => b.chamados_ativos - a.chamados_ativos)
    .slice(0, 10);
}

function buildSlaDetails(tickets) {
  const now = new Date();
  const atrasados = tickets.filter((ticket) => isResponseBreached(ticket, now)).length;
  const noPrazo = Math.max(0, tickets.length - atrasados);
  return {
    total: tickets.length,
    no_prazo: noPrazo,
    atrasados,
    tempo_medio_resposta: average(tickets.filter((ticket) => ticket.firstResponseAt).map((ticket) => hoursBetween(ticket.createdAt, ticket.firstResponseAt))).toFixed(1),
    tempo_medio_resolucao: average(tickets.filter((ticket) => ticket.resolvedAt).map((ticket) => hoursBetween(ticket.createdAt, ticket.resolvedAt))).toFixed(1),
    taxa_cumprimento: tickets.length ? ((noPrazo / tickets.length) * 100).toFixed(1) : "0.0",
  };
}

function buildCategoryChart(tickets) {
  return buildTopCategories(tickets).map((item) => ({ label: item.nome, value: item.total }));
}

function buildSlaByUnitChart(tickets) {
  const now = new Date();
  return [...groupBy(tickets, (ticket) => ticket.usf?.nome || "Desconhecida").entries()]
    .map(([label, group]) => ({
      label,
      value: group.length ? Number((((group.length - group.filter((ticket) => isResponseBreached(ticket, now)).length) / group.length) * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => a.value - b.value)
    .slice(0, 10);
}

function buildSectorHotspots(tickets) {
  const now = new Date();
  return [...groupBy(tickets, (ticket) => [
    ticket.usf?.nome || "Unidade",
    ticket.sector?.nome || "Sem setor",
    ticket.roomRef?.nome || ticket.room || "Sem sala",
  ].join(" / ")).entries()]
    .map(([name, group]) => ({
      name,
      total: group.length,
      breached: group.filter((ticket) => isResponseBreached(ticket, now)).length,
      urgent: group.filter((ticket) => ticket.priority === "URGENT").length,
    }))
    .sort((a, b) => (b.breached - a.breached) || (b.total - a.total))
    .slice(0, 8);
}

function hoursBetween(start, end) {
  if (!start || !end) return 0;
  return Math.max(0, (new Date(end) - new Date(start)) / (1000 * 60 * 60));
}

function average(values) {
  const nums = values.filter((value) => Number.isFinite(value));
  if (!nums.length) return 0;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

module.exports = router;
