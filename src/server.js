require('dotenv').config();
const { createApp } = require('./app');
const { logger } = require('./utils/logger');

const app = createApp();
const port = Number(process.env.PORT || 3000);

const server = app.listen(port, () => {
  logger.info({ port }, `Helpdesk TI rodando em http://localhost:${port}`);
});

server.keepAliveTimeout = Number(process.env.HTTP_KEEP_ALIVE_TIMEOUT_MS || 65000);
server.headersTimeout = Number(process.env.HTTP_HEADERS_TIMEOUT_MS || 66000);
server.requestTimeout = Number(process.env.HTTP_REQUEST_TIMEOUT_MS || 120000);

function shutdown(signal) {
  logger.info({ signal }, 'Encerrando servidor HTTP');
  server.close((error) => {
    if (error) {
      logger.error({ err: error }, 'Falha ao encerrar servidor');
      process.exit(1);
    }
    process.exit(0);
  });

  setTimeout(() => {
    logger.error({ signal }, 'Encerramento forçado por timeout');
    process.exit(1);
  }, Number(process.env.SHUTDOWN_TIMEOUT_MS || 10000)).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled rejection');
});
process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'Uncaught exception');
  process.exit(1);
});
