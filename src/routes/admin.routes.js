const express = require('express');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { getPrisma } = require('../db');
const { requireRole } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');
const { writeLimiter } = require('../middleware/rateLimit');
const { reportLogoUpload } = require('../middleware/settingsUpload');
const { getReportSettings, normalizeReportSettings, upsertSetting, REPORT_SETTINGS_KEY } = require('../services/settings.service');
const { getSystemAssetPath } = require('../utils/systemAssets');
const {
  LegacyRooms,
  Roles,
  Priorities,
  InsumoTipos,
  cleanText,
  enumValue,
  intId,
  passwordIsStrong
} = require('../utils/validation');

const router = express.Router();

function computeRoleFromCargo(cargo) {
  const auto = String(process.env.AUTO_COORDINATOR_FOR_ENFERMEIRO || 'true') === 'true';
  if (!auto) return null;
  const c = (cargo || '').toLowerCase();
  if (c.includes('enfermeiro')) return 'COORDINATOR';
  return null;
}

function cleanEmail(value) {
  const email = cleanText(value, { max: 160 });
  if (!email) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email.toLowerCase() : null;
}

async function activeAdminCount(prisma) {
  return prisma.user.count({ where: { role: 'ADMIN', ativo: true } });
}

async function wouldRemoveLastActiveAdmin(prisma, user, nextRole = user.role, nextAtivo = user.ativo) {
  if (user.role !== 'ADMIN' || !user.ativo) return false;
  const removingAdminAccess = nextRole !== 'ADMIN' || nextAtivo === false;
  if (!removingAdminAccess) return false;
  return (await activeAdminCount(prisma)) <= 1;
}

function validateSlaHours(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 720 ? parsed : null;
}

router.get('/', requireRole('ADMIN'), async (req, res) => {
  // Monitoring stats are now provided by middleware in res.locals.monitoringStats
  res.render('admin/home', { 
    title: 'Admin'
  });
});

// Logs de Auditoria (with alias)
router.get('/audit-logs', requireRole('ADMIN'), async (req, res) => {
  return res.redirect('/admin/audit');
});

router.get('/audit', requireRole('ADMIN'), async (req, res) => {
  const prisma = getPrisma();
  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    include: { actor: true },
    take: 100
  });
  res.render('admin/audit', { title: 'Logs de Auditoria', logs });
});

// Equipamentos Condenados (with alias)
router.get('/condemned-assets', requireRole('ADMIN'), async (req, res) => {
  return res.redirect('/admin/condemned');
});

// Aguardando Peças (new route)
router.get('/waiting-parts', requireRole('ADMIN'), async (req, res) => {
  const prisma = getPrisma();
  const tickets = await prisma.ticket.findMany({
    where: { 
      OR: [
        { status: 'WAITING' },
        { resolution: 'AGUARDANDO_PECA_SEM_ESTOQUE' }
      ]
    },
    include: { usf: true, category: true, assignee: true, requester: true },
    orderBy: { updatedAt: 'desc' },
    take: 50
  });
  res.render('admin/waiting_parts', { title: 'Aguardando Peças', tickets });
});

// SLA Breached
router.get('/sla-breached', requireRole('ADMIN'), async (req, res) => {
  const prisma = getPrisma();
  const now = new Date();
  const breached = await prisma.ticket.findMany({
    where: {
      status: { in: ['OPEN', 'IN_PROGRESS', 'WAITING'] },
      OR: [
        { responseBreachedAt: { not: null } },
        { resolutionBreachedAt: { not: null } },
        { firstResponseAt: null, responseDueAt: { lt: now } },
        { resolvedAt: null, resolutionDueAt: { lt: now } }
      ]
    },
    include: { usf: true, sector: true, roomRef: true, category: true, assignee: true },
    orderBy: { createdAt: 'desc' }
  });
  res.render('admin/sla_breached', { title: 'SLA Estourado', tickets: breached });
});

