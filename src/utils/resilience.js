const { logger } = require("./logger");

function withTimeout(promise, timeoutMs, label = "operation") {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`${label} excedeu o tempo limite`);
      error.code = "OPERATION_TIMEOUT";
      reject(error);
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function createCircuitBreaker(name, action, options = {}) {
  const failureThreshold = Number(options.failureThreshold || process.env.CIRCUIT_BREAKER_FAILURES || 5);
  const resetAfterMs = Number(options.resetAfterMs || process.env.CIRCUIT_BREAKER_RESET_MS || 30000);
  const timeoutMs = Number(options.timeoutMs || process.env.CIRCUIT_BREAKER_TIMEOUT_MS || 10000);
  let failures = 0;
  let openedAt = 0;

  return async function guardedAction(...args) {
    if (openedAt && Date.now() - openedAt < resetAfterMs) {
      const error = new Error(`${name} temporariamente indisponível`);
      error.code = "CIRCUIT_OPEN";
      throw error;
    }

    try {
      const result = await withTimeout(Promise.resolve(action(...args)), timeoutMs, name);
      failures = 0;
      openedAt = 0;
      return result;
    } catch (error) {
      failures += 1;
      if (failures >= failureThreshold) {
        openedAt = Date.now();
        logger.warn({ err: error, circuit: name, failures, resetAfterMs }, "Circuit breaker aberto");
      }
      throw error;
    }
  };
}

module.exports = {
  withTimeout,
  createCircuitBreaker,
};
