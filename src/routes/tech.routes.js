const express = require('express');
const { getPrisma } = require('../db');
const { requireRole, canViewTicket } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');
const { computeSlaDates, businessMinutesBetween, isResolutionPausedStatus, addMinutes } = require('../utils/sla');
const { writeLimiter } = require('../middleware/rateLimit');
const { LegacyRooms, Priorities, TicketStatuses, TicketResolutions, enumValue, intId } = require('../utils/validation');

const router = express.Router();

router.get('/tickets', requireRole('TECH', 'ADMIN'), async (req, res) => {
  const prisma = getPrisma();

  const q = String(req.query.q || '').trim();
  const usfId = intId(req.query.usfId);
  const room = enumValue(req.query.room, LegacyRooms, null);
  const status = enumValue(req.query.status, TicketStatuses, null);
  const categoryId = intId(req.query.categoryId);
  const priority = enumValue(req.query.priority, Priorities, null);
  const assigneeId = intId(req.query.assigneeId);

  const where = {};
  if (usfId) where.usfId = usfId;
  if (room) where.room = room;
  if (status) where.status = status;
  if (categoryId) where.categoryId = categoryId;
  if (priority) where.priority = priority;
  if (assigneeId) where.assigneeId = assigneeId;

  if (q) {
    where.OR = [
      { title: { contains: q } },
      { description: { contains: q } }
    ];
  }

  const [tickets, usfs, categories, techs] = await Promise.all([
    prisma.ticket.findMany({
      where,
      include: { usf: true, sector: true, roomRef: true, category: true, requester: true, assignee: true },
      orderBy: { updatedAt: 'desc' }
    }),
    prisma.usf.findMany({ orderBy: { id: 'asc' } }),
    prisma.category.findMany({ where: { ativo: true }, orderBy: [{ system: 'desc' }, { nome: 'asc' }] }),
    prisma.user.findMany({ where: { role: 'TECH', ativo: true }, orderBy: { nome: 'asc' } })
  ]);

  res.render('tech/queue', {
    title: 'Fila TI',
    tickets,
    usfs,
    categories,
    techs,
    filters: { q, usfId: usfId || '', room, status, categoryId: categoryId || '', priority, assigneeId: assigneeId || '' }
  });
});

router.get('/tickets/:id', requireRole('TECH', 'ADMIN'), async (req, res) => {
  const prisma = getPrisma();
  const id = Number(req.params.id);

  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: {
      usf: true,
      sector: true,
      roomRef: true,
      category: true,
      requester: true,
      assignee: true,
      insumosUtilizados: { include: { insumo: true }, orderBy: { dataUso: 'desc' } },
      attachments: true,
      messages: { include: { author: true }, orderBy: { createdAt: 'asc' } }
    }
  });

  if (!ticket) return res.status(404).send('Chamado não encontrado.');
  if (!canViewTicket(req.user, ticket)) return res.status(403).send('Acesso negado.');

  const [techs, insumos] = await Promise.all([
    prisma.user.findMany({ where: { role: 'TECH', ativo: true }, orderBy: { nome: 'asc' } }),
    prisma.insumo.findMany({ orderBy: [{ tipo: 'asc' }, { nome: 'asc' }] })
  ]);

  res.render('tech/view', { title: `Atender #${ticket.id}`, ticket, techs, insumos });
});

// Atribuir / assumir (RF-15)
router.post('/tickets/:id/assign', requireRole('TECH', 'ADMIN'), writeLimiter, async (req, res) => {
  const prisma = getPrisma();
  const id = intId(req.params.id);
  const assigneeId = intId(req.body.assigneeId);
  if (!id) return res.status(404).send('Chamado não encontrado.');

  const ticket = await prisma.ticket.findUnique({ where: { id } });
  if (!ticket) return res.status(404).send('Chamado não encontrado.');

  if (assigneeId) {
    const tech = await prisma.user.findFirst({ where: { id: assigneeId, role: 'TECH', ativo: true } });
    if (!tech) {
      req.flash('error', 'Técnico responsável inválido.');
      return res.redirect(`/tech/tickets/${id}`);
    }
  }

  await prisma.ticket.update({ where: { id }, data: { assigneeId } });
  await logAudit(req.user.id, 'ASSIGN', 'Ticket', id, { assigneeId });

  res.redirect(`/tech/tickets/${id}`);
});

