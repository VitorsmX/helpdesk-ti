const express = require('express');
const bcrypt = require('bcryptjs');
const { getPrisma } = require('../db');
const { requireRole } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');

const router = express.Router();

function computeRoleFromCargo(cargo) {
  const auto = String(process.env.AUTO_COORDINATOR_FOR_ENFERMEIRO || 'true') === 'true';
  if (!auto) return null;
  const c = (cargo || '').toLowerCase();
  if (c.includes('enfermeiro')) return 'COORDINATOR';
  return null;
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
      status: 'WAITING',
      resolution: null
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
  const breached = await prisma.ticket.findMany({
    where: {
      OR: [
        { responseBreachedAt: { not: null } },
        { resolutionBreachedAt: { not: null } }
      ]
    },
    include: { usf: true, category: true, assignee: true },
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

router.post('/usfs', requireRole('ADMIN'), async (req, res) => {
  const prisma = getPrisma();
  const nome = String(req.body.nome || '').trim();
  if (!nome) return res.redirect('/admin/usfs');

  await prisma.usf.create({ data: { nome } }).catch(() => {});
  await logAudit(req.user.id, 'USF_CREATE', 'USF', 0, { nome });
  res.redirect('/admin/usfs');
});

// Categories (fixas + admin)
router.get('/categories', requireRole('ADMIN'), async (req, res) => {
  const prisma = getPrisma();
  const categories = await prisma.category.findMany({ orderBy: [{ system: 'desc' }, { nome: 'asc' }] });
  res.render('admin/categories', { title: 'Categorias', categories });
});

router.post('/categories', requireRole('ADMIN'), async (req, res) => {
  const prisma = getPrisma();
  const nome = String(req.body.nome || '').trim();
  const defaultPriority = String(req.body.defaultPriority || 'MEDIUM');
  const slaHours = req.body.slaHours ? Number(req.body.slaHours) : null;

  if (!nome) return res.redirect('/admin/categories');

  await prisma.category.create({ 
    data: { 
      nome, 
      ativo: true, 
      system: false,
      defaultPriority,
      slaHours
    } 
  }).catch(() => {});
  
  await logAudit(req.user.id, 'CATEGORY_CREATE', 'Category', 0, { nome, defaultPriority, slaHours });
  res.redirect('/admin/categories');
});

router.post('/categories/:id/toggle', requireRole('ADMIN'), async (req, res) => {
  const prisma = getPrisma();
  const id = Number(req.params.id);
  const c = await prisma.category.findUnique({ where: { id } });
  if (!c) return res.redirect('/admin/categories');

  await prisma.category.update({ where: { id }, data: { ativo: !c.ativo } });
  await logAudit(req.user.id, 'CATEGORY_TOGGLE', 'Category', id, { oldValue: c.ativo, newValue: !c.ativo });
  res.redirect('/admin/categories');
});

router.post('/categories/:id/delete', requireRole('ADMIN'), async (req, res) => {
  const prisma = getPrisma();
  const id = Number(req.params.id);
  const c = await prisma.category.findUnique({ where: { id } });
  if (!c) return res.redirect('/admin/categories');
  if (c.system) return res.redirect('/admin/categories');

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

router.post('/users', requireRole('ADMIN'), async (req, res) => {
  const prisma = getPrisma();

  const nome = String(req.body.nome || '').trim();
  const login = String(req.body.login || '').trim();
  const telefone = String(req.body.telefone || '').trim() || null;
  const cargo = String(req.body.cargo || '').trim();
  const usfId = Number(req.body.usfId);
  const roleRaw = String(req.body.role || '').trim();
  const password = String(req.body.password || '');

  if (!nome || !login || !cargo || !usfId || !password) {
    req.flash('error', 'Preencha Nome, Login, Cargo, USF e Senha.');
    return res.redirect('/admin/users');
  }

  // regra configurável: cargo Enfermeiro => Coordenador (se habilitado)
  const autoRole = computeRoleFromCargo(cargo);
  const finalRole = autoRole || roleRaw || 'REQUESTER';

  const cost = Number(process.env.BCRYPT_COST || 10);
  const passwordHash = await bcrypt.hash(password, cost);

  const newUser = await prisma.user.create({
    data: {
      nome,
      login,
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
    await logAudit(req.user.id, 'USER_CREATE', 'User', newUser.id, { nome, login, role: finalRole });
  }

  res.redirect('/admin/users');
});

router.post('/users/:id/toggle', requireRole('ADMIN'), async (req, res) => {
  const prisma = getPrisma();
  const id = Number(req.params.id);

  const u = await prisma.user.findUnique({ where: { id } });
  if (!u) return res.redirect('/admin/users');

  await prisma.user.update({ where: { id }, data: { ativo: !u.ativo } });
  await logAudit(req.user.id, 'USER_TOGGLE', 'User', id, { oldValue: u.ativo, newValue: !u.ativo });
  res.redirect('/admin/users');
});

// Reset de Senha
router.post('/users/:id/reset-password', requireRole('ADMIN'), async (req, res) => {
  const prisma = getPrisma();
  const id = Number(req.params.id);
  const newPassword = String(req.body.newPassword || '').trim();

  if (!newPassword || newPassword.length < 6) {
    req.flash('error', 'A nova senha deve ter no mínimo 6 caracteres.');
    return res.redirect('/admin/users');
  }

  const u = await prisma.user.findUnique({ where: { id } });
  if (!u) return res.redirect('/admin/users');

  const cost = Number(process.env.BCRYPT_COST || 10);
  const passwordHash = await bcrypt.hash(newPassword, cost);

  await prisma.user.update({ where: { id }, data: { passwordHash } });
  await logAudit(req.user.id, 'USER_RESET_PASSWORD', 'User', id, { login: u.login });

  req.flash('success', `Senha de ${u.nome} redefinida com sucesso.`);
  res.redirect('/admin/users');
});

router.get('/settings', requireRole('ADMIN'), (req, res) => {
  res.render('admin/settings', {
    title: 'Configurações',
    autoCoordinator: String(process.env.AUTO_COORDINATOR_FOR_ENFERMEIRO || 'true') === 'true'
  });
});

// --- Gestão de Insumos ---
router.get('/insumos', requireRole('ADMIN'), async (req, res) => {
  const prisma = getPrisma();
  const insumos = await prisma.insumo.findMany({ orderBy: { nome: 'asc' } });
  res.render('admin/insumos', { title: 'Gestão de Estoque', insumos });
});

router.post('/insumos', requireRole('ADMIN'), async (req, res) => {
  const prisma = getPrisma();
  const nome = String(req.body.nome || '').trim();
  const tipo = String(req.body.tipo || 'PECAS');
  const qtd = Number(req.body.quantidadeAtual || 0);
  const min = Number(req.body.quantidadeMinima || 0);

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

router.post('/insumos/:id/update', requireRole('ADMIN'), async (req, res) => {
  const prisma = getPrisma();
  const id = Number(req.params.id);
  const qtd = Number(req.body.quantidade || 0);
  const action = req.body.action; // 'add' or 'set'

  const item = await prisma.insumo.findUnique({ where: { id } });
  if (!item) return res.redirect('/admin/insumos');

  let newQtd = item.quantidadeAtual;
  if (action === 'add') newQtd += qtd;
  else if (action === 'set') newQtd = qtd;

  await prisma.insumo.update({ where: { id }, data: { quantidadeAtual: newQtd } });
  await logAudit(req.user.id, 'INSUMO_UPDATE', 'Insumo', id, { old: item.quantidadeAtual, new: newQtd, action });
  
  res.redirect('/admin/insumos');
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
