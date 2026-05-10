const { intId, enumValue, TicketStatuses, Priorities } = require("../utils/validation");
const {
  fmtDateBR,
  translateStatus,
  translatePriority,
  translateRoom,
  translateHardwareStatus,
} = require("../utils/views");

const REPORT_TYPES = Object.freeze({
  tickets: {
    label: "Chamados detalhados",
    description: "Lista operacional com SLA, unidade, setor, sala, solicitante e técnico.",
    roles: ["ADMIN", "TECH", "COORDINATOR"],
  },
  "attention-units": {
    label: "Unidades que precisam de atenção",
    description: "Ranking por volume, urgência e atrasos de SLA.",
    roles: ["ADMIN", "TECH", "COORDINATOR"],
  },
  "sla-sectors": {
    label: "SLA por setor e sala",
    description: "Indicadores por unidade, setor e sala para identificar gargalos locais.",
    roles: ["ADMIN", "TECH", "COORDINATOR"],
  },
  categories: {
    label: "Demanda por categoria",
    description: "Distribuição de chamados por categoria, prioridade e atraso.",
    roles: ["ADMIN", "TECH", "COORDINATOR"],
  },
  inventory: {
    label: "Inventário e insumos",
    description: "Equipamentos, patrimônio, localização e estoque crítico.",
    roles: ["ADMIN", "TECH"],
  },
  technicians: {
    label: "Produtividade técnica",
    description: "Carga de trabalho, resoluções e tempo médio por técnico.",
    roles: ["ADMIN"],
  },
});

const PERIODS = Object.freeze({
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "180d": 180,
  custom: "custom",
  all: null,
});

function allowedReportTypesFor(user) {
  return Object.entries(REPORT_TYPES)
    .filter(([, definition]) => definition.roles.includes(user.role))
    .map(([value, definition]) => ({ value, ...definition }));
}

function normalizeReportType(value, user) {
  const allowed = allowedReportTypesFor(user).map((item) => item.value);
  return allowed.includes(value) ? value : allowed[0] || "tickets";
}

function parseReportFilters(query = {}, user) {
  const mode = query.mode === "advanced" ? "advanced" : "simple";
  const period = Object.prototype.hasOwnProperty.call(PERIODS, query.period) ? query.period : "30d";
  const type = normalizeReportType(String(query.type || "tickets"), user);
  const format = ["csv", "xlsx", "pdf"].includes(query.format) ? query.format : "csv";

  return {
    mode,
    type,
    format,
    period,
    startDate: parseDate(query.startDate),
    endDate: parseDate(query.endDate, true),
    usfId: intId(query.usfId),
    sectorId: intId(query.sectorId),
    categoryId: intId(query.categoryId),
    status: enumValue(query.status, TicketStatuses, null),
    priority: enumValue(query.priority, Priorities, null),
  };
}