// Atualizar status/prioridade + resolução (somente TECH altera RESOLVED/CLOSED)
router.post('/tickets/:id/update', requireRole('TECH', 'ADMIN'), writeLimiter, async (req, res) => {
  const prisma = getPrisma();
  const id = intId(req.params.id);
  if (!id) return res.status(404).send('Chamado não encontrado.');

  const ticket = await prisma.ticket.findUnique({ where: { id } });
  if (!ticket) return res.status(404).send('Chamado não encontrado.');

  let nextStatus = enumValue(req.body.status, TicketStatuses, ticket.status);
  const nextPriority = enumValue(req.body.priority, Priorities, ticket.priority);

  // resolução (opcional até resolver/fechar)
  const resolution = req.body.resolution ? enumValue(req.body.resolution, TicketResolutions, null) : null;
  const trocaPecas = String(req.body.trocaPecas || '').trim() || null;
  const trocaData = req.body.trocaData ? new Date(req.body.trocaData) : null;
  const equipamentoPatrimonio = String(req.body.equipamentoPatrimonio || '').trim() || null;
  const resolutionJustificativa = String(req.body.resolutionJustificativa || '').trim() || null;
  const resolutionAcaoRecomendada = String(req.body.resolutionAcaoRecomendada || '').trim() || null;
  const insumosUso = parseInsumosUso(req.body);

  // ADMIN não resolve/fecha (regra simples: apenas TECH)
  if (req.user.role !== 'TECH' && (nextStatus === 'RESOLVED' || nextStatus === 'CLOSED')) {
    req.flash('error', 'Apenas Técnico TI pode resolver/fechar chamados.');
    return res.redirect(`/tech/tickets/${id}`);
  }

  // Validações de resolução
  const resolving = (nextStatus === 'RESOLVED' || nextStatus === 'CLOSED');
  if (resolving && !resolution) {
    req.flash('error', 'Informe a Resolução do chamado para resolver/fechar.');
    return res.redirect(`/tech/tickets/${id}`);
  }

  if (resolution === 'RESOLVIDO_COM_TROCA_PECA') {
    if (!trocaPecas || !trocaData) {
      req.flash('error', 'Para "Resolvido com troca de peça", informe Peça(s) utilizada(s) e Data da troca.');
      return res.redirect(`/tech/tickets/${id}`);
    }
  }

  if (resolution === 'AGUARDANDO_PECA_SEM_ESTOQUE') {
    // impede encerramento e força status de espera
    if (nextStatus === 'RESOLVED' || nextStatus === 'CLOSED') {
      req.flash('error', 'Quando "Aguardando peça (sem estoque)", o chamado não pode ser encerrado.');
      return res.redirect(`/tech/tickets/${id}`);
    }
    nextStatus = 'WAITING';
  }

  if (resolution === 'SEM_REPARO_EQUIPAMENTO_CONDENADO') {
    if (!resolutionJustificativa || !resolutionAcaoRecomendada) {
      req.flash('error', 'Para "Sem reparo", informe justificativa e ação recomendada.');
      return res.redirect(`/tech/tickets/${id}`);
    }
  }

  const now = new Date();
  const data = { status: nextStatus, priority: nextPriority };

  if (req.user.role === 'TECH' && !ticket.firstResponseAt && nextStatus === 'IN_PROGRESS') {
    data.firstResponseAt = now;
    if (now > ticket.responseDueAt) data.responseBreachedAt = now;
    await logAudit(req.user.id, 'SLA_FIRST_RESPONSE', 'Ticket', id, { at: now, source: 'status_update' });
  }

  // Prioridade mudou: recalcula deadlines base + soma pausa acumulada
  if (nextPriority !== ticket.priority) {
    if (!ticket.firstResponseAt) {
      data.responseDueAt = computeSlaDates(ticket.createdAt, nextPriority).responseDueAt;
    }
    if (!ticket.resolvedAt) {
      const base = computeSlaDates(ticket.createdAt, nextPriority).resolutionDueAt;
      data.resolutionDueAt = addMinutes(base, ticket.slaPausedTotalMin);
    }
    await logAudit(req.user.id, 'PRIORITY_CHANGE', 'Ticket', id, { from: ticket.priority, to: nextPriority });
  }

  // Pausa de SLA por status
  const wasPaused = isResolutionPausedStatus(ticket.status);
  const willPause = isResolutionPausedStatus(nextStatus);

  if (!wasPaused && willPause) {
    data.slaPausedAt = now;
    await logAudit(req.user.id, 'SLA_PAUSE', 'Ticket', id, { status: nextStatus });
  }

  if (wasPaused && !willPause && ticket.slaPausedAt) {
    const pausedMin = businessMinutesBetween(ticket.slaPausedAt, now);
    data.slaPausedAt = null;
    data.slaPausedTotalMin = ticket.slaPausedTotalMin + pausedMin;
    data.resolutionDueAt = addMinutes(ticket.resolutionDueAt, pausedMin);
    await logAudit(req.user.id, 'SLA_RESUME', 'Ticket', id, { pausedMin });
  }

  // Resolver/fechar marca resolvedAt e breach
  if (resolving && !ticket.resolvedAt) {
    data.resolvedAt = now;
    if (now > ticket.resolutionDueAt) data.resolutionBreachedAt = now;
    await logAudit(req.user.id, 'SLA_RESOLUTION_DONE', 'Ticket', id, { at: now });
  }

  // Guarda resolução se informada
  if (resolution) {
    data.resolution = resolution;
    data.trocaPecas = trocaPecas;
    data.trocaData = trocaData;
    data.equipamentoPatrimonio = equipamentoPatrimonio;
    data.resolutionJustificativa = resolutionJustificativa;
    data.resolutionAcaoRecomendada = resolutionAcaoRecomendada;
  }

  try {
    await prisma.$transaction(async (tx) => {
      if (resolution === 'RESOLVIDO_COM_TROCA_PECA') {
        await replaceTicketInsumos(tx, id, insumosUso);
      } else if (resolution) {
        await replaceTicketInsumos(tx, id, []);
      }

      await tx.ticket.update({ where: { id }, data });
    });
  } catch (error) {
    req.flash('error', error.message || 'Falha ao atualizar chamado e estoque.');
    return res.redirect(`/tech/tickets/${id}`);
  }

  await logAudit(req.user.id, 'STATUS_CHANGE', 'Ticket', id, { from: ticket.status, to: nextStatus });
  if (resolution === 'RESOLVIDO_COM_TROCA_PECA' && insumosUso.length) {
    await logAudit(req.user.id, 'INSUMO_TICKET_USAGE', 'Ticket', id, { itens: insumosUso });
  }

  req.flash('success', 'Chamado atualizado.');
  res.redirect(`/tech/tickets/${id}`);
});

