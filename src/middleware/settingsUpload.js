const crypto = require("crypto");
const path = require("path");
const multer = require("multer");
const { ensureSystemAssetRoot } = require("../utils/systemAssets");

const ALLOWED_LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, ensureSystemAssetRoot());
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname || "").toLowerCase() || ".png";
    cb(null, `logo-${crypto.randomUUID()}${ext}`);
  },
});

const reportLogoUpload = multer({
  storage,
  limits: {
    fileSize: Number(process.env.REPORT_LOGO_MAX_BYTES || 2 * 1024 * 1024),
    files: 1,
  },
  fileFilter(req, file, cb) {
    if (!ALLOWED_LOGO_TYPES.has(file.mimetype)) {
      return cb(new Error("Logo deve ser PNG, JPG ou WebP."));
    }
    return cb(null, true);
  },
});

module.exports = { reportLogoUpload };
