const fs = require("fs");
const path = require("path");

function getSystemAssetRoot() {
  return path.resolve(process.env.SYSTEM_ASSET_DIR || path.join(process.cwd(), "uploads", "system"));
}

function ensureSystemAssetRoot() {
  const root = getSystemAssetRoot();
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function isSafeAssetName(fileName) {
  return /^[a-zA-Z0-9._-]+$/.test(String(fileName || ""));
}

function getSystemAssetPath(fileName) {
  if (!isSafeAssetName(fileName)) return null;
  const root = getSystemAssetRoot();
  const filePath = path.resolve(root, fileName);
  if (!filePath.startsWith(root + path.sep)) return null;
  return filePath;
}

module.exports = {
  getSystemAssetRoot,
  ensureSystemAssetRoot,
  getSystemAssetPath,
  isSafeAssetName,
};
