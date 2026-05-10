const session = require("express-session");

function requireStrongSecret(secret) {
  return typeof secret === "string" && secret.length >= 32 && secret !== "dev";
}

function buildMySqlStore() {
  if (!process.env.DATABASE_URL) {
    throw new Error("SESSION_STORE=mysql exige DATABASE_URL configurado.");
  }

  const MySQLStore = require("express-mysql-session")(session);
  const dbUrl = new URL(process.env.DATABASE_URL);

  return new MySQLStore({
    host: dbUrl.hostname,
    port: Number(dbUrl.port || 3306),
    user: decodeURIComponent(dbUrl.username),
    password: decodeURIComponent(dbUrl.password),
    database: dbUrl.pathname.replace(/^\//, ""),
    createDatabaseTable: true,
    clearExpired: true,
    checkExpirationInterval: 15 * 60 * 1000,
    expiration: Number(process.env.SESSION_MAX_AGE_MS || 8 * 60 * 60 * 1000),
    schema: {
      tableName: "Session",
      columnNames: {
        session_id: "sessionId",
        expires: "expires",
        data: "data",
      },
    },
  });
}

function buildSessionOptions() {
  const isProduction = process.env.NODE_ENV === "production";
  const secureCookie =
    process.env.COOKIE_SECURE === "true" ||
    (isProduction && process.env.COOKIE_SECURE !== "false");
  const secret = process.env.SESSION_SECRET;

  if (isProduction && !requireStrongSecret(secret)) {
    throw new Error(
      "SESSION_SECRET deve existir e ter pelo menos 32 caracteres em produção.",
    );
  }

  const options = {
    name: process.env.SESSION_COOKIE_NAME || "helpdesk.sid",
    secret: secret || "dev-only-change-this-session-secret",
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: process.env.SESSION_SAME_SITE || "lax",
      secure: secureCookie,
      maxAge: Number(process.env.SESSION_MAX_AGE_MS || 8 * 60 * 60 * 1000),
    },
  };

  if (process.env.SESSION_STORE === "mysql") {
    options.store = buildMySqlStore();
  }

  return options;
}

module.exports = { session, buildSessionOptions };
