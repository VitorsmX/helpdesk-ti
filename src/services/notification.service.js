const ACTIVE_TICKET_STATUSES = ["OPEN", "IN_PROGRESS", "WAITING"];
const DEFAULT_LOOKBACK_MS = 2 * 60 * 1000;
const MAX_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const DUE_SOON_MS = 60 * 60 * 1000;

const STATUS_LABELS = {
  OPEN: "Aberto",
  IN_PROGRESS: "Em atendimento",
  WAITING: "Aguardando",
  RESOLVED: "Resolvido",
  CLOSED: "Fechado",
};

const PRIORITY_LABELS = {
  LOW: "Baixa",
  MEDIUM: "Média",
  HIGH: "Alta",
  URGENT: "Urgente",
};

function normalizeSince(value, now = new Date()) {
  const fallback = new Date(now.getTime() - DEFAULT_LOOKBACK_MS);
  if (!value) return fallback;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallback;
  if (parsed > now) return fallback;

  const maxPast = new Date(now.getTime() - MAX_LOOKBACK_MS);
  return parsed < maxPast ? maxPast : parsed;
}

async function buildNotificationEvents(prisma, user, options = {}) {
  const now = options.now || new Date();
  const since = normalizeSince(options.since, now);
  const limit = Math.min(Math.max(Number(options.limit || 10), 1), 20);
  const events = [];

  if (user.role === "REQUESTER") {
    events.push(...await requesterEvents(prisma, user, since));
  }

  if (user.role === "COORDINATOR") {
    events.push(...await coordinatorEvents(prisma, user, since, now));
  }

  if (user.role === "TECH") {
    events.push(...await techEvents(prisma, user, since, now));
  }

  if (user.role === "ADMIN") {
    events.push(...await adminEvents(prisma, since, now));
  }

  return events
    .sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt))
    .slice(0, limit);
}

