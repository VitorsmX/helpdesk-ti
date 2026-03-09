const express = require('express');
const { getPrisma } = require('../db');
const { requireRole, canViewTicket, canCommentTicket } = require('../middleware/auth');
const { buildUploadMiddleware } = require('../middleware/upload');
const { logAudit } = require('../middleware/audit');
const { computeSlaDates } = require('../utils/sla');

const upload = buildUploadMiddleware();
const router = express.Router();

// Salas fixas do sistema (inclui TRIAGEM)
const ROOMS = ['RECEPCAO', 'ENFERMAGEM', 'MEDICO', 'REUNIAO', 'VACINA', 'TRIAGEM'];
const allowedRooms = new Set(ROOMS);

// Meus chamados
router.get('/my', requireRole('REQUESTER', 'COORDINATOR', 'TECH', 'ADMIN'), async (req, res) => {
  const prisma = getPrisma();
  const tickets = await prisma.ticket.findMany({
    where: { requesterId: req.user.id },
    include: { category: true, usf: true, assignee: true },
    orderBy: { updatedAt: 'desc' }
  });

  res.render('tickets/my_list', { title: 'Meus chamados', tickets });
});

// Abrir chamado
router.get('/new', requireRole('REQUESTER', 'COORDINATOR', 'TECH', 'ADMIN'), async (req, res) => {
  const prisma = getPrisma();
  const isAdminOrTech = req.user.role === 'ADMIN' || req.user.role === 'TECH';

  const [categories, usfs] = await Promise.all([
    prisma.category.findMany({
      where: { ativo: true },
      orderBy: [{ system: 'desc' }, { nome: 'asc' }]
    }),
    isAdminOrTech
      ? prisma.usf.findMany({ orderBy: { nome: 'asc' } })
      : Promise.resolve([])
  ]);

  res.render('tickets/new', {
    title: 'Abrir chamado',
    categories,
    rooms: ROOMS,
    usfs,
    isAdminOrTech
  });
});

// Criar chamado
router.post('/new', requireRole('REQUESTER', 'COORDINATOR', 'TECH', 'ADMIN'), upload.array('attachments', 5), async (req, res) => {
  try {
    const prisma = getPrisma();
    const isAdminOrTech = req.user.role === 'ADMIN' || req.user.role === 'TECH';

    const room = String(req.body.room || '');
    const title = String(req.body.title || '').trim();
    const description = String(req.body.description || '').trim();
    const categoryId = Number(req.body.categoryId);

    // USF: Admin/TECH podem selecionar qualquer unidade; demais usam a própria
    let usfId = req.user.usfId;
    if (isAdminOrTech && req.body.usfId) {
      usfId = Number(req.body.usfId);
      const usf = await prisma.usf.findUnique({ where: { id: usfId } });
      if (!usf) {
        req.flash('error', 'Unidade de Saúde inválida.');
        return res.redirect('/tickets/new');
      }
    }

    console.log('POST /tickets/new body=', req.body);
    console.log('files=', (req.files || []).length);

    // validação básica
    if (!allowedRooms.has(room)) {
      req.flash('error', 'Selecione uma Sala válida.');
      return res.redirect('/tickets/new');
    }
    if (!categoryId) {
      req.flash('error', 'Selecione uma Categoria.');
      return res.redirect('/tickets/new');
    }
    if (!title) {
      req.flash('error', 'Informe o Título.');
      return res.redirect('/tickets/new');
    }
    if (!description) {
      req.flash('error', 'Informe a Descrição.');
      return res.redirect('/tickets/new');
    }

    const cat = await prisma.category.findUnique({ where: { id: categoryId } });
    if (!cat || !cat.ativo) {
      req.flash('error', 'Categoria inválida ou desativada.');
      return res.redirect('/tickets/new');
    }

    const now = new Date();
    let responseDueAt, resolutionDueAt;
    
    // SLA Personalizado da Categoria
    if (cat.slaHours) {
       const { addBusinessMinutes } = require('../utils/sla');
       // Usa responseDueAt padrão da prioridade para prazo de resposta
       const { responseDueAt: resp } = computeSlaDates(now, cat.defaultPriority || 'MEDIUM');
       responseDueAt = resp;
       resolutionDueAt = addBusinessMinutes(now, cat.slaHours * 60);

    } else {
       // SLA baseado em Prioridade Padrão
       const { responseDueAt: resp, resolutionDueAt: resol } = computeSlaDates(now, cat.defaultPriority || 'MEDIUM');
       responseDueAt = resp;
       resolutionDueAt = resol;
    }

    const ticket = await prisma.ticket.create({
      data: {
        usfId,
        requesterId: req.user.id,
        room,
        categoryId,
        title,
        description,
        responseDueAt,
        resolutionDueAt
      }
    });

    await logAudit(req.user.id, 'TICKET_CREATE', 'Ticket', ticket.id, {
      usfId,
      room,
      categoryId
    });

    await prisma.ticketMessage.create({
      data: {
        ticketId: ticket.id,
        authorId: req.user.id,
        body: `Abertura do chamado:\n${description}`,
        visibility: 'PUBLIC'
      }
    });

    if (req.files && req.files.length) {
      for (const f of req.files) {
        await prisma.ticketAttachment.create({
          data: {
            ticketId: ticket.id,
            uploadedById: req.user.id,
            originalName: f.originalname,
            storedName: f.filename,
            mimeType: f.mimetype,
            sizeBytes: f.size,
            storagePath: f.path
          }
        });
      }
      await logAudit(req.user.id, 'ATTACH_UPLOAD', 'Ticket', ticket.id, { count: req.files.length });
    }

    // Mensagem de sucesso (Bootstrap alert)
    req.flash('success', `Seu chamado foi criado com sucesso! (#${ticket.id})`);

    // garante gravar flash na sessão antes do redirect
    return req.session.save(() => res.redirect(`/tickets/${ticket.id}`));
  } catch (e) {
    console.error('ERRO criando ticket:', e);
    req.flash('error', 'Falha ao criar chamado. Verifique o terminal (erro do servidor).');
    return res.redirect('/tickets/new');
  }
});