// USFs
router.get('/usfs', requireRole('ADMIN'), async (req, res) => {
  const prisma = getPrisma();
  const usfs = await prisma.usf.findMany({ orderBy: { id: 'asc' } });
  res.render('admin/usfs', { title: 'USFs', usfs });
});

router.post('/usfs', requireRole('ADMIN'), writeLimiter, async (req, res) => {
  const prisma = getPrisma();
  const nome = cleanText(req.body.nome, { max: 120, required: true });
  if (!nome) return res.redirect('/admin/usfs');

  try {
    const usf = await prisma.usf.create({
      data: {
        nome,
        ipOnt: cleanText(req.body.ipOnt, { max: 80 }) || null,
        modeloSwitch: cleanText(req.body.modeloSwitch, { max: 120 }) || null,
        provedorInternet: cleanText(req.body.provedorInternet, { max: 120 }) || null
      }
    });
    await logAudit(req.user.id, 'USF_CREATE', 'USF', usf.id, { nome });
  } catch (err) {
    req.flash('error', 'Falha ao criar unidade. Verifique se ela já existe.');
  }
  res.redirect('/admin/usfs');
});

router.post('/usfs/:id/update', requireRole('ADMIN'), writeLimiter, async (req, res) => {
  const prisma = getPrisma();
  const id = intId(req.params.id);
  const nome = cleanText(req.body.nome, { max: 120, required: true });
  if (!id || !nome) return res.redirect('/admin/usfs');

  try {
    const updated = await prisma.usf.update({
      where: { id },
      data: {
        nome,
        ipOnt: cleanText(req.body.ipOnt, { max: 80 }) || null,
        modeloSwitch: cleanText(req.body.modeloSwitch, { max: 120 }) || null,
        provedorInternet: cleanText(req.body.provedorInternet, { max: 120 }) || null
      }
    });
    await logAudit(req.user.id, 'USF_UPDATE', 'USF', id, { nome: updated.nome });
    req.flash('success', 'Unidade atualizada.');
  } catch (err) {
    req.flash('error', 'Falha ao atualizar unidade. Verifique se o nome já existe.');
  }
  res.redirect('/admin/usfs');
});

router.post('/usfs/:id/delete', requireRole('ADMIN'), writeLimiter, async (req, res) => {
  const prisma = getPrisma();
  const id = intId(req.params.id);
  if (!id) return res.redirect('/admin/usfs');

  const [usf, users, tickets, hardwares, sectors] = await Promise.all([
    prisma.usf.findUnique({ where: { id } }),
    prisma.user.count({ where: { usfId: id } }),
    prisma.ticket.count({ where: { usfId: id } }),
    prisma.hardware.count({ where: { usfId: id } }),
    prisma.sector.count({ where: { usfId: id } })
  ]);

  if (!usf) return res.redirect('/admin/usfs');
  if (users || tickets || hardwares || sectors) {
    req.flash('error', 'Esta unidade possui vínculos e não pode ser excluída. Edite os dados ou desative vínculos relacionados.');
    return res.redirect('/admin/usfs');
  }

  await prisma.usf.delete({ where: { id } });
  await logAudit(req.user.id, 'USF_DELETE', 'USF', id, { nome: usf.nome });
  req.flash('success', 'Unidade excluída.');
  res.redirect('/admin/usfs');
});

// Setores e salas por unidade
router.get('/locations', requireRole('ADMIN'), async (req, res) => {
  const prisma = getPrisma();
  const usfs = await prisma.usf.findMany({
    include: {
      sectors: {
        include: { rooms: { orderBy: { nome: 'asc' } } },
        orderBy: { nome: 'asc' }
      }
    },
    orderBy: { nome: 'asc' }
  });

  res.render('admin/locations', {
    title: 'Setores e Salas',
    usfs,
    legacyRooms: LegacyRooms
  });
});