// Visualizar Insumos (Tech pode ver estoque)
router.get('/insumos', requireRole('TECH', 'ADMIN'), async (req, res) => {
  const prisma = getPrisma();
  const insumos = await prisma.insumo.findMany({ orderBy: { nome: 'asc' } });
  res.render('tech/insumos', { title: 'Estoque de Insumos', insumos });
});

module.exports = router;

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function parseInsumosUso(body) {
  const ids = asArray(body.insumoId);
  const quantities = asArray(body.insumoQuantidade);
  const grouped = new Map();

  ids.forEach((rawId, index) => {
    const insumoId = intId(rawId);
    const quantidade = Math.max(0, Number.parseInt(quantities[index] || 0, 10));
    if (!insumoId || !quantidade) return;
    grouped.set(insumoId, (grouped.get(insumoId) || 0) + quantidade);
  });

  return [...grouped.entries()].map(([insumoId, quantidade]) => ({ insumoId, quantidade }));
}

async function replaceTicketInsumos(tx, ticketId, itens) {
  const existing = await tx.insumoHistorico.findMany({ where: { ticketId } });
  const restoreByInsumo = new Map();
  for (const item of existing) {
    restoreByInsumo.set(item.insumoId, (restoreByInsumo.get(item.insumoId) || 0) + item.quantidade);
  }

  const ids = [...new Set([...itens.map((item) => item.insumoId), ...restoreByInsumo.keys()])];
  const insumos = ids.length
    ? await tx.insumo.findMany({ where: { id: { in: ids } } })
    : [];
  const byId = new Map(insumos.map((item) => [item.id, item]));

  for (const item of itens) {
    const insumo = byId.get(item.insumoId);
    if (!insumo) throw new Error('Insumo selecionado não encontrado.');
    const disponivelAposRestaurar = insumo.quantidadeAtual + (restoreByInsumo.get(item.insumoId) || 0);
    if (item.quantidade > disponivelAposRestaurar) {
      throw new Error(`Estoque insuficiente para ${insumo.nome}. Disponível: ${disponivelAposRestaurar}.`);
    }
  }

  for (const [insumoId, quantidade] of restoreByInsumo.entries()) {
    await tx.insumo.update({
      where: { id: insumoId },
      data: { quantidadeAtual: { increment: quantidade } }
    });
  }

  await tx.insumoHistorico.deleteMany({ where: { ticketId } });

  for (const item of itens) {
    const updated = await tx.insumo.updateMany({
      where: { id: item.insumoId, quantidadeAtual: { gte: item.quantidade } },
      data: { quantidadeAtual: { decrement: item.quantidade } }
    });
    if (updated.count !== 1) {
      const insumo = byId.get(item.insumoId);
      throw new Error(`Estoque insuficiente para ${insumo?.nome || 'insumo selecionado'}.`);
    }
    await tx.insumoHistorico.create({
      data: {
        ticketId,
        insumoId: item.insumoId,
        quantidade: item.quantidade
      }
    });
  }
}
