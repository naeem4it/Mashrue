#!/usr/bin/env bash
# ==============================================================================
# Mashrue (mashrue.com) — Automated PostgreSQL Daily Backup Script
# Place in: /var/www/mashrue/scripts/backup_db.sh
# Crontab:  0 2 * * * /var/www/mashrue/scripts/backup_db.sh >> /var/log/mashrue_backup.log 2>&1
# ==============================================================================

set -e

# Configuration
BACKUP_DIR="/var/backups/mashrue/postgres"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
DB_NAME="${DB_NAME:-mashruedb}"
DB_USER="${DB_USER:-mashrue_user}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"
RETENTION_DAYS=30

mkdir -p "${BACKUP_DIR}"

BACKUP_FILE="${BACKUP_DIR}/mashrue_db_${TIMESTAMP}.sql.gz"

echo "--------------------------------------------------------"
echo "📦 Starting Database Backup: ${TIMESTAMP}"
echo "Database: ${DB_NAME} on ${DB_HOST}:${DB_PORT}"

# Execute PostgreSQL Dump with Gzip compression
PGPASSWORD="${DB_PASSWORD}" pg_dump -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" --no-owner --clean --if-exists | gzip > "${BACKUP_FILE}"

# Secure backup file permissions (Read-only by owner/root)
chmod 600 "${BACKUP_FILE}"

FILESIZE=$(ls -lh "${BACKUP_FILE}" | awk '{print $5}')
echo "✅ Backup successfully created: ${BACKUP_FILE} (${FILESIZE})"

# Retention Policy: Delete backups older than retention days
echo "🧹 Purging backups older than ${RETENTION_DAYS} days..."
find "${BACKUP_DIR}" -type f -name "mashrue_db_*.sql.gz" -mtime +${RETENTION_DAYS} -exec rm -f {} +

echo "✅ Backup routine complete."
echo "--------------------------------------------------------"
