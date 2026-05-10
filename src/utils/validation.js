const { z } = require("zod");

const Roles = ["REQUESTER", "COORDINATOR", "TECH", "ADMIN"];
const Priorities = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const TicketStatuses = ["OPEN", "IN_PROGRESS", "WAITING", "RESOLVED", "CLOSED"];
const MessageVisibilities = ["PUBLIC", "INTERNAL"];
const LegacyRooms = ["RECEPCAO", "ENFERMAGEM", "MEDICO", "REUNIAO", "VACINA", "TRIAGEM", "OUTRO"];
const HardwareStatuses = ["ATIVO", "MANUTENCAO", "PERCA_TOTAL"];
const InsumoTipos = ["TONER", "CABO", "PECAS"];
const TicketResolutions = [
  "RESOLVIDO_SEM_TROCA_PECA",
  "RESOLVIDO_COM_TROCA_PECA",
  "AGUARDANDO_PECA_SEM_ESTOQUE",
  "SEM_REPARO_EQUIPAMENTO_CONDENADO",
  "ENCAMINHADO_TERCEIROS",
  "CADASTRO_CONCLUIDO",
  "MODULO_SEGURANCA_CONFIGURADO",
  "SENHA_REDEFINIDA",
  "PATCH_CORD_REFEITO",
  "REDE_CONFIGURADA_LOCAL",
];

function cleanText(value, { max = 191, required = false } = {}) {
  const text = String(value ?? "").trim();
  if (required && !text) return null;
  return text.slice(0, max);
}

function intId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function enumValue(value, allowed, fallback = null) {
  const text = String(value || "").trim();
  return allowed.includes(text) ? text : fallback;
}

function passwordIsStrong(password) {
  const schema = z
    .string()
    .min(8)
    .max(128)
    .regex(/[a-zA-Z]/)
    .regex(/[0-9]/);
  return schema.safeParse(password).success;
}

module.exports = {
  Roles,
  Priorities,
  TicketStatuses,
  MessageVisibilities,
  LegacyRooms,
  HardwareStatuses,
  InsumoTipos,
  TicketResolutions,
  cleanText,
  intId,
  enumValue,
  passwordIsStrong,
};
