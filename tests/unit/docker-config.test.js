const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.join(__dirname, "..", "..");
const dockerfile = fs.readFileSync(path.join(root, "Dockerfile"), "utf8");
const compose = fs.readFileSync(path.join(root, "docker-compose.yml"), "utf8");
const entrypoint = fs.readFileSync(
  path.join(root, "scripts", "docker-entrypoint.sh"),
  "utf8",
);
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

test("Docker image keeps Prisma CLI available for production migrations", () => {
  assert.equal(pkg.dependencies.prisma, "6.2.0");
  assert.match(dockerfile, /COPY --chown=node:node scripts\/docker-entrypoint\.sh/);
  assert.match(dockerfile, /ENTRYPOINT \["\.\/scripts\/docker-entrypoint\.sh"\]/);
  assert.match(entrypoint, /npx --no-install prisma migrate deploy/);
});

test("Docker Compose builds the local app and uses the internal database host", () => {
  assert.match(compose, /build:\s*\n\s*context: \./);
  assert.match(compose, /image: helpdesk-ti:latest/);
  assert.match(
    compose,
    /DATABASE_URL: mysql:\/\/\$\{MYSQL_USER\}:\$\{MYSQL_PASSWORD\}@db:3306\/\$\{MYSQL_DATABASE\}/,
  );
  assert.match(compose, /SEED_ADMIN_PASSWORD: \$\{SEED_ADMIN_PASSWORD:-\}/);
  assert.doesNotMatch(compose, /ghcr\.io\/devgueds/);
  assert.doesNotMatch(compose, /10\.0\.0\.40:3306/);
});

test("Docker flow exposes an application health endpoint", () => {
  assert.match(dockerfile, /HEALTHCHECK/);
  assert.match(dockerfile, /\/healthz/);
  assert.match(
    fs.readFileSync(path.join(root, "src", "app.js"), "utf8"),
    /app\.get\("\/healthz"/,
  );
});