async function requesterEvents(prisma, user, since) {
  const [messages, ticketUpdates] = await Promise.all([
    prisma.ticketMessage.findMany({
      where: {
        createdAt: { gt: since },
        visibility: "PUBLIC",
        authorId: { not: user.id },
        ticket: { requesterId: user.id },
      },
      include: {
        author: true,
        ticket: { include: { category: true, usf: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
    prisma.ticket.findMany({
      where: {
        requesterId: user.id,
        updatedAt: { gt: since },
        createdAt: { lt: since },
        status: { in: ["IN_PROGRESS", "WAITING", "RESOLVED", "CLOSED"] },
      },
      include: { category: true, usf: true, assignee: true },
      orderBy: { updatedAt: "desc" },
      take: 8,
    }),
  ]);

  return [
    ...messages.map((message) => messageEvent(message, "Mensagem no seu chamado", "info")),
    ...ticketUpdates.map((ticket) => ticketUpdateEvent(ticket, "Seu chamado foi atualizado", "info")),
  ];
}

async function coordinatorEvents(prisma, user, since, now) {
  const dueUntil = new Date(now.getTime() + DUE_SOON_MS);
  const [newTickets, messages, dueSoon] = await Promise.all([
    prisma.ticket.findMany({
      where: {
        usfId: user.usfId,
        requesterId: { not: user.id },
        createdAt: { gt: since },
      },
      include: { category: true, usf: true, requester: true },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
    prisma.ticketMessage.findMany({
      where: {
        createdAt: { gt: since },
        visibility: "PUBLIC",
        authorId: { not: user.id },
        ticket: { usfId: user.usfId },
      },
      include: {
        author: true,
        ticket: { include: { category: true, usf: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
    prisma.ticket.findMany({
      where: {
        usfId: user.usfId,
        status: { in: ACTIVE_TICKET_STATUSES },
        OR: [
          { firstResponseAt: null, responseDueAt: { gt: now, lte: dueUntil } },
          { resolvedAt: null, resolutionDueAt: { gt: now, lte: dueUntil } },
        ],
      },
      include: { category: true, usf: true, assignee: true },
      orderBy: { resolutionDueAt: "asc" },
      take: 5,
    }),
  ]);

  return [
    ...newTickets.map((ticket) => newTicketEvent(ticket, "Novo chamado na sua unidade")),
    ...messages.map((message) => messageEvent(message, "Movimentação em chamado da unidade", "info")),
    ...dueSoon.map((ticket) => dueSoonEvent(ticket)),
  ];
}

async function techEvents(prisma, user, since, now) {
  const dueUntil = new Date(now.getTime() + DUE_SOON_MS);
  const [newQueueTickets, assignedMessages, dueSoon] = await Promise.all([
    prisma.ticket.findMany({
      where: {
        createdAt: { gt: since },
        status: "OPEN",
        assigneeId: null,
      },
      include: { category: true, usf: true, requester: true },
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      take: 8,
    }),
    prisma.ticketMessage.findMany({
      where: {
        createdAt: { gt: since },
        authorId: { not: user.id },
        ticket: { assigneeId: user.id },
      },
      include: {
        author: true,
        ticket: { include: { category: true, usf: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
    prisma.ticket.findMany({
      where: {
        status: { in: ACTIVE_TICKET_STATUSES },
        OR: [
          { assigneeId: user.id },
          { assigneeId: null },
        ],
        AND: [{
          OR: [
            { firstResponseAt: null, responseDueAt: { gt: now, lte: dueUntil } },
            { resolvedAt: null, resolutionDueAt: { gt: now, lte: dueUntil } },
          ],
        }],
      },
      include: { category: true, usf: true, assignee: true },
      orderBy: { resolutionDueAt: "asc" },
      take: 6,
    }),
  ]);

  return [
    ...newQueueTickets.map((ticket) => newTicketEvent(ticket, "Novo chamado na fila TI")),
    ...assignedMessages.map((message) => messageEvent(message, "Resposta em chamado atribuído a você", "info")),
    ...dueSoon.map((ticket) => dueSoonEvent(ticket)),
  ];
}

async function adminEvents(prisma, since, now) {
  const [newUrgentTickets, breachedTickets, lowStock, waitingParts, condemned] = await Promise.all([
    prisma.ticket.findMany({
      where: {
        createdAt: { gt: since },
        priority: { in: ["HIGH", "URGENT"] },
      },
      include: { category: true, usf: true, requester: true },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
    prisma.ticket.findMany({
      where: {
        status: { in: ACTIVE_TICKET_STATUSES },
        OR: [
          { responseBreachedAt: { gt: since } },
          { resolutionBreachedAt: { gt: since } },
          { firstResponseAt: null, responseDueAt: { gt: since, lte: now } },
          { resolvedAt: null, resolutionDueAt: { gt: since, lte: now } },
        ],
      },
      include: { category: true, usf: true, assignee: true },
      orderBy: { updatedAt: "desc" },
      take: 8,
    }),
    prisma.insumo.findMany({
      where: {
        quantidadeAtual: { lte: prisma.insumo.fields.quantidadeMinima },
      },
      orderBy: { nome: "asc" },
      take: 8,
    }),
    prisma.ticket.findMany({
      where: {
        updatedAt: { gt: since },
        OR: [
          { status: "WAITING" },
          { resolution: "AGUARDANDO_PECA_SEM_ESTOQUE" },
        ],
      },
      include: { category: true, usf: true, assignee: true },
      orderBy: { updatedAt: "desc" },
      take: 8,
    }),
    prisma.ticket.findMany({
      where: {
        updatedAt: { gt: since },
        resolution: "SEM_REPARO_EQUIPAMENTO_CONDENADO",
      },
      include: { category: true, usf: true, assignee: true },
      orderBy: { updatedAt: "desc" },
      take: 8,
    }),
  ]);

  return [
    ...newUrgentTickets.map((ticket) => newTicketEvent(ticket, "Chamado de alta prioridade aberto")),
    ...breachedTickets.map((ticket) => breachedEvent(ticket)),
    ...lowStock.map((item) => lowStockEvent(item)),
    ...waitingParts.map((ticket) => waitingPartsEvent(ticket)),
    ...condemned.map((ticket) => condemnedEvent(ticket)),
  ];
}

function newTicketEvent(ticket, title) {
  const priority = PRIORITY_LABELS[ticket.priority] || ticket.priority;
  return event({
    type: "ticket_new",
    severity: ticket.priority === "URGENT" ? "urgent" : ticket.priority === "HIGH" ? "warning" : "info",
    sourceId: ticket.id,
    title,
    body: `#${ticket.id} ${ticket.title} - ${priority} em ${locationName(ticket)}.`,
    url: ticketUrl(ticket),
    occurredAt: ticket.createdAt,
  });
}

function ticketUpdateEvent(ticket, title, severity) {
  const status = STATUS_LABELS[ticket.status] || ticket.status;
  return event({
    type: "ticket_update",
    severity: severity || statusSeverity(ticket.status),
    sourceId: ticket.id,
    title,
    body: `#${ticket.id} agora está como ${status}. ${assigneeText(ticket)}`,
    url: ticketUrl(ticket),
    occurredAt: ticket.updatedAt,
  });
}

function messageEvent(message, title, severity) {
  const ticket = message.ticket;
  const author = message.author?.nome || "Usuário";
  return event({
    type: "ticket_message",
    severity: severity || "info",
    sourceId: `${ticket.id}:${message.id}`,
    title,
    body: `${author} comentou no chamado #${ticket.id}: ${trimBody(message.body)}`,
    url: ticketUrl(ticket),
    occurredAt: message.createdAt,
  });
}

function dueSoonEvent(ticket) {
  return event({
    type: "sla_due_soon",
    severity: ticket.priority === "URGENT" ? "urgent" : "warning",
    sourceId: ticket.id,
    title: "SLA próximo do vencimento",
    body: `#${ticket.id} precisa de atenção em ${locationName(ticket)}.`,
    url: ticketUrl(ticket),
    occurredAt: earliestDueDate(ticket),
  });
}

function breachedEvent(ticket) {
  return event({
    type: "sla_breached",
    severity: "urgent",
    sourceId: ticket.id,
    title: "SLA estourado",
    body: `#${ticket.id} ultrapassou prazo de resposta ou resolução em ${locationName(ticket)}.`,
    url: "/admin/sla-breached",
    occurredAt: ticket.responseBreachedAt || ticket.resolutionBreachedAt || earliestDueDate(ticket) || ticket.updatedAt,
  });
}

function lowStockEvent(item) {
  return event({
    type: "stock_low",
    severity: item.quantidadeAtual <= 0 ? "urgent" : "warning",
    sourceId: `${item.id}:${item.quantidadeAtual}`,
    title: "Estoque crítico",
    body: `${item.nome} está com ${item.quantidadeAtual} unidade(s). Mínimo: ${item.quantidadeMinima}.`,
    url: "/admin/insumos",
    occurredAt: item.updatedAt || new Date(0),
  });
}

function waitingPartsEvent(ticket) {
  return event({
    type: "waiting_parts",
    severity: "warning",
    sourceId: ticket.id,
    title: "Chamado aguardando peça",
    body: `#${ticket.id} depende de peça ou insumo em ${locationName(ticket)}.`,
    url: "/admin/waiting-parts",
    occurredAt: ticket.updatedAt,
  });
}

function condemnedEvent(ticket) {
  return event({
    type: "condemned_asset",
    severity: "warning",
    sourceId: ticket.id,
    title: "Equipamento marcado sem reparo",
    body: `#${ticket.id} precisa de validação administrativa.`,
    url: "/admin/condemned",
    occurredAt: ticket.updatedAt || ticket.resolvedAt,
  });
}

function event({ type, severity, sourceId, title, body, url, occurredAt }) {
  const at = occurredAt ? new Date(occurredAt) : new Date();
  const stamp = Number.isNaN(at.getTime()) ? new Date().toISOString() : at.toISOString();

  return {
    id: `${type}:${sourceId}:${stamp}`,
    type,
    severity,
    title,
    body,
    url,
    occurredAt: stamp,
  };
}

function ticketUrl(ticket) {
  return `/tickets/${ticket.id}`;
}

function locationName(ticket) {
  return ticket.usf?.nome || "unidade não informada";
}

function assigneeText(ticket) {
  if (!ticket.assignee?.nome) return "Ainda sem técnico responsável.";
  return `Responsável: ${ticket.assignee.nome}.`;
}

function statusSeverity(status) {
  if (status === "RESOLVED" || status === "CLOSED") return "success";
  if (status === "WAITING") return "warning";
  return "info";
}

function earliestDueDate(ticket) {
  const dueDates = [ticket.responseDueAt, ticket.resolutionDueAt]
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()))
    .sort((a, b) => a - b);

  return dueDates[0] || ticket.updatedAt || ticket.createdAt;
}

function trimBody(body) {
  const text = String(body || "").replace(/\s+/g, " ").trim();
  if (text.length <= 96) return text;
  return `${text.slice(0, 93)}...`;
}

module.exports = {
  buildNotificationEvents,
  normalizeSince,
};
