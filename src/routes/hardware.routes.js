const express = require('express');
const { getPrisma } = require('../db');
const { requireRole } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');
const { writeLimiter } = require('../middleware/rateLimit');
const { HardwareStatuses, LegacyRooms, cleanText, enumValue, intId } = require('../utils/validation');

const router = express.Router();

// Lista de hardware com filtros (acessível para ADMIN e TECH)
router.get('/', requireRole('ADMIN', 'TECH'), async (req, res) => {
  const prisma = getPrisma();
  const { usfId, patrimonio } = req.query;

  // Verificar se usuário tem permissão (ADMIN ou TECH)
  const where = {};
  if (usfId && usfId !== 'all') {
    where.usfId = Number(usfId);
  }
  if (patrimonio && patrimonio.trim()) {
    where.patrimonio = { contains: patrimonio.trim() };
  }

  const [hardwares, usfs] = await Promise.all([
    prisma.hardware.findMany({
      where,
      include: { usf: true },
      orderBy: [{ usfId: 'asc' }, { patrimonio: 'asc' }]
    }),
    prisma.usf.findMany({ orderBy: { id: 'asc' } })
  ]);

  const viewPath = req.user.role === 'ADMIN' ? 'admin/hardware' : 'tech/hardware';
  res.render(viewPath, {
    title: 'Inventário de Hardware',
    hardwares,
    usfs,
    filters: { usfId: usfId || 'all', patrimonio: patrimonio || '' }
  });
});

// Criar novo hardware (ADMIN only)
router.post('/', requireRole('ADMIN'), writeLimiter, async (req, res) => {
  const prisma = getPrisma();

  const patrimonio = cleanText(req.body.patrimonio, { max: 80 }) || null;
  const usfId = intId(req.body.usfId);
  const sala = enumValue(req.body.sala, LegacyRooms, null);
  const anydesk = cleanText(req.body.anydesk, { max: 80 }) || null;
  const status = enumValue(req.body.status, HardwareStatuses, 'ATIVO');
  const tipo = cleanText(req.body.tipo, { max: 120, required: true });
  const modelo = cleanText(req.body.modelo, { max: 120 }) || null;
  const observacoes = cleanText(req.body.observacoes, { max: 5000 }) || null;

  if (!usfId || !sala || !tipo) {
    req.flash('error', 'Preencha os campos obrigatórios (USF, Sala, Tipo).');
    return res.redirect('/hardware');
  }

  try {
    const newHardware = await prisma.hardware.create({
      data: {
        patrimonio,
        usfId,
        sala,
        anydesk,
        status,
        tipo,
        modelo,
        observacoes
      }
    });

    await logAudit(req.user.id, 'HARDWARE_CREATE', 'Hardware', newHardware.id, {
      patrimonio,
      usfId,
      tipo
    });

    req.flash('success', `Hardware ${patrimonio} cadastrado com sucesso!`);
  } catch (err) {
    req.flash('error', 'Erro ao cadastrar hardware. Patrimônio já existe?');
  }

  res.redirect('/hardware');
});

// Atualizar hardware (ADMIN: todos campos, TECH: apenas anydesk e status)
router.post('/:id/update', requireRole('ADMIN', 'TECH'), writeLimiter, async (req, res) => {
  const prisma = getPrisma();
  const id = intId(req.params.id);
  if (!id) return res.redirect('/hardware');

  const hardware = await prisma.hardware.findUnique({ where: { id } });
  if (!hardware) {
    req.flash('error', 'Hardware não encontrado.');
    return res.redirect('/hardware');
  }

  const data = {};

  if (req.user.role === 'ADMIN') {
    // ADMIN pode editar todos os campos
    const patrimonio = cleanText(req.body.patrimonio, { max: 80 }) || null;
    const usfId = intId(req.body.usfId);
    const sala = enumValue(req.body.sala, LegacyRooms, null);
    const tipo = cleanText(req.body.tipo, { max: 120, required: true });

    if (!usfId || !sala || !tipo) {
      req.flash('error', 'Preencha os campos obrigatórios (USF, Sala, Tipo).');
      return res.redirect('/hardware');
    }

    data.patrimonio = patrimonio;
    data.usfId = usfId;
    data.sala = sala;
    data.tipo = tipo;
    data.modelo = cleanText(req.body.modelo, { max: 120 }) || null;
    data.observacoes = cleanText(req.body.observacoes, { max: 5000 }) || null;
  }

  // ADMIN e TECH podem editar anydesk e status
  data.anydesk = cleanText(req.body.anydesk, { max: 80 }) || null;
  data.status = enumValue(req.body.status, HardwareStatuses, 'ATIVO');

  try {
    await prisma.hardware.update({ where: { id }, data });

    await logAudit(req.user.id, 'HARDWARE_UPDATE', 'Hardware', id, {
      oldData: hardware,
      newData: data
    });

    req.flash('success', 'Hardware atualizado com sucesso!');
  } catch (err) {
    req.flash('error', 'Erro ao atualizar hardware.');
  }

  res.redirect('/hardware');
});

// Mover hardware para outra USF e/ou sala (ADMIN e TECH)
router.post('/:id/move', requireRole('ADMIN'), writeLimiter, async (req, res) => {
  const prisma = getPrisma();
  const id = intId(req.params.id);
  const newUsfId = intId(req.body.usfId);
  const newSala = enumValue(req.body.sala, LegacyRooms, null);

  if (!newUsfId || !newSala) {
    req.flash('error', 'Selecione uma USF e uma sala de destino.');
    return res.redirect('/hardware');
  }

  const hardware = await prisma.hardware.findUnique({ where: { id }, include: { usf: true } });
  if (!hardware) {
    req.flash('error', 'Hardware não encontrado.');
    return res.redirect('/hardware');
  }

  const newUsf = await prisma.usf.findUnique({ where: { id: newUsfId } });
  if (!newUsf) {
    req.flash('error', 'USF de destino não encontrada.');
    return res.redirect('/hardware');
  }

  await prisma.hardware.update({
    where: { id },
    data: { 
      usfId: newUsfId,
      sala: newSala
    }
  });

  await logAudit(req.user.id, 'HARDWARE_MOVE', 'Hardware', id, {
    patrimonio: hardware.patrimonio,
    fromUsf: hardware.usf.nome,
    toUsf: newUsf.nome,
    fromSala: hardware.sala,
    toSala: newSala
  });

  req.flash('success', `Hardware ${hardware.patrimonio} movido para ${newUsf.nome}.`);
  res.redirect('/hardware');
});

// Excluir hardware (ADMIN only)
router.post('/:id/delete', requireRole('ADMIN'), writeLimiter, async (req, res) => {
  const prisma = getPrisma();
  const id = intId(req.params.id);
  if (!id) return res.redirect('/hardware');

  const hardware = await prisma.hardware.findUnique({ where: { id } });
  if (!hardware) {
    req.flash('error', 'Hardware não encontrado.');
    return res.redirect('/hardware');
  }

  await prisma.hardware.delete({ where: { id } });

  await logAudit(req.user.id, 'HARDWARE_DELETE', 'Hardware', id, {
    patrimonio: hardware.patrimonio
  });

  req.flash('success', `Hardware ${hardware.patrimonio || hardware.tipo} excluído.`);
  res.redirect('/hardware');
});

module.exports = router;
