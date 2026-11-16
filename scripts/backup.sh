#!/usr/bin/env bash
# Gera um dump completo do banco da aplicação.
# Uso: DATABASE_URL="postgresql://usuario:senha@host:5432/banco" ./scripts/backup.sh
set -euo pipefail
: "${DATABASE_URL:?Defina DATABASE_URL antes de executar}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="backups/alimentos-tem-${STAMP}.sql"
mkdir -p backups
pg_dump "$DATABASE_URL" --no-owner --no-privileges --clean --if-exists > "$OUT"
echo "Backup criado: $OUT"
