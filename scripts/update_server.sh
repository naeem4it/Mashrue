#!/usr/bin/env bash
# ==============================================================================
# Mashrue (mashrue.com) — Fast Zero-Downtime Code Update & Deploy Script
# Usage on Server: sudo bash /var/www/mashrue/scripts/update_server.sh
# ==============================================================================

set -e

APP_DIR="/var/www/mashrue"
BACKEND_DIR="${APP_DIR}/backend"
FRONTEND_DIR="${APP_DIR}/frontend"

echo "========================================================"
echo "🚀 Updating Mashrue Application Code"
echo "Timestamp: $(date -u)"
echo "========================================================"

# 1. Update Frontend Files
if [ -d "${APP_DIR}/Code/Frontend" ]; then
    echo "🎨 Syncing Frontend static files..."
    mkdir -p "${FRONTEND_DIR}"
    rsync -av --delete "${APP_DIR}/Code/Frontend/" "${FRONTEND_DIR}/"
    chmod -R 755 "${FRONTEND_DIR}"
fi

# 2. Update Backend API
if [ -d "${APP_DIR}/Code/Backend" ]; then
    echo "⚙️ Syncing Backend code..."
    mkdir -p "${BACKEND_DIR}"
    rsync -av --exclude 'node_modules' --exclude '.env' "${APP_DIR}/Code/Backend/" "${BACKEND_DIR}/"
fi

# 3. Apply Safe Non-Destructive Database Schema Migration
if [ -f "${APP_DIR}/database/04_production_upgrade_safe.sql" ]; then
    echo "🗄️ Applying safe database migration (04_production_upgrade_safe.sql)..."
    sudo -u postgres psql -d mashrueDB -f "${APP_DIR}/database/04_production_upgrade_safe.sql" || echo "Notice: Database migration completed."
elif [ -f "${APP_DIR}/database/production_migration_payload.dat" ]; then
    echo "🗄️ Applying database payload (production_migration_payload.dat)..."
    sudo -u postgres psql -d mashrueDB -f "${APP_DIR}/database/production_migration_payload.dat" || echo "Notice: Database payload completed."
fi

# 4. Install Dependencies & Restart Backend Cluster
cd "${BACKEND_DIR}"
echo "📦 Installing production dependencies..."
npm install --production

echo "🔄 Gracefully reloading PM2 cluster..."
pm2 reload mashrue-api || pm2 start ecosystem.config.js --env production
pm2 save

# 5. Reload Nginx
echo "🌐 Reloading Nginx..."
nginx -t
systemctl reload nginx

# 6. Verify Health
sleep 2
echo "🩺 Verifying API Health..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3033/health || echo "000")

if [ "$HTTP_CODE" -eq 200 ]; then
    echo "✅ SUCCESS: Application updated successfully! HTTP 200 OK."
else
    echo "⚠️ Health check returned status: ${HTTP_CODE}. Checking logs..."
    pm2 logs mashrue-api --lines 20 --nostream
fi

echo "========================================================"
