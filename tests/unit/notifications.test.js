const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildNotificationEvents,
  normalizeSince,
} = require("../../src/services/notification.service");

test("normalizeSince clamps invalid and very old timestamps", () => {
  const now = new Date("2026-05-10T12:00:00.000Z");

  assert.equal(
    normalizeSince("invalid-date", now).toISOString(),
    "2026-05-10T11:58:00.000Z",
  );

  assert.equal(
    normalizeSince("2026-05-01T12:00:00.000Z", now).toISOString(),
    "2026-05-09T12:00:00.000Z",
  );
});

test("requester notifications are scoped to own tickets and public messages", async () => {
  const calls = [];
  const prisma = {
    ticketMessage: {
      findMany: async (args) => {
        calls.push(["ticketMessage", args.where]);
        return [{
          id: 9,
          body: "Atendimento iniciado.",
          createdAt: new Date("2026-05-10T12:01:00.000Z"),
          author: { nome: "Técnico" },
          ticket: {
            id: 42,
            title: "Impressora",
            usf: { nome: "USF Centro" },
            category: { nome: "Impressora" },
          },
        }];
      },
    },
    ticket: {
      findMany: async (args) => {
        calls.push(["ticket", args.where]);
        return [];
      },
    },
  };

  const events = await buildNotificationEvents(prisma, {
    id: 7,
    role: "REQUESTER",
    usfId: 1,
  }, {
    since: "2026-05-10T12:00:00.000Z",
    now: new Date("2026-05-10T12:02:00.000Z"),
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].type, "ticket_message");
  assert.equal(events[0].url, "/tickets/42");
  assert.equal(calls[0][1].visibility, "PUBLIC");
  assert.deepEqual(calls[0][1].authorId, { not: 7 });
  assert.deepEqual(calls[0][1].ticket, { requesterId: 7 });
});

test("admin notifications include urgent tickets and low stock alerts", async () => {
  const prisma = {
    ticket: {
      findMany: async (args) => {
        if (args.where.priority) {
          return [{
            id: 10,
            title: "Internet fora",
            priority: "URGENT",
            createdAt: new Date("2026-05-10T12:01:00.000Z"),
            usf: { nome: "USF Norte" },
            category: { nome: "Rede" },
            requester: { nome: "Maria" },
          }];
        }
        return [];
      },
    },
    insumo: {
      fields: { quantidadeMinima: Symbol("quantidadeMinima") },
      findMany: async () => [{
        id: 3,
        nome: "Toner HP",
        quantidadeAtual: 0,
        quantidadeMinima: 2,
      }],
    },
  };

  const events = await buildNotificationEvents(prisma, {
    id: 1,
    role: "ADMIN",
    usfId: 1,
  }, {
    since: "2026-05-10T12:00:00.000Z",
    now: new Date("2026-05-10T12:02:00.000Z"),
  });

  assert.equal(events.some((event) => event.type === "ticket_new" && event.severity === "urgent"), true);
  assert.equal(events.some((event) => event.type === "stock_low" && event.severity === "urgent"), true);
});
