#!/bin/sh
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL nao configurada." >&2
  exit 1
fi

DB_HOST="$(node -e "const u=new URL(process.env.DATABASE_URL); process.stdout.write(u.hostname || 'db');")"
DB_PORT="$(node -e "const u=new URL(process.env.DATABASE_URL); process.stdout.write(u.port || '3306');")"

if [ "${WAIT_FOR_DB:-true}" != "false" ]; then
  echo "Aguardando MySQL em ${DB_HOST}:${DB_PORT}..."
  until nc -z "$DB_HOST" "$DB_PORT"; do
    sleep 3
  done
fi

if [ "${RUN_MIGRATIONS:-true}" != "false" ]; then
  echo "Aplicando migrations do Prisma..."
  npx --no-install prisma migrate deploy
fi

if [ "${RUN_SEED:-false}" = "true" ]; then
  echo "Executando seed inicial..."
  npm run db:seed
fi

exec "$@"