// Detalhe
router.get('/:id', requireRole('REQUESTER', 'COORDINATOR', 'TECH', 'ADMIN'), async (req, res) => {
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

  res.render('tickets/view', { title: `Chamado #${ticket.id}`, ticket });
});

// Mensagens
router.post('/:id/message', requireRole('REQUESTER', 'COORDINATOR', 'TECH', 'ADMIN'), upload.array('attachments', 5), async (req, res) => {
  const prisma = getPrisma();
  const id = Number(req.params.id);
  const body = String(req.body.body || '').trim();
  const visibility = String(req.body.visibility || 'PUBLIC');

  const ticket = await prisma.ticket.findUnique({ where: { id } });
  if (!ticket) return res.status(404).send('Chamado não encontrado.');
  if (!canCommentTicket(req.user, ticket)) return res.status(403).send('Acesso negado.');
  if (!body) return res.redirect(`/tickets/${id}`);

  let finalVisibility = 'PUBLIC';
  if ((req.user.role === 'TECH' || req.user.role === 'ADMIN') && (visibility === 'INTERNAL' || visibility === 'PUBLIC')) {
    finalVisibility = visibility;
  }

  const now = new Date();

  if (req.user.role === 'TECH' && !ticket.firstResponseAt) {
    await prisma.ticket.update({
      where: { id },
      data: {
        firstResponseAt: now,
        ...(now > ticket.responseDueAt ? { responseBreachedAt: now } : {})
      }
    });
    await logAudit(req.user.id, 'SLA_FIRST_RESPONSE', 'Ticket', id, { at: now });
  }

  await prisma.ticketMessage.create({
    data: { ticketId: id, authorId: req.user.id, body, visibility: finalVisibility }
  });
  await logAudit(req.user.id, 'MESSAGE_CREATE', 'Ticket', id, { visibility: finalVisibility });

  if (req.files && req.files.length) {
    for (const f of req.files) {
      await prisma.ticketAttachment.create({
        data: {
          ticketId: id,
          uploadedById: req.user.id,
          originalName: f.originalname,
          storedName: f.filename,
          mimeType: f.mimetype,
          sizeBytes: f.size,
          storagePath: f.path
        }
      });
    }
    await logAudit(req.user.id, 'ATTACH_UPLOAD', 'Ticket', id, { count: req.files.length });
  }

  await prisma.ticket.update({ where: { id }, data: {} });

  req.flash('success', 'Mensagem enviada com sucesso.');
  return req.session.save(() => res.redirect(`/tickets/${id}`));
});

// Download de anexo
router.get('/:id/attachments/:attId', requireRole('REQUESTER', 'COORDINATOR', 'TECH', 'ADMIN'), async (req, res) => {
  const prisma = getPrisma();
  const id = Number(req.params.id);
  const attId = Number(req.params.attId);

  const ticket = await prisma.ticket.findUnique({ where: { id } });
  if (!ticket) return res.status(404).send('Chamado não encontrado.');
  if (!canViewTicket(req.user, ticket)) return res.status(403).send('Acesso negado.');

  const att = await prisma.ticketAttachment.findUnique({ where: { id: attId } });
  if (!att || att.ticketId !== id) return res.status(404).send('Arquivo não encontrado.');

  res.download(att.storagePath, att.originalName);
});

module.exports = router;
