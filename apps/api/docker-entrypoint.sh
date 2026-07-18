#!/bin/sh
# Fluxo de start profissional: espera o banco, migra, semeia (sem derrubar o
# container se falhar) e só então inicia a API. Ver README/Dockerfile pra
# contexto de por que isso deixou de ser um `command:` inline no compose.
set -e

echo "→ Waiting for PostgreSQL..."
node wait-for-db.js
echo "✓ Database connected"

echo "→ Running migrations..."
if npx prisma migrate deploy; then
  echo "✓ Migrations applied"
else
  echo "✗ Migration failed — aborting startup (schema may be inconsistent)."
  exit 1
fi

echo "→ Checking admin user..."
if ! node prisma/seed.js; then
  echo "⚠ Seed step failed — continuing startup anyway (see message above)."
fi

echo "→ Starting API..."
exec node dist/main.js
