const fs = require("fs");
const path = require("path");
const pino = require("pino");
const pinoHttp = require("pino-http");

const rootDir = path.resolve(__dirname, "../..");
const logDir = path.resolve(process.env.LOG_DIR || path.join(rootDir, "logs"));
fs.mkdirSync(logDir, { recursive: true });

const level = process.env.LOG_LEVEL || (process.env.NODE_ENV === "production" ? "info" : "debug");
const logFile = path.join(logDir, process.env.LOG_FILE || "system.log");

const redact = {
  paths: [
    "req.headers.cookie",
    "req.headers.authorization",
    "req.body.password",
    "req.body.newPassword",
    "req.body.confirmPassword",
    "req.body.currentPassword",
    "req.body.SMTP_PASS",
    "password",
    "passwordHash",
    "*.password",
    "*.passwordHash",
    "*.token",
    "*.tokenHash",
    "*.resetUrl",
  ],
  censor: "[REDACTED]",
};

const streams = [
  { stream: pino.destination({ dest: logFile, sync: false }) },
];

if (process.env.LOG_TO_STDOUT !== "false") {
  streams.push({ stream: process.stdout });
}

const logger = pino(
  {
    level,
    redact,
    base: {
      service: "helpdesk-ti",
      env: process.env.NODE_ENV || "development",
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  pino.multistream(streams),
);

function requestLogger() {
  return pinoHttp({
    logger,
    genReqId(req) {
      return req.headers["x-request-id"] || cryptoSafeId();
    },
    customLogLevel(req, res, err) {
      if (err || res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
    customProps(req) {
      return {
        userId: req.user?.id,
        userRole: req.user?.role,
      };
    },
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url,
          remoteAddress: req.remoteAddress,
          userAgent: req.headers["user-agent"],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  });
}

function cryptoSafeId() {
  return require("crypto").randomBytes(12).toString("hex");
}

module.exports = {
  logger,
  requestLogger,
  logFile,
};