router.post('/locations/sectors', requireRole('ADMIN'), writeLimiter, async (req, res) => {
  const prisma = getPrisma();
  const usfId = intId(req.body.usfId);
  const nome = cleanText(req.body.nome, { max: 120, required: true });

  if (!usfId || !nome) {
    req.flash('error', 'Selecione a unidade e informe o nome do setor.');
    return res.redirect('/admin/locations');
  }

  const usf = await prisma.usf.findUnique({ where: { id: usfId } });
  if (!usf) {
    req.flash('error', 'Unidade não encontrada.');
    return res.redirect('/admin/locations');
  }

  try {
    const sector = await prisma.sector.create({ data: { usfId, nome } });
    await logAudit(req.user.id, 'SECTOR_CREATE', 'Sector', sector.id, { usfId, nome });
    req.flash('success', 'Setor cadastrado.');
  } catch (err) {
    req.flash('error', 'Falha ao cadastrar setor. Verifique se ele já existe nesta unidade.');
  }

  return res.redirect('/admin/locations');
});

router.post('/locations/rooms', requireRole('ADMIN'), writeLimiter, async (req, res) => {
  const prisma = getPrisma();
  const sectorId = intId(req.body.sectorId);
  const nome = cleanText(req.body.nome, { max: 120, required: true });
  const legacyRoom = enumValue(req.body.legacyRoom, LegacyRooms, 'OUTRO');

  if (!sectorId || !nome) {
    req.flash('error', 'Selecione o setor e informe o nome da sala.');
    return res.redirect('/admin/locations');
  }

  const sector = await prisma.sector.findUnique({ where: { id: sectorId } });
  if (!sector) {
    req.flash('error', 'Setor não encontrado.');
    return res.redirect('/admin/locations');
  }

  try {
    const room = await prisma.room.create({
      data: { usfId: sector.usfId, sectorId, nome, legacyRoom }
    });
    await logAudit(req.user.id, 'ROOM_CREATE', 'Room', room.id, { sectorId, usfId: sector.usfId, nome, legacyRoom });
    req.flash('success', 'Sala cadastrada.');
  } catch (err) {
    req.flash('error', 'Falha ao cadastrar sala. Verifique se ela já existe neste setor.');
  }

  return res.redirect('/admin/locations');
});

router.post('/locations/sectors/:id/toggle', requireRole('ADMIN'), writeLimiter, async (req, res) => {
  const prisma = getPrisma();
  const id = intId(req.params.id);
  const sector = id ? await prisma.sector.findUnique({ where: { id } }) : null;
  if (!sector) return res.redirect('/admin/locations');

  await prisma.sector.update({ where: { id }, data: { ativo: !sector.ativo } });
  await logAudit(req.user.id, 'SECTOR_TOGGLE', 'Sector', id, { oldValue: sector.ativo, newValue: !sector.ativo });
  return res.redirect('/admin/locations');
});

router.post('/locations/sectors/:id/update', requireRole('ADMIN'), writeLimiter, async (req, res) => {
  const prisma = getPrisma();
  const id = intId(req.params.id);
  const nome = cleanText(req.body.nome, { max: 120, required: true });
  if (!id || !nome) return res.redirect('/admin/locations');

  try {
    const sector = await prisma.sector.update({ where: { id }, data: { nome } });
    await logAudit(req.user.id, 'SECTOR_UPDATE', 'Sector', id, { nome: sector.nome });
    req.flash('success', 'Setor atualizado.');
  } catch (err) {
    req.flash('error', 'Falha ao atualizar setor. Verifique se o nome já existe nesta unidade.');
  }
  return res.redirect('/admin/locations');
});

router.post('/locations/sectors/:id/delete', requireRole('ADMIN'), writeLimiter, async (req, res) => {
  const prisma = getPrisma();
  const id = intId(req.params.id);
  if (!id) return res.redirect('/admin/locations');

  const [sector, rooms, tickets, hardwares] = await Promise.all([
    prisma.sector.findUnique({ where: { id } }),
    prisma.room.count({ where: { sectorId: id } }),
    prisma.ticket.count({ where: { sectorId: id } }),
    prisma.hardware.count({ where: { sectorId: id } })
  ]);

  if (!sector) return res.redirect('/admin/locations');
  if (rooms || tickets || hardwares) {
    req.flash('error', 'Este setor possui vínculos e não pode ser excluído.');
    return res.redirect('/admin/locations');
  }

  await prisma.sector.delete({ where: { id } });
  await logAudit(req.user.id, 'SECTOR_DELETE', 'Sector', id, { nome: sector.nome });
  req.flash('success', 'Setor excluído.');
  return res.redirect('/admin/locations');
});

