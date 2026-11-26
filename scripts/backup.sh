#!/usr/bin/env bash
# Sao lưu file DB SQLite: ./scripts/backup.sh <db> <backup-file>
set -euo pipefail
DB="${1:?dung: backup.sh <db> <backup-file>}"
OUT="${2:?dung: backup.sh <db> <backup-file>}"
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB" ".backup '$OUT'"
else
  cp "$DB" "$OUT"
fi
echo "Backup: $DB -> $OUT"
