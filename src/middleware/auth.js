const { getPrisma } = require('../db');
const { AppError } = require('../utils/errors');

async function attachUserToReq(req, res, next) {
  if (!req.session.userId) return next();

  let user = null;
  try {
    const prisma = getPrisma();
    user = await prisma.user.findUnique({
      where: { id: req.session.userId },
      include: { usf: true }
    });
  } catch (error) {
    return next(error);
  }

  if (!user || !user.ativo) {
    req.session.userId = null;
    return next();
  }

  req.user = user;
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.redirect('/login');
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.redirect('/login');
    if (!roles.includes(req.user.role)) {
      return next(new AppError({
        code: 'ACCESS_DENIED',
        status: 403,
        message: 'Acesso não autorizado',
        publicMessage: 'Você não tem permissão para acessar esta área.'
      }));
    }
    next();
  };
}

function canViewTicket(user, ticket) {
  if (!user) return false;
  if (user.role === 'ADMIN' || user.role === 'TECH') return true;
  if (ticket.requesterId === user.id) return true;
  if (user.role === 'COORDINATOR' && user.usfId === ticket.usfId) return true;
  return false;
}

function canCommentTicket(user, ticket) {
  if (!user) return false;
  if (user.role === 'ADMIN' || user.role === 'TECH') return true;
  if (ticket.requesterId === user.id) return true;
  if (user.role === 'COORDINATOR' && user.usfId === ticket.usfId) return true;
  return false;
}

module.exports = { attachUserToReq, requireAuth, requireRole, canViewTicket, canCommentTicket };
