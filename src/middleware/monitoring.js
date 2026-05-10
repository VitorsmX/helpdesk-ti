const { getPrisma } = require('../db');

/**
 * Middleware to attach monitoring stats to res.locals for sidebar display
 * Only runs for authenticated ADMIN users
 */
async function attachMonitoringStats(req, res, next) {
  // Only fetch stats for ADMIN users
  if (!req.user || req.user.role !== 'ADMIN') {
    res.locals.monitoringStats = null;
    return next();
  }

  try {
    const prisma = getPrisma();
    const now = new Date();

    // Fetch all monitoring statistics in parallel
    const [slaBreachedCount, condemnedCount, waitingPartsCount] = await Promise.all([
      // SLA Breached tickets
      prisma.ticket.count({
        where: {
          status: { in: ['OPEN', 'IN_PROGRESS', 'WAITING'] },
          OR: [
            { responseBreachedAt: { not: null } },
            { resolutionBreachedAt: { not: null } },
            { firstResponseAt: null, responseDueAt: { lt: now } },
            { resolvedAt: null, resolutionDueAt: { lt: now } }
          ]
        }
      }),
      
      // Condemned equipment
      prisma.ticket.count({
        where: { resolution: 'SEM_REPARO_EQUIPAMENTO_CONDENADO' }
      }),
      
      // Waiting for parts
      prisma.ticket.count({
        where: { 
          status: 'WAITING',
          resolution: null
        }
      })
    ]);

    res.locals.monitoringStats = {
      slaBreached: slaBreachedCount,
      condemned: condemnedCount,
      waitingParts: waitingPartsCount
    };
  } catch (error) {
    console.error('Error fetching monitoring stats:', error);
    res.locals.monitoringStats = {
      slaBreached: 0,
      condemned: 0,
      waitingParts: 0
    };
  }

  next();
}

module.exports = { attachMonitoringStats };
