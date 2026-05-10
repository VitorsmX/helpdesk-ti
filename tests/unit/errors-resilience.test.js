const test = require("node:test");
const assert = require("node:assert/strict");

process.env.LOG_TO_STDOUT = "false";

const { AppError, normalizeError } = require("../../src/utils/errors");
const { createCircuitBreaker } = require("../../src/utils/resilience");

test("normalizeError exposes safe support metadata without stack", () => {
  const error = new AppError({
    code: "ACCESS_DENIED",
    status: 403,
    message: "Mensagem interna",
    publicMessage: "Mensagem segura para usuário",
  });
  const normalized = normalizeError(error, {
    id: "req-1",
    method: "GET",
    originalUrl: "/admin/users",
    headers: {},
  });

  assert.equal(normalized.status, 403);
  assert.equal(normalized.errorCode, "ACCESS_DENIED");
  assert.equal(normalized.message, "Mensagem segura para usuário");
  assert.equal(normalized.requestId, "req-1");
  assert.equal(Object.hasOwn(normalized, "stack"), false);
});

test("circuit breaker opens after repeated failures", async () => {
  const guarded = createCircuitBreaker(
    "unit-test-circuit",
    async () => {
      throw new Error("falha simulada");
    },
    { failureThreshold: 2, resetAfterMs: 60000, timeoutMs: 1000 },
  );

  await assert.rejects(() => guarded(), /falha simulada/);
  await assert.rejects(() => guarded(), /falha simulada/);
  await assert.rejects(() => guarded(), /temporariamente indisponível/);
});