router.post('/locations/rooms/:id/toggle', requireRole('ADMIN'), writeLimiter, async (req, res) => {
  const prisma = getPrisma();
  const id = intId(req.params.id);
  const room = id ? await prisma.room.findUnique({ where: { id } }) : null;
  if (!room) return res.redirect('/admin/locations');

  await prisma.room.update({ where: { id }, data: { ativo: !room.ativo } });
  await logAudit(req.user.id, 'ROOM_TOGGLE', 'Room', id, { oldValue: room.ativo, newValue: !room.ativo });
  return res.redirect('/admin/locations');
});

router.post('/locations/rooms/:id/update', requireRole('ADMIN'), writeLimiter, async (req, res) => {
  const prisma = getPrisma();
  const id = intId(req.params.id);
  const nome = cleanText(req.body.nome, { max: 120, required: true });
  const legacyRoom = enumValue(req.body.legacyRoom, LegacyRooms, 'OUTRO');
  if (!id || !nome) return res.redirect('/admin/locations');

  try {
    const room = await prisma.room.update({ where: { id }, data: { nome, legacyRoom } });
    await logAudit(req.user.id, 'ROOM_UPDATE', 'Room', id, { nome: room.nome, legacyRoom });
    req.flash('success', 'Sala atualizada.');
  } catch (err) {
    req.flash('error', 'Falha ao atualizar sala. Verifique se o nome já existe neste setor.');
  }
  return res.redirect('/admin/locations');
});

router.post('/locations/rooms/:id/delete', requireRole('ADMIN'), writeLimiter, async (req, res) => {
  const prisma = getPrisma();
  const id = intId(req.params.id);
  if (!id) return res.redirect('/admin/locations');

  const [room, tickets, hardwares] = await Promise.all([
    prisma.room.findUnique({ where: { id } }),
    prisma.ticket.count({ where: { roomId: id } }),
    prisma.hardware.count({ where: { roomId: id } })
  ]);

  if (!room) return res.redirect('/admin/locations');
  if (tickets || hardwares) {
    req.flash('error', 'Esta sala possui vínculos e não pode ser excluída.');
    return res.redirect('/admin/locations');
  }

  await prisma.room.delete({ where: { id } });
  await logAudit(req.user.id, 'ROOM_DELETE', 'Room', id, { nome: room.nome });
  req.flash('success', 'Sala excluída.');
  return res.redirect('/admin/locations');
});

// Categories (fixas + admin)
router.get('/categories', requireRole('ADMIN'), async (req, res) => {
  const prisma = getPrisma();
  const categories = await prisma.category.findMany({ orderBy: [{ system: 'desc' }, { nome: 'asc' }] });
  res.render('admin/categories', { title: 'Categorias', categories });
});

router.post('/categories', requireRole('ADMIN'), writeLimiter, async (req, res) => {
  const prisma = getPrisma();
  const nome = cleanText(req.body.nome, { max: 120, required: true });
  const defaultPriority = enumValue(req.body.defaultPriority, Priorities, 'MEDIUM');
  const slaHours = validateSlaHours(req.body.slaHours);

  if (!nome) return res.redirect('/admin/categories');

  try {
    const category = await prisma.category.create({
      data: {
        nome,
        ativo: true,
        system: false,
        defaultPriority,
        slaHours
      }
    });
    await logAudit(req.user.id, 'CATEGORY_CREATE', 'Category', category.id, { nome, defaultPriority, slaHours });
  } catch (err) {
    req.flash('error', 'Falha ao criar categoria. Verifique se ela já existe.');
  }
  res.redirect('/admin/categories');
});