function parseDate(value, endOfDay = false) {
  if (!value) return null;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function resolveDateRange(filters) {
  if ((filters.mode === "advanced" || filters.period === "custom") && (filters.startDate || filters.endDate)) {
    return { gte: filters.startDate || undefined, lte: filters.endDate || undefined };
  }

  const days = PERIODS[filters.period];
  if (!days || days === "custom") return null;

  const start = new Date();
  start.setDate(start.getDate() - days);
  return { gte: start };
}

function buildTicketWhere(user, filters) {
  const where = {};
  const dateRange = resolveDateRange(filters);
  if (dateRange) where.createdAt = dateRange;

  if (user.role === "COORDINATOR") {
    where.usfId = user.usfId;
  } else if (filters.usfId) {
    where.usfId = filters.usfId;
  }

  if (filters.sectorId) where.sectorId = filters.sectorId;
  if (filters.categoryId) where.categoryId = filters.categoryId;
  if (filters.status) where.status = filters.status;
  if (filters.priority) where.priority = filters.priority;

  return where;
}

function hoursBetween(start, end) {
  if (!start || !end) return null;
  return Math.max(0, (new Date(end) - new Date(start)) / (1000 * 60 * 60));
}

function avg(values) {
  const nums = values.filter((value) => Number.isFinite(value));
  if (!nums.length) return null;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function isResponseBreached(ticket, now = new Date()) {
  if (ticket.responseBreachedAt) return true;
  if (ticket.firstResponseAt) return new Date(ticket.firstResponseAt) > new Date(ticket.responseDueAt);
  return new Date(ticket.responseDueAt) < now;
}

function isResolutionBreached(ticket, now = new Date()) {
  if (ticket.resolutionBreachedAt) return true;
  if (ticket.resolvedAt) return new Date(ticket.resolvedAt) > new Date(ticket.resolutionDueAt);
  return !["RESOLVED", "CLOSED"].includes(ticket.status) && new Date(ticket.resolutionDueAt) < now;
}

function displayRoom(ticket) {
  return ticket.roomRef?.nome || translateRoom(ticket.room) || "Não informado";
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

function toPercent(part, total) {
  return total > 0 ? Number(((part / total) * 100).toFixed(1)) : 0;
}

function ticketRows(tickets) {
  const now = new Date();
  return tickets.map((ticket) => {
    const responseHours = hoursBetween(ticket.createdAt, ticket.firstResponseAt);
    const resolutionHours = hoursBetween(ticket.createdAt, ticket.resolvedAt);
    return {
      ID: ticket.id,
      Título: ticket.title,
      Unidade: ticket.usf?.nome || "",
      Setor: ticket.sector?.nome || "",
      Sala: displayRoom(ticket),
      Categoria: ticket.category?.nome || "",
      Solicitante: ticket.requester?.nome || "",
      Técnico: ticket.assignee?.nome || "Não atribuído",
      Status: translateStatus(ticket.status),
      Prioridade: translatePriority(ticket.priority),
      "Criado em": fmtDateBR(ticket.createdAt),
      "Primeira resposta": fmtDateBR(ticket.firstResponseAt),
      "Resolvido em": fmtDateBR(ticket.resolvedAt),
      "SLA resposta vencido": isResponseBreached(ticket, now) ? "Sim" : "Não",
      "SLA resolução vencido": isResolutionBreached(ticket, now) ? "Sim" : "Não",
      "Tempo resposta (h)": responseHours === null ? "" : responseHours.toFixed(2),
      "Tempo resolução (h)": resolutionHours === null ? "" : resolutionHours.toFixed(2),
    };
  });
}

function attentionUnitRows(tickets) {
  const now = new Date();
  const groups = groupBy(tickets, (ticket) => `${ticket.usfId}:${ticket.usf?.nome || "Sem unidade"}`);
  return [...groups.entries()]
    .map(([key, group]) => {
      const [, unidade] = key.split(":");
      const active = group.filter((ticket) => !["RESOLVED", "CLOSED"].includes(ticket.status)).length;
      const urgent = group.filter((ticket) => ticket.priority === "URGENT").length;
      const responseBreaches = group.filter((ticket) => isResponseBreached(ticket, now)).length;
      const resolutionBreaches = group.filter((ticket) => isResolutionBreached(ticket, now)).length;
      const score = active * 2 + urgent * 3 + responseBreaches * 4 + resolutionBreaches * 5;
      return {
        Unidade: unidade,
        "Chamados no período": group.length,
        "Chamados ativos": active,
        Urgentes: urgent,
        "SLA resposta vencido": responseBreaches,
        "SLA resolução vencido": resolutionBreaches,
        "Cumprimento SLA (%)": toPercent(group.length - responseBreaches, group.length),
        "Índice de atenção": score,
      };
    })
    .sort((a, b) => b["Índice de atenção"] - a["Índice de atenção"]);
}

function slaSectorRows(tickets) {
  const now = new Date();
  const groups = groupBy(tickets, (ticket) => [
    ticket.usf?.nome || "Sem unidade",
    ticket.sector?.nome || "Sem setor",
    displayRoom(ticket),
  ].join("||"));

  return [...groups.entries()]
    .map(([key, group]) => {
      const [unidade, setor, sala] = key.split("||");
      const responseBreaches = group.filter((ticket) => isResponseBreached(ticket, now)).length;
      const resolutionBreaches = group.filter((ticket) => isResolutionBreached(ticket, now)).length;
      return {
        Unidade: unidade,
        Setor: setor,
        Sala: sala,
        Chamados: group.length,
        "Abertos/ativos": group.filter((ticket) => !["RESOLVED", "CLOSED"].includes(ticket.status)).length,
        Urgentes: group.filter((ticket) => ticket.priority === "URGENT").length,
        "SLA resposta vencido": responseBreaches,
        "SLA resolução vencido": resolutionBreaches,
        "SLA no prazo (%)": toPercent(group.length - responseBreaches, group.length),
        "Tempo médio resposta (h)": formatNumber(avg(group.map((ticket) => hoursBetween(ticket.createdAt, ticket.firstResponseAt)))),
        "Tempo médio resolução (h)": formatNumber(avg(group.map((ticket) => hoursBetween(ticket.createdAt, ticket.resolvedAt)))),
      };
    })
    .sort((a, b) => b.Chamados - a.Chamados);
}

function categoryRows(tickets) {
  const now = new Date();
  const groups = groupBy(tickets, (ticket) => ticket.category?.nome || "Sem categoria");
  return [...groups.entries()]
    .map(([categoria, group]) => {
      const responseBreaches = group.filter((ticket) => isResponseBreached(ticket, now)).length;
      return {
        Categoria: categoria,
        Chamados: group.length,
        Urgentes: group.filter((ticket) => ticket.priority === "URGENT").length,
        Altos: group.filter((ticket) => ticket.priority === "HIGH").length,
        "SLA vencido": responseBreaches,
        "Participação (%)": toPercent(group.length, tickets.length),
        "Tempo médio resposta (h)": formatNumber(avg(group.map((ticket) => hoursBetween(ticket.createdAt, ticket.firstResponseAt)))),
      };
    })
    .sort((a, b) => b.Chamados - a.Chamados);
}

async function inventoryRows(prisma, user, filters) {
  const usfWhere = user.role === "COORDINATOR" ? { usfId: user.usfId } : filters.usfId ? { usfId: filters.usfId } : {};
  const [hardwares, insumos] = await Promise.all([
    prisma.hardware.findMany({
      where: usfWhere,
      include: { usf: true, sector: true, roomRef: true },
      orderBy: [{ usfId: "asc" }, { tipo: "asc" }],
      take: 5000,
    }),
    prisma.insumo.findMany({ orderBy: [{ quantidadeAtual: "asc" }, { nome: "asc" }] }),
  ]);

  const hardwareRows = hardwares.map((item) => ({
    Registro: "Equipamento",
    Unidade: item.usf?.nome || "",
    Setor: item.sector?.nome || "",
    Sala: item.roomRef?.nome || translateRoom(item.sala),
    Item: item.tipo,
    Modelo: item.modelo || "",
    Patrimônio: item.patrimonio || "",
    Status: translateHardwareStatus(item.status),
    "Estoque atual": "",
    "Estoque mínimo": "",
    Observação: item.observacoes || "",
  }));

  const stockRows = insumos.map((item) => ({
    Registro: "Insumo",
    Unidade: "",
    Setor: "",
    Sala: "",
    Item: item.nome,
    Modelo: item.tipo,
    Patrimônio: "",
    Status: item.quantidadeAtual <= item.quantidadeMinima ? "Crítico" : "Adequado",
    "Estoque atual": item.quantidadeAtual,
    "Estoque mínimo": item.quantidadeMinima,
    Observação: item.quantidadeAtual === 0 ? "Estoque zerado" : "",
  }));

  return [...stockRows, ...hardwareRows];
}

function technicianRows(tickets) {
  const groups = groupBy(tickets.filter((ticket) => ticket.assignee), (ticket) => `${ticket.assigneeId}:${ticket.assignee.nome}`);
  return [...groups.entries()]
    .map(([key, group]) => {
      const [, tecnico] = key.split(":");
      return {
        Técnico: tecnico,
        "Chamados atribuídos": group.length,
        "Ativos": group.filter((ticket) => !["RESOLVED", "CLOSED"].includes(ticket.status)).length,
        "Resolvidos/fechados": group.filter((ticket) => ["RESOLVED", "CLOSED"].includes(ticket.status)).length,
        Urgentes: group.filter((ticket) => ticket.priority === "URGENT").length,
        "Tempo médio resposta (h)": formatNumber(avg(group.map((ticket) => hoursBetween(ticket.createdAt, ticket.firstResponseAt)))),
        "Tempo médio resolução (h)": formatNumber(avg(group.map((ticket) => hoursBetween(ticket.createdAt, ticket.resolvedAt)))),
      };
    })
    .sort((a, b) => b["Chamados atribuídos"] - a["Chamados atribuídos"]);
}

function formatNumber(value) {
  return value === null || value === undefined ? "" : Number(value).toFixed(2);
}

function summarizeTickets(tickets) {
  const now = new Date();
  const active = tickets.filter((ticket) => !["RESOLVED", "CLOSED"].includes(ticket.status)).length;
  const responseBreaches = tickets.filter((ticket) => isResponseBreached(ticket, now)).length;
  const resolutionBreaches = tickets.filter((ticket) => isResolutionBreached(ticket, now)).length;
  return [
    { label: "Total de registros", value: tickets.length },
    { label: "Chamados ativos", value: active },
    { label: "Urgentes", value: tickets.filter((ticket) => ticket.priority === "URGENT").length },
    { label: "SLA resposta vencido", value: responseBreaches },
    { label: "SLA resolução vencido", value: resolutionBreaches },
    { label: "Cumprimento SLA resposta", value: `${toPercent(tickets.length - responseBreaches, tickets.length)}%` },
  ];
}

async function fetchTickets(prisma, user, filters) {
  return prisma.ticket.findMany({
    where: buildTicketWhere(user, filters),
    include: {
      usf: true,
      sector: true,
      roomRef: true,
      category: true,
      requester: true,
      assignee: true,
    },
    orderBy: { createdAt: "desc" },
    take: Number(process.env.REPORT_MAX_ROWS || 5000),
  });
}

async function buildReport(prisma, user, rawFilters = {}) {
  const filters = parseReportFilters(rawFilters, user);
  const definition = REPORT_TYPES[filters.type];
  const title = definition.label;

  if (filters.type === "inventory") {
    const rows = await inventoryRows(prisma, user, filters);
    return {
      type: filters.type,
      title,
      description: definition.description,
      filters,
      summary: [{ label: "Total de registros", value: rows.length }],
      sections: [{ title, rows, columns: Object.keys(rows[0] || inventoryEmptyRow()) }],
    };
  }

  const tickets = await fetchTickets(prisma, user, filters);
  let rows;
  if (filters.type === "attention-units") rows = attentionUnitRows(tickets);
  else if (filters.type === "sla-sectors") rows = slaSectorRows(tickets);
  else if (filters.type === "categories") rows = categoryRows(tickets);
  else if (filters.type === "technicians") rows = technicianRows(tickets);
  else rows = ticketRows(tickets);

  return {
    type: filters.type,
    title,
    description: definition.description,
    filters,
    summary: summarizeTickets(tickets),
    sections: [{ title, rows, columns: Object.keys(rows[0] || ticketEmptyRow(filters.type)) }],
  };
}

function ticketEmptyRow(type) {
  const rowsByType = {
    tickets: {
      ID: "", Título: "", Unidade: "", Setor: "", Sala: "", Categoria: "", Solicitante: "", Técnico: "",
      Status: "", Prioridade: "", "Criado em": "", "Primeira resposta": "", "Resolvido em": "",
      "SLA resposta vencido": "", "SLA resolução vencido": "", "Tempo resposta (h)": "", "Tempo resolução (h)": "",
    },
    "attention-units": {
      Unidade: "", "Chamados no período": "", "Chamados ativos": "", Urgentes: "", "SLA resposta vencido": "",
      "SLA resolução vencido": "", "Cumprimento SLA (%)": "", "Índice de atenção": "",
    },
    "sla-sectors": {
      Unidade: "", Setor: "", Sala: "", Chamados: "", "Abertos/ativos": "", Urgentes: "",
      "SLA resposta vencido": "", "SLA resolução vencido": "", "SLA no prazo (%)": "",
      "Tempo médio resposta (h)": "", "Tempo médio resolução (h)": "",
    },
    categories: {
      Categoria: "", Chamados: "", Urgentes: "", Altos: "", "SLA vencido": "", "Participação (%)": "",
      "Tempo médio resposta (h)": "",
    },
    technicians: {
      Técnico: "", "Chamados atribuídos": "", Ativos: "", "Resolvidos/fechados": "", Urgentes: "",
      "Tempo médio resposta (h)": "", "Tempo médio resolução (h)": "",
    },
  };
  return rowsByType[type] || rowsByType.tickets;
}

function inventoryEmptyRow() {
  return {
    Registro: "", Unidade: "", Setor: "", Sala: "", Item: "", Modelo: "", Patrimônio: "",
    Status: "", "Estoque atual": "", "Estoque mínimo": "", Observação: "",
  };
}

async function getReportFormOptions(prisma, user) {
  const usfWhere = user.role === "COORDINATOR" ? { id: user.usfId } : {};
  const [usfs, sectors, categories] = await Promise.all([
    prisma.usf.findMany({ where: usfWhere, orderBy: { nome: "asc" } }),
    prisma.sector.findMany({
      where: user.role === "COORDINATOR" ? { usfId: user.usfId } : {},
      include: { usf: true },
      orderBy: [{ usfId: "asc" }, { nome: "asc" }],
    }),
    prisma.category.findMany({ where: { ativo: true }, orderBy: { nome: "asc" } }),
  ]);

  return {
    types: allowedReportTypesFor(user),
    dashboardPeriods: [
      { value: "7d", label: "Últimos 7 dias" },
      { value: "30d", label: "Últimos 30 dias" },
      { value: "90d", label: "Últimos 90 dias" },
      { value: "180d", label: "Últimos 180 dias" },
      { value: "all", label: "Todo o período" },
    ],
    periods: [
      { value: "7d", label: "Últimos 7 dias" },
      { value: "30d", label: "Últimos 30 dias" },
      { value: "90d", label: "Últimos 90 dias" },
      { value: "180d", label: "Últimos 180 dias" },
      { value: "all", label: "Todo o período" },
    ],
    usfs,
    sectors,
    categories,
    statuses: TicketStatuses,
    priorities: Priorities,
  };
}

module.exports = {
  REPORT_TYPES,
  PERIODS,
  allowedReportTypesFor,
  parseReportFilters,
  buildTicketWhere,
  buildReport,
  getReportFormOptions,
  isResponseBreached,
  isResolutionBreached,
};
