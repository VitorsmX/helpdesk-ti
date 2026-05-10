const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp'
]);

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function getUploadRoot() {
  return path.resolve(process.env.UPLOAD_DIR || 'uploads');
}

function buildUploadMiddleware() {
  const uploadRoot = getUploadRoot();
  ensureDir(uploadRoot);

  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      ensureDir(uploadRoot);
      cb(null, uploadRoot);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      const safe = `${Date.now()}_${crypto.randomUUID()}${ext}`.replace(/[^\w.\-]+/g, '_');
      cb(null, safe);
    }
  });

  return multer({
    storage,
    limits: {
      fileSize: Number(process.env.UPLOAD_MAX_BYTES || 8 * 1024 * 1024),
      files: Number(process.env.UPLOAD_MAX_FILES || 5)
    },
    fileFilter: (req, file, cb) => {
      if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
        return cb(new Error('Tipo de arquivo não permitido. Use PDF, JPG, PNG ou WEBP.'));
      }
      return cb(null, true);
    }
  });
}

module.exports = { buildUploadMiddleware, getUploadRoot, ALLOWED_MIME_TYPES };