router.post('/categories/:id/update', requireRole('ADMIN'), writeLimiter, async (req, res) => {
  const prisma = getPrisma();
  const id = intId(req.params.id);
  const nome = cleanText(req.body.nome, { max: 120, required: true });
  const defaultPriority = enumValue(req.body.defaultPriority, Priorities, 'MEDIUM');
  const slaHours = validateSlaHours(req.body.slaHours);

  const c = id ? await prisma.category.findUnique({ where: { id } }) : null;
  if (!c || !nome) return res.redirect('/admin/categories');

  try {
    const updated = await prisma.category.update({
      where: { id },
      data: { nome: c.system ? c.nome : nome, defaultPriority, slaHours }
    });
    await logAudit(req.user.id, 'CATEGORY_UPDATE', 'Category', id, {
      nome: updated.nome,
      defaultPriority,
      slaHours
    });
    req.flash('success', 'Categoria atualizada.');
  } catch (err) {
    req.flash('error', 'Falha ao atualizar categoria. Verifique se o nome já existe.');
  }
  res.redirect('/admin/categories');
});

router.post('/categories/:id/toggle', requireRole('ADMIN'), writeLimiter, async (req, res) => {
  const prisma = getPrisma();
  const id = intId(req.params.id);
  const c = await prisma.category.findUnique({ where: { id } });
  if (!c) return res.redirect('/admin/categories');

  await prisma.category.update({ where: { id }, data: { ativo: !c.ativo } });
  await logAudit(req.user.id, 'CATEGORY_TOGGLE', 'Category', id, { oldValue: c.ativo, newValue: !c.ativo });
  res.redirect('/admin/categories');
});

router.post('/categories/:id/delete', requireRole('ADMIN'), writeLimiter, async (req, res) => {
  const prisma = getPrisma();
  const id = intId(req.params.id);
  const c = await prisma.category.findUnique({ where: { id } });
  if (!c) return res.redirect('/admin/categories');
  if (c.system) return res.redirect('/admin/categories');

  const tickets = await prisma.ticket.count({ where: { categoryId: id } });
  if (tickets) {
    req.flash('error', 'Esta categoria possui chamados vinculados e não pode ser excluída. Desative-a se não deve mais ser usada.');
    return res.redirect('/admin/categories');
  }

  await prisma.category.delete({ where: { id } });
  await logAudit(req.user.id, 'CATEGORY_DELETE', 'Category', id, { nome: c.nome });
  res.redirect('/admin/categories');
});

// Users
router.get('/users', requireRole('ADMIN'), async (req, res) => {
  const prisma = getPrisma();
  const [users, usfs] = await Promise.all([
    prisma.user.findMany({ include: { usf: true }, orderBy: { nome: 'asc' } }),
    prisma.usf.findMany({ orderBy: { id: 'asc' } })
  ]);

  res.render('admin/users', { title: 'Usuários', users, usfs });
});

