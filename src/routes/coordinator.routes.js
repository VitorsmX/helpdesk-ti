const express = require('express');
const { getPrisma } = require('../db');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

// Chamados da USF do coordenador
router.get('/tickets', requireRole('COORDINATOR'), async (req, res) => {
  const prisma = getPrisma();
  const tickets = await prisma.ticket.findMany({
    where: { usfId: req.user.usfId },
    include: { usf: true, category: true, requester: true, assignee: true },
    orderBy: { updatedAt: 'desc' }
  });

  res.render('coordinator/list', { title: 'Chamados da minha USF', tickets });
});

module.exports = router;
