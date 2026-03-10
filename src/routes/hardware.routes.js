const express = require('express');
const { getPrisma } = require('../db');
const { requireRole, requireAuth } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');

const router = express.Router();

// Lista de hardware com filtros (acessível para ADMIN e TECH)
router.get('/', requireAuth, async (req, res) => {
  const prisma = getPrisma();
  const { usfId, patrimonio } = req.query;

  // Verificar se usuário tem permissão (ADMIN ou TECH)
  if (!['ADMIN', 'TECH'].includes(req.user.role)) {
    req.flash('error', 'Acesso negado.');
    return res.redirect('/');
  }

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
router.post('/', requireRole('ADMIN'), async (req, res) => {
  const prisma = getPrisma();

  const patrimonio = String(req.body.patrimonio || '').trim() || null;
  const usfId = Number(req.body.usfId);
  const sala = String(req.body.sala || '');
  const anydesk = String(req.body.anydesk || '').trim() || null;
  const status = String(req.body.status || 'ATIVO');
  const tipo = String(req.body.tipo || '').trim();
  const modelo = String(req.body.modelo || '').trim() || null;
  const observacoes = String(req.body.observacoes || '').trim() || null;

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
router.post('/:id/update', requireAuth, async (req, res) => {
  const prisma = getPrisma();
  const id = Number(req.params.id);

  // Verificar permissão
  if (!['ADMIN', 'TECH'].includes(req.user.role)) {
    req.flash('error', 'Acesso negado.');
    return res.redirect('/');
  }

  const hardware = await prisma.hardware.findUnique({ where: { id } });
  if (!hardware) {
    req.flash('error', 'Hardware não encontrado.');
    return res.redirect('/hardware');
  }

  const data = {};

  if (req.user.role === 'ADMIN') {
    // ADMIN pode editar todos os campos
    const patrimonio = String(req.body.patrimonio || '').trim() || null;
    const usfId = Number(req.body.usfId);
    const sala = String(req.body.sala || '');
    const tipo = String(req.body.tipo || '').trim();

    if (!usfId || !sala || !tipo) {
      req.flash('error', 'Preencha os campos obrigatórios (USF, Sala, Tipo).');
      return res.redirect('/hardware');
    }

    data.patrimonio = patrimonio;
    data.usfId = usfId;
    data.sala = sala;
    data.tipo = tipo;
    data.modelo = String(req.body.modelo || '').trim() || null;
    data.observacoes = String(req.body.observacoes || '').trim() || null;
  }

  // ADMIN e TECH podem editar anydesk e status
  data.anydesk = String(req.body.anydesk || '').trim() || null;
  data.status = String(req.body.status || 'ATIVO');

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
router.post('/:id/move', requireAuth, async (req, res) => {
  const prisma = getPrisma();
  const id = Number(req.params.id);
  const newUsfId = Number(req.body.usfId);
  const newSala = String(req.body.sala || '');

  // Verificar permissão
  if (!['ADMIN', 'TECH'].includes(req.user.role)) {
    req.flash('error', 'Acesso negado.');
    return res.redirect('/');
  }

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
router.post('/:id/delete', requireRole('ADMIN'), async (req, res) => {
  const prisma = getPrisma();
  const id = Number(req.params.id);

  const hardware = await prisma.hardware.findUnique({ where: { id } });
  if (!hardware) {
    req.flash('error', 'Hardware não encontrado.');
    return res.redirect('/hardware');
  }

  await prisma.hardware.delete({ where: { id } });

  await logAudit(req.user.id, 'HARDWARE_DELETE', 'Hardware', id, {
    patrimonio: hardware.patrimonio
  });

  req.flash('success', `Hardware ${hardware.patrimonio} excluído.`);
  res.redirect('/hardware');
});

module.exports = router;