router.post('/users', requireRole('ADMIN'), writeLimiter, async (req, res) => {
  const prisma = getPrisma();

  const nome = cleanText(req.body.nome, { max: 160, required: true });
  const login = cleanText(req.body.login, { max: 80, required: true });
  const rawEmail = cleanText(req.body.email, { max: 160 });
  const email = rawEmail ? cleanEmail(rawEmail) : null;
  const telefone = cleanText(req.body.telefone, { max: 40 }) || null;
  const cargo = cleanText(req.body.cargo, { max: 120, required: true });
  const usfId = intId(req.body.usfId);
  const roleRaw = enumValue(req.body.role, Roles, null);
  const password = String(req.body.password || '');

  if (!nome || !login || !cargo || !usfId || !password) {
    req.flash('error', 'Preencha nome, login, cargo, unidade e senha.');
    return res.redirect('/admin/users');
  }
  if (rawEmail && !email) {
    req.flash('error', 'Informe um e-mail válido.');
    return res.redirect('/admin/users');
  }

  // regra configurável: cargo Enfermeiro => Coordenador (se habilitado)
  const autoRole = computeRoleFromCargo(cargo);
  const finalRole = autoRole || roleRaw || 'REQUESTER';

  if (!passwordIsStrong(password)) {
    req.flash('error', 'A senha deve ter no mínimo 8 caracteres e conter letras e números.');
    return res.redirect('/admin/users');
  }

  const cost = Number(process.env.BCRYPT_COST || 12);
  const passwordHash = await bcrypt.hash(password, cost);

  const newUser = await prisma.user.create({
    data: {
      nome,
      login,
      email,
      telefone,
      cargo,
      usfId,
      role: finalRole,
      ativo: true,
      passwordHash
    }
  }).catch(() => {
    req.flash('error', 'Falha ao criar (login já existe?).');
  });

  if (newUser) {
    await logAudit(req.user.id, 'USER_CREATE', 'User', newUser.id, { nome, login, email, role: finalRole });
  }

  res.redirect('/admin/users');
});

router.post('/users/:id/update', requireRole('ADMIN'), writeLimiter, async (req, res) => {
  const prisma = getPrisma();
  const id = intId(req.params.id);
  const current = id ? await prisma.user.findUnique({ where: { id } }) : null;
  if (!current) return res.redirect('/admin/users');

  const nome = cleanText(req.body.nome, { max: 160, required: true });
  const login = cleanText(req.body.login, { max: 80, required: true });
  const rawEmail = cleanText(req.body.email, { max: 160 });
  const email = rawEmail ? cleanEmail(rawEmail) : null;
  const telefone = cleanText(req.body.telefone, { max: 40 }) || null;
  const cargo = cleanText(req.body.cargo, { max: 120, required: true });
  const usfId = intId(req.body.usfId);
  const requestedRole = enumValue(req.body.role, Roles, current.role);
  const requestedAtivo = req.body.ativo === 'on';
  const role = current.id === req.user.id ? current.role : requestedRole;
  const ativo = current.id === req.user.id ? true : requestedAtivo;

  if (!nome || !login || !cargo || !usfId) {
    req.flash('error', 'Preencha nome, login, cargo e unidade.');
    return res.redirect('/admin/users');
  }
  if (rawEmail && !email) {
    req.flash('error', 'Informe um e-mail válido.');
    return res.redirect('/admin/users');
  }
  if (await wouldRemoveLastActiveAdmin(prisma, current, role, ativo)) {
    req.flash('error', 'Não é possível remover o último administrador ativo.');
    return res.redirect('/admin/users');
  }

  try {
    await prisma.user.update({
      where: { id },
      data: { nome, login, email, telefone, cargo, usfId, role, ativo }
    });
    await logAudit(req.user.id, 'USER_UPDATE', 'User', id, { login, role, ativo });
    req.flash('success', 'Usuário atualizado.');
  } catch (err) {
    req.flash('error', 'Falha ao atualizar usuário. Verifique se login ou e-mail já existem.');
  }
  res.redirect('/admin/users');
});

router.post('/users/:id/toggle', requireRole('ADMIN'), writeLimiter, async (req, res) => {
  const prisma = getPrisma();
  const id = intId(req.params.id);
  if (!id) return res.redirect('/admin/users');

  const u = await prisma.user.findUnique({ where: { id } });
  if (!u) return res.redirect('/admin/users');
  if (u.id === req.user.id) {
    req.flash('error', 'Você não pode desativar a própria conta.');
    return res.redirect('/admin/users');
  }
  if (await wouldRemoveLastActiveAdmin(prisma, u, u.role, !u.ativo)) {
    req.flash('error', 'Não é possível desativar o último administrador ativo.');
    return res.redirect('/admin/users');
  }

  await prisma.user.update({ where: { id }, data: { ativo: !u.ativo } });
  await logAudit(req.user.id, 'USER_TOGGLE', 'User', id, { oldValue: u.ativo, newValue: !u.ativo });
  res.redirect('/admin/users');
});

