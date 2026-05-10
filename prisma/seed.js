require("dotenv").config();
const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function upsertCategory({ nome, system = false, ativo = true, defaultPriority = "MEDIUM", slaHours = null }) {
  return prisma.category.upsert({
    where: { nome },
    update: { ativo, system, defaultPriority, slaHours },
    create: { nome, ativo, system, defaultPriority, slaHours },
  });
}

async function upsertSector(usfId, nome) {
  return prisma.sector.upsert({
    where: { usfId_nome: { usfId, nome } },
    update: { ativo: true },
    create: { usfId, nome, ativo: true },
  });
}

async function upsertRoom(usfId, sectorId, nome, legacyRoom) {
  return prisma.room.upsert({
    where: { sectorId_nome: { sectorId, nome } },
    update: { usfId, legacyRoom, ativo: true },
    create: { usfId, sectorId, nome, legacyRoom, ativo: true },
  });
}

async function renameUnique(model, from, to, extraWhere = {}) {
  if (!from || !to || from === to) return;
  const target = await model.findFirst({ where: { ...extraWhere, nome: to } });
  if (target) return;
  await model.updateMany({ where: { ...extraWhere, nome: from }, data: { nome: to } });
}

function getSeedPassword() {
  if (process.env.SEED_ADMIN_PASSWORD) return process.env.SEED_ADMIN_PASSWORD;
  if (process.env.NODE_ENV === "production") {
    throw new Error("Defina SEED_ADMIN_PASSWORD para executar seed em produção.");
  }
  return "Admin@12345!";
}

async function main() {
  const usfNomes = [
    "Maria Rosa Batista",
    "Inussum",
    "Waldemar Queiroz",
    "Reginaldo Romariz",
    "Walter P. Lobato",
    "Perote",
    "Cesp(Raimundo Ambé)",
    "Cesp(Neomar Varela)",
    "Raimunda Reis",
    "Fernando Mendes",
    "7 Travessa",
    "Mata Sede",
    "Vila Sorriso",
    "Nova Assis",
    "Arnoldo Tavares",
    "Manoel Valente",
    "Francisco Carneiro",
    "Josepha Murrieta",
    "Jorge Netto da Costa",
  ];

  const usfs = {};
  await renameUnique(prisma.usf, "Cesp(Raimundo Ambe)", "Cesp(Raimundo Ambé)");
  for (const nome of usfNomes) {
    usfs[nome] = await prisma.usf.upsert({
      where: { nome },
      update: {},
      create: { nome },
    });
  }

  const categories = [
    { nome: "Rede/Internet", defaultPriority: "HIGH", slaHours: 4 },
    { nome: "Impressora", defaultPriority: "MEDIUM", slaHours: 8 },
    { nome: "Email", defaultPriority: "MEDIUM", slaHours: 8 },
    { nome: "Computador/Hardware", defaultPriority: "MEDIUM", slaHours: 16 },
    { nome: "Acesso/Permissão", defaultPriority: "HIGH", slaHours: 4 },
    { nome: "Sistemas (PEC/CADSUS)", defaultPriority: "HIGH", slaHours: 4 },
  ];

  await renameUnique(prisma.category, "Acesso/Permissao", "Acesso/Permissão");
  for (const category of categories) {
    await upsertCategory({ ...category, system: true, ativo: true });
  }

  const defaultLocations = [
    {
      sector: "Administrativo",
      rooms: [
        { nome: "Recepção", legacyRoom: "RECEPCAO" },
        { nome: "Sala de Reunião", legacyRoom: "REUNIAO" },
      ],
    },
    {
      sector: "Assistencial",
      rooms: [
        { nome: "Enfermagem", legacyRoom: "ENFERMAGEM" },
        { nome: "Consultório Médico", legacyRoom: "MEDICO" },
        { nome: "Triagem", legacyRoom: "TRIAGEM" },
      ],
    },
    {
      sector: "Imunização",
      rooms: [{ nome: "Sala de Vacina", legacyRoom: "VACINA" }],
    },
  ];

  for (const usf of Object.values(usfs)) {
    await renameUnique(prisma.sector, "Imunizacao", "Imunização", { usfId: usf.id });
    for (const group of defaultLocations) {
      const sector = await upsertSector(usf.id, group.sector);
      await renameUnique(prisma.room, "Recepcao", "Recepção", { sectorId: sector.id });
      await renameUnique(prisma.room, "Sala de Reuniao", "Sala de Reunião", { sectorId: sector.id });
      await renameUnique(prisma.room, "Consultorio Medico", "Consultório Médico", { sectorId: sector.id });
      for (const item of group.rooms) {
        const room = await upsertRoom(usf.id, sector.id, item.nome, item.legacyRoom);

        await prisma.ticket.updateMany({
          where: { usfId: usf.id, room: item.legacyRoom, roomId: null },
          data: { sectorId: sector.id, roomId: room.id },
        });

        await prisma.hardware.updateMany({
          where: { usfId: usf.id, sala: item.legacyRoom, roomId: null },
          data: { sectorId: sector.id, roomId: room.id },
        });
      }
    }
  }

  const cost = Number(process.env.BCRYPT_COST || 12);
  const adminPassword = await bcrypt.hash(getSeedPassword(), cost);
  const primeiraUsf = usfs["Maria Rosa Batista"];
  const adminLogin = process.env.SEED_ADMIN_LOGIN || "Admin";

  await prisma.user.upsert({
    where: { login: adminLogin },
    update: { passwordHash: adminPassword, ativo: true, role: "ADMIN", passwordChangedAt: new Date() },
    create: {
      nome: "Administrador",
      login: adminLogin,
      email: process.env.SEED_ADMIN_EMAIL || null,
      telefone: null,
      cargo: "Administrador",
      ativo: true,
      role: "ADMIN",
      usfId: primeiraUsf.id,
      passwordHash: adminPassword,
    },
  });

  await prisma.appSetting.upsert({
    where: { key: "reports.default" },
    update: {},
    create: {
      key: "reports.default",
      valueJson: JSON.stringify({
        organizationName: "Prefeitura Municipal de Capanema - PA",
        reportTitlePrefix: "Relatório de Suporte Técnico",
        footerText: "Helpdesk TI - Prefeitura Municipal de Capanema",
        accentColor: "#0d6efd",
        layout: "classic",
        paperSize: "A4",
        orientation: "landscape",
        includeLogo: true,
        includeGeneratedBy: true,
        logoFile: null,
      }),
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log("Seed concluido.");
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
