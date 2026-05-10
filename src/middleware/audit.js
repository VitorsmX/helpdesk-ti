const { getPrisma } = require('../db');

async function logAudit(actorId, action, entity, entityId, data) {
  const prisma = getPrisma();
  await prisma.auditLog.create({
    data: {
      actorId,
      action,
      entity,
      entityId,
      dataJson: data ? JSON.stringify(data) : null
    }
  });
}

module.exports = { logAudit };
