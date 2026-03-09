const express = require('express');
const { getPrisma } = require('../db');
const { requireRole, canViewTicket } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');
const { computeSlaDates, businessMinutesBetween, isResolutionPausedStatus, addMinutes } = require('../utils/sla');

const router = express.Router();

router.get('/tickets', requireRole('TECH', 'ADMIN'), async (req, res) => {
  const prisma = getPrisma();

  const q = String(req.query.q || '').trim();
  const usfId = req.query.usfId ? Number(req.query.usfId) : null;
  const room = String(req.query.room || '').trim();
  const status = String(req.query.status || '').trim();
  const categoryId = req.query.categoryId ? Number(req.query.categoryId) : null;
  const priority = String(req.query.priority || '').trim();
  const assigneeId = req.query.assigneeId ? Number(req.query.assigneeId) : null;

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
      include: { usf: true, category: true, requester: true, assignee: true },
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
      category: true,
      requester: true,
      assignee: true,
      attachments: true,
      messages: { include: { author: true }, orderBy: { createdAt: 'asc' } }
    }
  });

  if (!ticket) return res.status(404).send('Chamado não encontrado.');
  if (!canViewTicket(req.user, ticket)) return res.status(403).send('Acesso negado.');

  const techs = await prisma.user.findMany({ where: { role: 'TECH', ativo: true }, orderBy: { nome: 'asc' } });

  res.render('tech/view', { title: `Atender #${ticket.id}`, ticket, techs });
});

// Atribuir / assumir (RF-15)
router.post('/tickets/:id/assign', requireRole('TECH', 'ADMIN'), async (req, res) => {
  const prisma = getPrisma();
  const id = Number(req.params.id);
  const assigneeId = req.body.assigneeId ? Number(req.body.assigneeId) : null;

  const ticket = await prisma.ticket.findUnique({ where: { id } });
  if (!ticket) return res.status(404).send('Chamado não encontrado.');

  await prisma.ticket.update({ where: { id }, data: { assigneeId } });
  await logAudit(req.user.id, 'ASSIGN', 'Ticket', id, { assigneeId });

  res.redirect(`/tech/tickets/${id}`);
});

// Atualizar status/prioridade + resolução (somente TECH altera RESOLVED/CLOSED)
router.post('/tickets/:id/update', requireRole('TECH', 'ADMIN'), async (req, res) => {
  const prisma = getPrisma();
  const id = Number(req.params.id);

  const ticket = await prisma.ticket.findUnique({ where: { id } });
  if (!ticket) return res.status(404).send('Chamado não encontrado.');

  const nextStatus = String(req.body.status || ticket.status);
  const nextPriority = String(req.body.priority || ticket.priority);

  // resolução (opcional até resolver/fechar)
  const resolution = req.body.resolution ? String(req.body.resolution) : null;
  const trocaPecas = String(req.body.trocaPecas || '').trim() || null;
  const trocaData = req.body.trocaData ? new Date(req.body.trocaData) : null;
  const equipamentoPatrimonio = String(req.body.equipamentoPatrimonio || '').trim() || null;
  const resolutionJustificativa = String(req.body.resolutionJustificativa || '').trim() || null;
  const resolutionAcaoRecomendada = String(req.body.resolutionAcaoRecomendada || '').trim() || null;

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
    // impede encerramento e força status WAITING_PARTS
    if (nextStatus === 'RESOLVED' || nextStatus === 'CLOSED') {
      req.flash('error', 'Quando "Aguardando peça (sem estoque)", o chamado não pode ser encerrado.');
      return res.redirect(`/tech/tickets/${id}`);
    }
  }

  if (resolution === 'SEM_REPARO_EQUIPAMENTO_CONDENADO') {
    if (!resolutionJustificativa || !resolutionAcaoRecomendada) {
      req.flash('error', 'Para "Sem reparo", informe justificativa e ação recomendada.');
      return res.redirect(`/tech/tickets/${id}`);
    }
  }

  const now = new Date();
  const data = { status: nextStatus, priority: nextPriority };

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

  await prisma.ticket.update({ where: { id }, data });
  await logAudit(req.user.id, 'STATUS_CHANGE', 'Ticket', id, { from: ticket.status, to: nextStatus });

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
