const path = require('path');
const express = require('express');
const { getPrisma } = require('../db');
const { requireRole, canViewTicket, canCommentTicket } = require('../middleware/auth');
const { buildUploadMiddleware, getUploadRoot } = require('../middleware/upload');
const { uploadLimiter, writeLimiter } = require('../middleware/rateLimit');
const { logAudit } = require('../middleware/audit');
const { addBusinessMinutes, computeSlaDates } = require('../utils/sla');
const { isInternalStaff } = require('../utils/security');
const {
  LegacyRooms,
  MessageVisibilities,
  cleanText,
  enumValue,
  intId
} = require('../utils/validation');

const upload = buildUploadMiddleware();
const router = express.Router();
const maxUploadFiles = Number(process.env.UPLOAD_MAX_FILES || 5);

async function buildLocationsPayload(prisma, user) {
  const isAdminOrTech = user.role === 'ADMIN' || user.role === 'TECH';
  const sectors = await prisma.sector.findMany({
    where: {
      ativo: true,
      ...(isAdminOrTech ? {} : { usfId: user.usfId })
    },
    include: {
      rooms: {
        where: { ativo: true },
        orderBy: { nome: 'asc' }
      }
    },
    orderBy: [{ usfId: 'asc' }, { nome: 'asc' }]
  });

  return sectors.map((sector) => ({
    id: sector.id,
    usfId: sector.usfId,
    nome: sector.nome,
    rooms: sector.rooms.map((room) => ({
      id: room.id,
      nome: room.nome,
      legacyRoom: room.legacyRoom || 'OUTRO'
    }))
  }));
}

async function resolveLocation(prisma, { usfId, roomId, legacyRoom }) {
  if (roomId) {
    const room = await prisma.room.findFirst({
      where: {
        id: roomId,
        usfId,
        ativo: true,
        sector: { ativo: true }
      },
      include: { sector: true }
    });

    if (!room) return null;
    return {
      roomId: room.id,
      sectorId: room.sectorId,
      legacyRoom: room.legacyRoom || 'OUTRO'
    };
  }

  const fallback = enumValue(legacyRoom, LegacyRooms, null);
  if (!fallback) return null;
  return { roomId: null, sectorId: null, legacyRoom: fallback };
}

// Meus chamados
router.get('/my', requireRole('REQUESTER', 'COORDINATOR', 'TECH', 'ADMIN'), async (req, res) => {
  const prisma = getPrisma();
  const tickets = await prisma.ticket.findMany({
    where: { requesterId: req.user.id },
    include: { category: true, usf: true, assignee: true, sector: true, roomRef: true },
    orderBy: { updatedAt: 'desc' }
  });

  res.render('tickets/my_list', { title: 'Meus chamados', tickets });
});

// Abrir chamado
router.get('/new', requireRole('REQUESTER', 'COORDINATOR', 'TECH', 'ADMIN'), async (req, res) => {
  const prisma = getPrisma();
  const isAdminOrTech = req.user.role === 'ADMIN' || req.user.role === 'TECH';

  const [categories, usfs, locations] = await Promise.all([
    prisma.category.findMany({
      where: { ativo: true },
      orderBy: [{ system: 'desc' }, { nome: 'asc' }]
    }),
    isAdminOrTech
      ? prisma.usf.findMany({ orderBy: { nome: 'asc' } })
      : Promise.resolve([]),
    buildLocationsPayload(prisma, req.user)
  ]);

  res.render('tickets/new', {
    title: 'Abrir chamado',
    categories,
    rooms: LegacyRooms,
    usfs,
    locations,
    isAdminOrTech
  });
});

// Criar chamado
router.post(
  '/new',
  requireRole('REQUESTER', 'COORDINATOR', 'TECH', 'ADMIN'),
  uploadLimiter,
  upload.array('attachments', maxUploadFiles),
  async (req, res) => {
    try {
      const prisma = getPrisma();
      const isAdminOrTech = req.user.role === 'ADMIN' || req.user.role === 'TECH';

      const title = cleanText(req.body.title, { max: 140, required: true });
      const description = cleanText(req.body.description, { max: 10000, required: true });
      const categoryId = intId(req.body.categoryId);
      const roomId = intId(req.body.roomId);
      const legacyRoom = enumValue(req.body.room, LegacyRooms, null);

      let usfId = req.user.usfId;
      if (isAdminOrTech && req.body.usfId) {
        usfId = intId(req.body.usfId);
        const usf = usfId ? await prisma.usf.findUnique({ where: { id: usfId } }) : null;
        if (!usf) {
          req.flash('error', 'Unidade de Saúde inválida.');
          return res.redirect('/tickets/new');
        }
      }

      const location = await resolveLocation(prisma, { usfId, roomId, legacyRoom });
      if (!location) {
        req.flash('error', 'Selecione uma sala/local válido.');
        return res.redirect('/tickets/new');
      }

      if (!categoryId) {
        req.flash('error', 'Selecione uma categoria.');
        return res.redirect('/tickets/new');
      }
      if (!title) {
        req.flash('error', 'Informe o título.');
        return res.redirect('/tickets/new');
      }
      if (!description) {
        req.flash('error', 'Informe a descrição.');
        return res.redirect('/tickets/new');
      }

      const cat = await prisma.category.findUnique({ where: { id: categoryId } });
      if (!cat || !cat.ativo) {
        req.flash('error', 'Categoria inválida ou desativada.');
        return res.redirect('/tickets/new');
      }

      const priority = cat.defaultPriority || 'MEDIUM';
      const now = new Date();
      const { responseDueAt } = computeSlaDates(now, priority);
      const resolutionDueAt = cat.slaHours
        ? addBusinessMinutes(now, cat.slaHours * 60)
        : computeSlaDates(now, priority).resolutionDueAt;

      const ticket = await prisma.ticket.create({
        data: {
          usfId,
          sectorId: location.sectorId,
          roomId: location.roomId,
          requesterId: req.user.id,
          room: location.legacyRoom,
          categoryId,
          title,
          description,
          priority,
          responseDueAt,
          resolutionDueAt
        }
      });

      await logAudit(req.user.id, 'TICKET_CREATE', 'Ticket', ticket.id, {
        usfId,
        sectorId: location.sectorId,
        roomId: location.roomId,
        room: location.legacyRoom,
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
              storagePath: f.path,
              visibility: 'PUBLIC'
            }
          });
        }
        await logAudit(req.user.id, 'ATTACH_UPLOAD', 'Ticket', ticket.id, { count: req.files.length, visibility: 'PUBLIC' });
      }

      req.flash('success', `Seu chamado foi criado com sucesso! (#${ticket.id})`);
      return req.session.save(() => res.redirect(`/tickets/${ticket.id}`));
    } catch (e) {
      console.error('ERRO criando ticket:', e);
      req.flash('error', 'Falha ao criar chamado. Verifique os dados e tente novamente.');
      return res.redirect('/tickets/new');
    }
  }
);

