const path = require("path");
const fs = require("fs");
require("express-async-errors");
const express = require("express");
const helmet = require("helmet");
const layouts = require("express-ejs-layouts");
const compression = require("compression");

const { session, buildSessionOptions } = require("./config/session");
const { attachUserToReq } = require("./middleware/auth");
const { csrfSetup } = require("./middleware/csrf");
const { generalLimiter } = require("./middleware/rateLimit");
const { attachCspNonce } = require("./utils/security");
const {
  getSystemAssetRoot,
  ensureSystemAssetRoot,
} = require("./utils/systemAssets");
const { logger, requestLogger } = require("./utils/logger");
const { AppError, normalizeError } = require("./utils/errors");
const { passwordRecoveryEnabled } = require("./services/mail.service");

const authRoutes = require("./routes/auth.routes");
const ticketRoutes = require("./routes/tickets.routes");
const coordinatorRoutes = require("./routes/coordinator.routes");
const techRoutes = require("./routes/tech.routes");
const adminRoutes = require("./routes/admin.routes");
const reportsRoutes = require("./routes/reports.routes");
const exportRoutes = require("./routes/export.routes");
const hardwareRoutes = require("./routes/hardware.routes");
const notificationRoutes = require("./routes/notifications.routes");

const viewHelpers = require("./utils/views");
const { attachMonitoringStats } = require("./middleware/monitoring");

function createApp() {
  const app = express();
  app.disable("x-powered-by");

  if (process.env.TRUST_PROXY === "true") {
    app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS || 1));
  }

  app.use(attachCspNonce);
  const isProduction = process.env.NODE_ENV === "production";

  app.use(
    helmet({
      hsts: isProduction
        ? { maxAge: 15552000, includeSubDomains: true, preload: false }
        : false,
      crossOriginOpenerPolicy: isProduction ? undefined : false,
      originAgentCluster: false,
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: [
            "'self'",
            (req, res) => `'nonce-${res.locals.cspNonce}'`,
            "https://cdn.jsdelivr.net",
          ],
          styleSrc: [
            "'self'",
            "'unsafe-inline'",
            "https://cdn.jsdelivr.net",
            "https://fonts.googleapis.com",
          ],
          fontSrc: [
            "'self'",
            "https://fonts.gstatic.com",
            "https://cdn.jsdelivr.net",
          ],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: isProduction ? [] : null,
        },
      },
    }),
  );
  app.use(compression());
  app.use(generalLimiter);
  app.get("/healthz", (req, res) => {
    res.status(200).json({
      ok: true,
      service: "helpdesk-ti",
      environment: process.env.NODE_ENV || "development",
    });
  });
  app.use(
    express.urlencoded({
      extended: true,
      limit: process.env.FORM_BODY_LIMIT || "100kb",
    }),
  );

  app.use(session(buildSessionOptions()));

  // Flash simples na sessão (substitui connect-flash)
  app.use((req, res, next) => {
    req.flash = (type, msg) => {
      req.session._flash = req.session._flash || emptyFlash();
      req.session._flash[type] = req.session._flash[type] || [];
      req.session._flash[type].push(String(msg));
    };

    const originalRedirect = res.redirect.bind(res);
    res.redirect = (...args) => {
      if (shouldAddDefaultFeedback(req) && !hasPendingFlash(req)) {
        req.flash("info", "Solicitação processada.");
      }
      if (isAjaxFormRequest(req)) {
        const status = typeof args[0] === "number" ? args[0] : 200;
        const redirectTo = typeof args[0] === "number" ? args[1] : args[0];
        const flash = consumePendingFlash(req);
        const hasError = Array.isArray(flash.error) && flash.error.length > 0;

        return res.status(status >= 400 ? status : 200).json({
          ok: !hasError,
          redirect: redirectTo || req.get("Referrer") || "/",
          flash,
        });
      }

      return originalRedirect(...args);
    };

    res.locals.flash = req.session._flash || emptyFlash();
    req.session._flash = emptyFlash(); // consome
    next();
  });

  // EJS + layout
  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "views"));
  app.use(layouts);
  app.set("layout", "layouts/main");

  // Static
  app.use("/public", express.static(path.join(__dirname, "../public")));
  ensureSystemAssetRoot();
  app.use(
    "/system-assets",
    express.static(getSystemAssetRoot(), {
      maxAge: isProduction ? "7d" : 0,
      fallthrough: false,
    }),
  );

  // User
  app.use(attachUserToReq);

  // Logs estruturados com requestId para suporte e rastreabilidade.
  app.use(requestLogger());
  app.use((req, res, next) => {
    res.setHeader("X-Request-Id", req.id);
    next();
  });

  // CSRF
  app.use(csrfSetup);

  // Helpers para EJS
  app.use((req, res, next) => {
    res.locals.fmtDateBR = viewHelpers.fmtDateBR;
    res.locals.statusBadgeClass = viewHelpers.statusBadgeClass;
    res.locals.priorityBadgeClass = viewHelpers.priorityBadgeClass;
    res.locals.translateStatus = viewHelpers.translateStatus;
    res.locals.translatePriority = viewHelpers.translatePriority;
    res.locals.safeJsonForScript = viewHelpers.safeJsonForScript;
    res.locals.asset = (assetPath) => resolveAssetPath(assetPath, isProduction);
    res.locals.appEnvironment = isProduction ? "production" : "development";
    res.locals.appEnvironmentLabel = isProduction
      ? "Produção"
      : "Desenvolvimento";
    res.locals.sessionMaxAgeMs = Number(
      process.env.SESSION_MAX_AGE_MS || 8 * 60 * 60 * 1000,
    );
    res.locals.passwordRecoveryEnabled = passwordRecoveryEnabled();
    // Hardware helpers
    res.locals.getRoomIcon = viewHelpers.getRoomIcon;
    res.locals.translateRoom = viewHelpers.translateRoom;
    res.locals.getStatusBadgeClass = viewHelpers.getHardwareStatusBadgeClass;
    res.locals.translateHardwareStatus = viewHelpers.translateHardwareStatus;
    next();
  });

  // user em locals
  app.use((req, res, next) => {
    res.locals.user = req.user || null;
    next();
  });

  // Monitoring stats for sidebar (ADMIN only)
  app.use(attachMonitoringStats);

  // CSRF error handler
  app.use((err, req, res, next) => {
    if (err && err.code === "EBADCSRFTOKEN") {
      const message =
        "Sessão expirada ou formulário desatualizado. Recarregue a página e tente novamente.";

      if (isAjaxFormRequest(req)) {
        return res.status(419).json({
          ok: false,
          flash: {
            success: [],
            error: [message],
            info: [],
          },
        });
      }

      req.flash("error", message);
      return res.redirect(req.get("Referrer") || "/login");
    }

    next(err);
  });

  // Home
  app.get("/", (req, res) => {
    if (!req.user) return res.redirect("/login");
    return res.render("home", { title: "Início" });
  });

  // Routes
  app.use(authRoutes);
  app.use("/tickets", ticketRoutes);
  app.use("/coordinator", coordinatorRoutes);
  app.use("/tech", techRoutes);
  app.use("/admin", adminRoutes);
  app.use("/reports", reportsRoutes);
  app.use("/export", exportRoutes);
  app.use("/hardware", hardwareRoutes);
  app.use("/notifications", notificationRoutes);

  app.use((req, res, next) => {
    if (
      req.path === "/.well-known/appspecific/com.chrome.devtools.json" ||
      (req.path.startsWith("/public/vendor/bootstrap/") && req.path.endsWith(".map"))
    ) {
      return res.status(204).end();
    }
    next();
  });

  app.use((req, res, next) => {
    next(
      new AppError({
        code: "NOT_FOUND",
        status: 404,
        message: "Página não encontrada",
        publicMessage: "O endereço solicitado não foi encontrado.",
      }),
    );
  });

  app.use((err, req, res, next) => {
    if (
      err &&
      (err.name === "MulterError" || /arquivo/i.test(err.message || ""))
    ) {
      logger.warn(
        { err, requestId: req.id, userId: req.user?.id },
        "Falha ao processar upload",
      );
      if (req.flash)
        req.flash("error", err.message || "Falha ao processar anexo.");
      return res.redirect(req.get("Referrer") || "/");
    }

    if (res.headersSent) return next(err);

    const error = normalizeError(err, req);
    const payload = {
      err,
      error,
      userId: req.user?.id,
      userRole: req.user?.role,
      bodyKeys: req.body ? Object.keys(req.body) : [],
    };

    if (error.status >= 500) logger.error(payload, "Erro não tratado");
    else logger.warn(payload, "Erro tratado");

    if (wantsJson(req)) {
      return res.status(error.status).json({
        ok: false,
        error: {
          code: error.errorCode,
          reference: error.reference,
          message: error.message,
          requestId: error.requestId,
        },
      });
    }

    return res.status(error.status).render("error", {
      title: error.title,
      error,
    });
  });

  return app;
}

