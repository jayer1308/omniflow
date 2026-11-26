#!/usr/bin/env bash
# Khôi phục file DB SQLite từ bản sao lưu: ./scripts/restore.sh <backup-file> <db>
set -euo pipefail
BACKUP="${1:?dung: restore.sh <backup-file> <db>}"
DB="${2:?dung: restore.sh <backup-file> <db>}"
cp "$BACKUP" "$DB"
echo "Restore: $BACKUP -> $DB"
