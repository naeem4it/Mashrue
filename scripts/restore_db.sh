#!/usr/bin/env bash
# ==============================================================================
# Mashrue (mashrue.com) — PostgreSQL Database Safe Restore Script
# Usage: ./scripts/restore_db.sh /path/to/mashrue_db_YYYYMMDD_HHMMSS.sql.gz
# ==============================================================================

set -e

BACKUP_FILE="$1"
DB_NAME="${DB_NAME:-mashruedb}"
DB_USER="${DB_USER:-mashrue_user}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"

if [ -z "$BACKUP_FILE" ]; then
    echo "❌ Error: Missing backup file argument."
    echo "Usage: $0 /path/to/mashrue_db_YYYYMMDD_HHMMSS.sql.gz"
    exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
    echo "❌ Error: Backup file not found: $BACKUP_FILE"
    exit 1
fi

echo "========================================================"
echo "⚠️ DATABASE RESTORE PROCEDURE"
echo "Target Database: ${DB_NAME} on ${DB_HOST}:${DB_PORT}"
echo "Source File:     ${BACKUP_FILE}"
echo "========================================================"
read -p "Are you sure you want to restore this database? (Type 'yes' to proceed): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo "Restore cancelled by user."
    exit 0
fi

echo "⏳ Restoring database from compressed archive..."

if [[ "$BACKUP_FILE" == *.gz ]]; then
    gunzip -c "$BACKUP_FILE" | PGPASSWORD="${DB_PASSWORD}" psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}"
else
    PGPASSWORD="${DB_PASSWORD}" psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" -f "$BACKUP_FILE"
fi

echo "✅ Database restore completed successfully!"
echo "========================================================"