function wantsJson(req) {
  return (
    req.xhr ||
    req.headers.accept?.includes("application/json") ||
    req.path.startsWith("/api/")
  );
}

function emptyFlash() {
  return { success: [], error: [], info: [] };
}

function hasPendingFlash(req) {
  const flash = req.session?._flash;
  if (!flash) return false;
  return Object.values(flash).some(
    (messages) => Array.isArray(messages) && messages.length > 0,
  );
}

function consumePendingFlash(req) {
  if (!req.session) return emptyFlash();
  const flash = req.session._flash || emptyFlash();
  req.session._flash = emptyFlash();
  return flash;
}

function isAjaxFormRequest(req) {
  return req.get("X-App-Form") === "true";
}

function shouldAddDefaultFeedback(req) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return false;
  return !["/login", "/logout", "/session/renew"].includes(req.path);
}

function resolveAssetPath(assetPath, isProduction) {
  if (!isProduction) return assetPath;
  const match = String(assetPath).match(/^\/public\/(.+)\.(css|js)$/);
  if (!match) return assetPath;
  const variant = process.env.ASSET_VARIANT === "legacy" ? "legacy/" : "";
  const candidate = `/public/dist/${variant}${match[1]}.min.${match[2]}`;
  const localPath = path.join(
    __dirname,
    "..",
    candidate.replace(/^\/public\//, "public/"),
  );
  return fs.existsSync(localPath) ? candidate : assetPath;
}

module.exports = { createApp };