// Reset de Senha
router.post('/users/:id/reset-password', requireRole('ADMIN'), writeLimiter, async (req, res) => {
  const prisma = getPrisma();
  const id = intId(req.params.id);
  if (!id) return res.redirect('/admin/users');
  const newPassword = String(req.body.newPassword || '').trim();

  if (!passwordIsStrong(newPassword)) {
    req.flash('error', 'A nova senha deve ter no mínimo 8 caracteres e conter letras e números.');
    return res.redirect('/admin/users');
  }

  const u = await prisma.user.findUnique({ where: { id } });
  if (!u) return res.redirect('/admin/users');

  const cost = Number(process.env.BCRYPT_COST || 12);
  const passwordHash = await bcrypt.hash(newPassword, cost);

  await prisma.user.update({ where: { id }, data: { passwordHash, passwordChangedAt: new Date() } });
  await logAudit(req.user.id, 'USER_RESET_PASSWORD', 'User', id, { login: u.login });

  req.flash('success', `Senha de ${u.nome} redefinida com sucesso.`);
  res.redirect('/admin/users');
});

router.get('/settings', requireRole('ADMIN'), async (req, res) => {
  const prisma = getPrisma();
  const reportSettings = await getReportSettings(prisma);
  res.render('admin/settings', {
    title: 'Configurações',
    autoCoordinator: String(process.env.AUTO_COORDINATOR_FOR_ENFERMEIRO || 'true') === 'true',
    reportSettings
  });
});

