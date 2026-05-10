const { safeJsonForScript } = require('./security');

function fmtDateBR(d) {
  if (!d) return '';
  return new Date(d).toLocaleString('pt-BR');
}

function statusBadgeClass(status) {
  const m = {
    OPEN: 'text-bg-secondary',       // Novo
    IN_PROGRESS: 'text-bg-primary',  // Em atendimento
    WAITING: 'text-bg-warning',      // Aguardando
    RESOLVED: 'text-bg-success',     // Resolvido
    CLOSED: 'text-bg-dark'           // Fechado
  };
  return m[status] || 'text-bg-secondary';
}

function priorityBadgeClass(priority) {
  const m = {
    LOW: 'text-bg-success',      // Verde
    MEDIUM: 'text-bg-warning',   // Amarelo
    HIGH: 'text-bg-orange',     // Laranja (Need customized class or inline style if bootstrap doesn't have)
    URGENT: 'text-bg-danger'     // Vermelho
  };
  // Bootstrap doesn't have 'text-bg-orange' by default, we will fix in CSS.
  return m[priority] || 'text-bg-primary';
}

function translateStatus(status) {
  const m = {
    OPEN: 'Novo',
    IN_PROGRESS: 'Em atendimento',
    WAITING: 'Aguardando',
    RESOLVED: 'Resolvido',
    CLOSED: 'Fechado'
  };
  return m[status] || status;
}

function translatePriority(priority) {
  const m = {
    LOW: 'Baixa',
    MEDIUM: 'Média',
    HIGH: 'Alta',
    URGENT: 'Urgente'
  };
  return m[priority] || priority;
}

// Hardware helpers
function getRoomIcon(room) {
  const icons = {
    'RECEPCAO': 'bi-door-open',
    'ENFERMAGEM': 'bi-heart-pulse',
    'MEDICO': 'bi-hospital',
    'REUNIAO': 'bi-people',
    'VACINA': 'bi-shield-plus',
    'TRIAGEM': 'bi-clipboard2-pulse',
    'OUTRO': 'bi-geo-alt'
  };
  return icons[room] || 'bi-geo-alt';
}

function translateRoom(room) {
  const translations = {
    'RECEPCAO': 'Recepção',
    'ENFERMAGEM': 'Enfermagem',
    'MEDICO': 'Médico',
    'REUNIAO': 'Reunião',
    'VACINA': 'Vacina',
    'TRIAGEM': 'Triagem',
    'OUTRO': 'Outro'
  };
  return translations[room] || room;
}

function getHardwareStatusBadgeClass(status) {
  const classes = {
    'ATIVO': 'bg-success',
    'MANUTENCAO': 'bg-warning text-dark',
    'PERCA_TOTAL': 'bg-danger'
  };
  return classes[status] || 'bg-secondary';
}

function translateHardwareStatus(status) {
  const translations = {
    'ATIVO': 'Ativo',
    'MANUTENCAO': 'Manutenção',
    'PERCA_TOTAL': 'Perca Total'
  };
  return translations[status] || status;
}

module.exports = {
  fmtDateBR,
  statusBadgeClass,
  priorityBadgeClass,
  translateStatus,
  translatePriority,
  safeJsonForScript,
  getRoomIcon,
  translateRoom,
  getHardwareStatusBadgeClass,
  translateHardwareStatus
};