// Detalhe
router.get('/:id', requireRole('REQUESTER', 'COORDINATOR', 'TECH', 'ADMIN'), async (req, res) => {
  const prisma = getPrisma();
  const id = intId(req.params.id);
  if (!id) return res.status(404).send('Chamado não encontrado.');

  const staff = isInternalStaff(req.user);
  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: {
      usf: true,
      sector: true,
      roomRef: true,
      category: true,
      requester: true,
      assignee: true,
      attachments: {
        where: staff ? {} : { visibility: 'PUBLIC' },
        orderBy: { createdAt: 'asc' }
      },
      messages: {
        where: staff ? {} : { visibility: 'PUBLIC' },
        include: { author: true },
        orderBy: { createdAt: 'asc' }
      }
    }
  });

  if (!ticket) return res.status(404).send('Chamado não encontrado.');
  if (!canViewTicket(req.user, ticket)) return res.status(403).send('Acesso negado.');

  res.render('tickets/view', { title: `Chamado #${ticket.id}`, ticket });
});

// Mensagens
router.post(
  '/:id/message',
  requireRole('REQUESTER', 'COORDINATOR', 'TECH', 'ADMIN'),
  writeLimiter,
  uploadLimiter,
  upload.array('attachments', maxUploadFiles),
  async (req, res) => {
    const prisma = getPrisma();
    const id = intId(req.params.id);
    const body = cleanText(req.body.body, { max: 10000, required: true });
    const visibility = enumValue(req.body.visibility, MessageVisibilities, 'PUBLIC');

    if (!id) return res.status(404).send('Chamado não encontrado.');

    const ticket = await prisma.ticket.findUnique({ where: { id } });
    if (!ticket) return res.status(404).send('Chamado não encontrado.');
    if (!canCommentTicket(req.user, ticket)) return res.status(403).send('Acesso negado.');
    if (!body) return res.redirect(`/tickets/${id}`);

    let finalVisibility = 'PUBLIC';
    if (isInternalStaff(req.user) && (visibility === 'INTERNAL' || visibility === 'PUBLIC')) {
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
            storagePath: f.path,
            visibility: finalVisibility
          }
        });
      }
      await logAudit(req.user.id, 'ATTACH_UPLOAD', 'Ticket', id, { count: req.files.length, visibility: finalVisibility });
    }

    await prisma.ticket.update({ where: { id }, data: {} });

    req.flash('success', 'Mensagem enviada com sucesso.');
    return req.session.save(() => res.redirect(`/tickets/${id}`));
  }
);

// Download de anexo
router.get('/:id/attachments/:attId', requireRole('REQUESTER', 'COORDINATOR', 'TECH', 'ADMIN'), async (req, res) => {
  const prisma = getPrisma();
  const id = intId(req.params.id);
  const attId = intId(req.params.attId);
  if (!id || !attId) return res.status(404).send('Arquivo não encontrado.');

  const ticket = await prisma.ticket.findUnique({ where: { id } });
  if (!ticket) return res.status(404).send('Chamado não encontrado.');
  if (!canViewTicket(req.user, ticket)) return res.status(403).send('Acesso negado.');

  const att = await prisma.ticketAttachment.findUnique({ where: { id: attId } });
  if (!att || att.ticketId !== id) return res.status(404).send('Arquivo não encontrado.');
  if (att.visibility === 'INTERNAL' && !isInternalStaff(req.user)) {
    return res.status(403).send('Acesso negado.');
  }

  const uploadRoot = getUploadRoot();
  const resolvedPath = path.resolve(att.storagePath);
  if (!resolvedPath.startsWith(`${uploadRoot}${path.sep}`)) {
    return res.status(404).send('Arquivo não encontrado.');
  }

  return res.download(resolvedPath, att.originalName);
});

module.exports = router;