// --- Gestão de Insumos ---
router.post(
  '/settings/reports',
  requireRole('ADMIN'),
  writeLimiter,
  reportLogoUpload.single('logo'),
  async (req, res) => {
    const prisma = getPrisma();
    const previous = await getReportSettings(prisma);
    let logoFile = previous.logoFile;

    if (req.body.removeLogo === 'on' && previous.logoFile) {
      const oldPath = getSystemAssetPath(previous.logoFile);
      if (oldPath && fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      logoFile = null;
    }

    if (req.file?.filename) {
      if (previous.logoFile) {
        const oldPath = getSystemAssetPath(previous.logoFile);
        if (oldPath && fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
      logoFile = req.file.filename;
    }

    const nextSettings = normalizeReportSettings({ ...req.body, logoFile }, previous);
    await upsertSetting(prisma, REPORT_SETTINGS_KEY, nextSettings, req.user.id);
    await logAudit(req.user.id, 'REPORT_SETTINGS_UPDATE', 'AppSetting', 0, {
      key: REPORT_SETTINGS_KEY,
      changedLogo: Boolean(req.file?.filename || req.body.removeLogo === 'on')
    });
    req.flash('success', 'Configurações de relatório salvas.');
    res.redirect('/admin/settings');
  }
);

router.get('/insumos', requireRole('ADMIN'), async (req, res) => {
  const prisma = getPrisma();
  const insumos = await prisma.insumo.findMany({ orderBy: { nome: 'asc' } });
  res.render('admin/insumos', { title: 'Gestão de Estoque', insumos });
});

router.post('/insumos', requireRole('ADMIN'), writeLimiter, async (req, res) => {
  const prisma = getPrisma();
  const nome = cleanText(req.body.nome, { max: 120, required: true });
  const tipo = enumValue(req.body.tipo, InsumoTipos, 'PECAS');
  const qtd = Math.max(0, Number.parseInt(req.body.quantidadeAtual || 0, 10));
  const min = Math.max(0, Number.parseInt(req.body.quantidadeMinima || 0, 10));

  if (!nome) return res.redirect('/admin/insumos');

  // Verifica se já existe (simples)
  const exists = await prisma.insumo.findFirst({ where: { nome } });
  if (exists) {
    req.flash('error', 'Insumo já cadastrado com este nome.');
    return res.redirect('/admin/insumos');
  }

  const newItem = await prisma.insumo.create({
    data: { nome, tipo, quantidadeAtual: qtd, quantidadeMinima: min }
  });

  await logAudit(req.user.id, 'INSUMO_CREATE', 'Insumo', newItem.id, { nome, qtd });
  res.redirect('/admin/insumos');
});

router.post('/insumos/:id/update', requireRole('ADMIN'), writeLimiter, async (req, res) => {
  const prisma = getPrisma();
  const id = intId(req.params.id);
  if (!id) return res.redirect('/admin/insumos');
  const qtd = Math.max(0, Number.parseInt(req.body.quantidade || 0, 10));
  const action = req.body.action; // 'add' or 'set'

  const item = await prisma.insumo.findUnique({ where: { id } });
  if (!item) return res.redirect('/admin/insumos');

  let newQtd = item.quantidadeAtual;
  if (action === 'add') newQtd += qtd;
  else if (action === 'set') newQtd = qtd;
  else {
    req.flash('error', 'Ação de estoque inválida.');
    return res.redirect('/admin/insumos');
  }

  await prisma.insumo.update({ where: { id }, data: { quantidadeAtual: newQtd } });
  await logAudit(req.user.id, 'INSUMO_UPDATE', 'Insumo', id, { old: item.quantidadeAtual, new: newQtd, action });
  
  res.redirect('/admin/insumos');
});

router.post('/insumos/:id/edit', requireRole('ADMIN'), writeLimiter, async (req, res) => {
  const prisma = getPrisma();
  const id = intId(req.params.id);
  const nome = cleanText(req.body.nome, { max: 120, required: true });
  const tipo = enumValue(req.body.tipo, InsumoTipos, 'PECAS');
  const quantidadeMinima = Math.max(0, Number.parseInt(req.body.quantidadeMinima || 0, 10));

  if (!id || !nome) return res.redirect('/admin/insumos');

  const duplicate = await prisma.insumo.findFirst({
    where: {
      nome,
      NOT: { id }
    }
  });
  if (duplicate) {
    req.flash('error', 'Já existe outro insumo cadastrado com este nome.');
    return res.redirect('/admin/insumos');
  }

  try {
    const updated = await prisma.insumo.update({
      where: { id },
      data: { nome, tipo, quantidadeMinima }
    });
    await logAudit(req.user.id, 'INSUMO_EDIT', 'Insumo', id, { nome: updated.nome, tipo, quantidadeMinima });
    req.flash('success', 'Insumo atualizado.');
  } catch (err) {
    req.flash('error', 'Falha ao atualizar insumo.');
  }

  return res.redirect('/admin/insumos');
});

router.post('/insumos/:id/delete', requireRole('ADMIN'), writeLimiter, async (req, res) => {
  const prisma = getPrisma();
  const id = intId(req.params.id);
  if (!id) return res.redirect('/admin/insumos');

  const [item, usageCount] = await Promise.all([
    prisma.insumo.findUnique({ where: { id } }),
    prisma.insumoHistorico.count({ where: { insumoId: id } })
  ]);

  if (!item) return res.redirect('/admin/insumos');
  if (usageCount > 0) {
    req.flash('error', 'Este insumo possui histórico de uso em chamados e não pode ser excluído.');
    return res.redirect('/admin/insumos');
  }

  await prisma.insumo.delete({ where: { id } });
  await logAudit(req.user.id, 'INSUMO_DELETE', 'Insumo', id, { nome: item.nome });
  req.flash('success', 'Insumo excluído.');
  return res.redirect('/admin/insumos');
});

// --- Equipamentos Condenados (Aprovação) ---
router.get('/condemned', requireRole('ADMIN'), async (req, res) => {
  const prisma = getPrisma();
  const tickets = await prisma.ticket.findMany({
    where: { resolution: 'SEM_REPARO_EQUIPAMENTO_CONDENADO' },
    include: { usf: true, category: true, assignee: true },
    orderBy: { resolvedAt: 'desc' },
    take: 50
  });
  res.render('admin/condemned', { title: 'Validação de Equipamentos', tickets });
});

module.exports = router;
