const express = require('express');
const { getPrisma } = require('../db');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireRole('ADMIN', 'TECH'), async (req, res) => {
  const prisma = getPrisma();
  
  // Get period from query string (default: 30 days)
  const periodParam = req.query.period || '30d';
  const periodMap = {
    '7d': 7,
    '30d': 30,
    '90d': 90,
    'all': 365 * 10 // 10 years for "all time"
  };
  const days = periodMap[periodParam] || 30;
  
  // Date range for queries
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - days);
  
  // For trend chart (always last 7 days regardless of filter)
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  try {
    // Execute all queries in parallel for better performance
    const [
      totalOpen,
      totalResolved,
      avgResponseTimeResult,
      slaMetrics,
      criticalCounts,
      topUsfsRaw,
      topCategoriesRaw,
      byUsfRaw,
      lowStock,
      trendDataRaw,
      techWorkloadRaw,
      slaDetailsRaw
    ] = await Promise.all([
      // 1. Total chamados abertos
      prisma.ticket.count({
        where: { status: { in: ['OPEN', 'IN_PROGRESS', 'WAITING'] } }
      }),
      
      // 2. Total chamados resolvidos (últimos 30 dias)
      prisma.ticket.count({
        where: { 
          status: { in: ['RESOLVED', 'CLOSED'] },
          createdAt: { gte: thirtyDaysAgo }
        }
      }),
      
      // 3. Tempo médio de primeira resposta (em horas)
      prisma.$queryRaw`
        SELECT AVG(TIMESTAMPDIFF(HOUR, createdAt, firstResponseAt)) as avg_hours
        FROM Ticket 
        WHERE firstResponseAt IS NOT NULL 
        AND createdAt >= ${thirtyDaysAgo}
      `,
      
      // 4. Métricas de SLA — inclui abertos de qualquer data + fechados do período
      prisma.$queryRaw`
        SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN firstResponseAt IS NOT NULL AND responseBreachedAt IS NULL THEN 1 END) as on_time,
          COUNT(CASE WHEN responseBreachedAt IS NOT NULL OR firstResponseAt IS NULL THEN 1 END) as breached
        FROM Ticket 
        WHERE createdAt >= ${thirtyDaysAgo}
           OR (status IN ('OPEN','IN_PROGRESS','WAITING','WAITING_PARTS') AND firstResponseAt IS NULL)
      `,
      
      // 5. Contadores para alertas críticos
      Promise.all([
        prisma.ticket.count({ 
          where: { 
            responseBreachedAt: { not: null },
            status: { in: ['OPEN', 'IN_PROGRESS', 'WAITING'] }
          } 
        }),
        prisma.insumo.count({ where: { quantidadeAtual: 0 } }),
        prisma.ticket.count({ 
          where: { 
            resolution: 'SEM_REPARO_EQUIPAMENTO_CONDENADO',
            status: { not: 'CLOSED' }
          }
        }),
        prisma.ticket.count({ 
          where: { 
            status: 'WAITING',
            resolution: null
          }
        })
      ]),
      
      // 6. Top 5 USFs com mais chamados
      prisma.$queryRaw`
        SELECT 
          u.id,
          u.nome,
          COUNT(t.id) as total_chamados,
          COUNT(CASE WHEN t.priority = 'URGENT' THEN 1 END) as urgentes,
          COUNT(CASE WHEN t.responseBreachedAt IS NOT NULL THEN 1 END) as sla_breach
        FROM Ticket t
        JOIN USF u ON t.usfId = u.id
        WHERE t.createdAt >= ${thirtyDaysAgo}
        GROUP BY u.id, u.nome
        ORDER BY total_chamados DESC
        LIMIT 5
      `,
      
      // 7. Top 5 Categorias mais demandadas
      prisma.ticket.groupBy({
        by: ['categoryId'],
        where: { createdAt: { gte: thirtyDaysAgo } },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 5
      }),
      
      // 8. Gráfico por USF (todos)
      prisma.ticket.groupBy({
        by: ['usfId'],
        where: { createdAt: { gte: thirtyDaysAgo } },
        _count: { _all: true }
      }),
      
      // 9. Estoque crítico
      prisma.insumo.findMany({
        where: { 
          OR: [
            { quantidadeAtual: 0 },
            { quantidadeAtual: { lte: prisma.insumo.fields.quantidadeMinima } }
          ]
        },
        orderBy: { quantidadeAtual: 'asc' },
        take: 10
      }),
      
      // 10. Tendência temporal (últimos 7 dias)
      prisma.$queryRaw`
        SELECT 
          DATE(createdAt) as dia,
          COUNT(*) as total_chamados,
          COUNT(CASE WHEN priority = 'URGENT' THEN 1 END) as urgentes,
          COUNT(CASE WHEN status IN ('RESOLVED', 'CLOSED') THEN 1 END) as resolvidos
        FROM Ticket
        WHERE createdAt >= ${sevenDaysAgo}
        GROUP BY DATE(createdAt)
        ORDER BY dia
      `,
      
      // 11. Carga de trabalho por técnico
      prisma.$queryRaw`
        SELECT 
          u.id,
          u.nome,
          COUNT(t.id) as chamados_ativos,
          COUNT(CASE WHEN t.priority = 'URGENT' THEN 1 END) as urgentes,
          AVG(TIMESTAMPDIFF(HOUR, t.createdAt, t.firstResponseAt)) as tempo_resposta_medio
        FROM Ticket t
        JOIN User u ON t.assigneeId = u.id
        WHERE t.status IN ('OPEN', 'IN_PROGRESS', 'WAITING')
          AND u.role = 'TECH'
          AND u.ativo = 1
        GROUP BY u.id, u.nome
        ORDER BY chamados_ativos DESC
      `,
      
      // 12. SLA detalhado — inclui abertos de qualquer data + fechados do período
      prisma.$queryRaw`
        SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN firstResponseAt IS NOT NULL AND responseBreachedAt IS NULL THEN 1 END) as no_prazo,
          COUNT(CASE WHEN responseBreachedAt IS NOT NULL OR firstResponseAt IS NULL THEN 1 END) as atrasados,
          AVG(TIMESTAMPDIFF(HOUR, createdAt, firstResponseAt)) as tempo_medio_resposta,
          AVG(TIMESTAMPDIFF(HOUR, createdAt, resolvedAt)) as tempo_medio_resolucao
        FROM Ticket
        WHERE createdAt >= ${thirtyDaysAgo}
           OR (status IN ('OPEN','IN_PROGRESS','WAITING','WAITING_PARTS') AND firstResponseAt IS NULL)
      `
    ]);

    // Process results
    
    // KPIs - Convert BigInt to Number
    const avgResponseTime = Number(avgResponseTimeResult[0]?.avg_hours || 0);
    const slaTotal = Number(slaMetrics[0]?.total || 0);
    const slaOnTime = Number(slaMetrics[0]?.on_time || 0);
    const slaRate = slaTotal > 0 
      ? ((slaOnTime / slaTotal) * 100).toFixed(1)
      : 0;
    
    const kpis = {
      totalOpen,
      avgResponseTime: avgResponseTime.toFixed(1),
      slaRate,
      criticalAlerts: Number(criticalCounts[0]) + Number(criticalCounts[1]) + Number(criticalCounts[2]) + Number(criticalCounts[3])
    };
    
    // Alerts breakdown
    const alerts = {
      slaBreached: criticalCounts[0],
      stockZero: criticalCounts[1],
      condemned: criticalCounts[2],
      waitingParts: criticalCounts[3]
    };

    // Top USFs (already processed by query)
    const topUsfs = topUsfsRaw.map(usf => ({
      ...usf,
      total_chamados: Number(usf.total_chamados),
      urgentes: Number(usf.urgentes),
      sla_breach: Number(usf.sla_breach)
    }));

    // Top Categories - enrich with category names
    const categoryIds = topCategoriesRaw.map(c => c.categoryId);
    const categories = await prisma.category.findMany({
      where: { id: { in: categoryIds } }
    });
    
    const totalTicketsForPercentage = await prisma.ticket.count({
      where: { createdAt: { gte: thirtyDaysAgo } }
    });
    
    const topCategories = topCategoriesRaw.map(item => {
      const category = categories.find(c => c.id === item.categoryId);
      const percentage = totalTicketsForPercentage > 0 
        ? ((item._count.id / totalTicketsForPercentage) * 100).toFixed(1)
        : 0;
      
      return {
        nome: category?.nome || 'Desconhecido',
        total: item._count.id,
        percentage
      };
    });

    // Chart data - enrich USF names
    const allUsfs = await prisma.usf.findMany();
    const byUsf = byUsfRaw.map(item => {
      const usf = allUsfs.find(u => u.id === item.usfId);
      return {
        usfName: usf ? usf.nome : 'Desconhecido',
        count: item._count._all
      };
    }).sort((a, b) => b.count - a.count);

    // Process trend data - Convert BigInt to Number
    const trendData = trendDataRaw.map(item => ({
      dia: item.dia,
      total_chamados: Number(item.total_chamados),
      urgentes: Number(item.urgentes),
      resolvidos: Number(item.resolvidos)
    }));

    // Process tech workload - Convert BigInt to Number
    const techWorkload = techWorkloadRaw.map(tech => ({
      id: Number(tech.id),
      nome: tech.nome,
      chamados_ativos: Number(tech.chamados_ativos),
      urgentes: Number(tech.urgentes),
      tempo_resposta_medio: Number(tech.tempo_resposta_medio || 0).toFixed(1)
    }));

    // Process SLA details - Convert BigInt to Number
    const slaDetails = slaDetailsRaw[0] ? {
      total: Number(slaDetailsRaw[0].total),
      no_prazo: Number(slaDetailsRaw[0].no_prazo),
      atrasados: Number(slaDetailsRaw[0].atrasados),
      tempo_medio_resposta: Number(slaDetailsRaw[0].tempo_medio_resposta || 0).toFixed(1),
      tempo_medio_resolucao: Number(slaDetailsRaw[0].tempo_medio_resolucao || 0).toFixed(1),
      taxa_cumprimento: slaDetailsRaw[0].total > 0 
        ? ((Number(slaDetailsRaw[0].no_prazo) / Number(slaDetailsRaw[0].total)) * 100).toFixed(1)
        : 0
    } : {
      total: 0,
      no_prazo: 0,
      atrasados: 0,
      tempo_medio_resposta: 0,
      tempo_medio_resolucao: 0,
      taxa_cumprimento: 0
    };

    res.render('reports/index', {
      title: 'Dashboard Gerencial',
      stats: { totalOpen, totalResolved },
      kpis,
      alerts,
      topUsfs,
      topCategories,
      byUsf,
      lowStock,
      trendData,
      techWorkload,
      slaDetails,
      selectedPeriod: periodParam
    });
    
  } catch (error) {
    console.error('Error loading dashboard:', error);
    res.status(500).send('Erro ao carregar dashboard');
  }
});

module.exports = router;
