#!/usr/bin/env bash
# ==============================================================================
# Mashrue (mashrue.com) — Production Zero-Downtime Deployment Script
# Target: Linux Ubuntu (Hetzner Cloud Server)
# Usage: ./scripts/deploy.sh
# ==============================================================================

set -e # Exit immediately if a command fails

APP_DIR="/var/www/mashrue"
BACKEND_DIR="${APP_DIR}/backend"
FRONTEND_DIR="${APP_DIR}/frontend"

echo "========================================================"
echo "🚀 Starting Mashrue Enterprise BMS Production Deployment"
echo "Timestamp: $(date -u)"
echo "========================================================"

# 1. Pull latest verified code from Git repository (if using git on server)
if [ -d "${APP_DIR}/.git" ]; then
    echo "📥 Pulling latest release from Git..."
    cd "${APP_DIR}"
    git fetch origin main
    git reset --hard origin/main
fi

# 2. Deploy Frontend Static Assets
echo "🎨 Updating Frontend Static Files..."
mkdir -p "${FRONTEND_DIR}"
cp -r "${APP_DIR}/Code/Frontend/"* "${FRONTEND_DIR}/"
chmod -R 755 "${FRONTEND_DIR}"

# 3. Deploy Backend API
echo "⚙️ Setting up Backend API..."
mkdir -p "${BACKEND_DIR}"
cp -r "${APP_DIR}/Code/Backend/"* "${BACKEND_DIR}/"

cd "${BACKEND_DIR}"

# Ensure production dependencies are installed cleanly
echo "📦 Installing Production Dependencies (npm ci)..."
if [ -f "package-lock.json" ]; then
    npm ci --only=production
else
    npm install --production
fi

# Verify .env exists
if [ ! -f "${BACKEND_DIR}/.env" ]; then
    echo "⚠️ WARNING: .env not found in ${BACKEND_DIR}. Creating from .env.example..."
    cp "${BACKEND_DIR}/.env.example" "${BACKEND_DIR}/.env"
    echo "❗ Please update ${BACKEND_DIR}/.env with actual production secrets before starting."
fi

# 4. Reload PM2 Process Cluster
echo "🔄 Reloading Node.js Backend Cluster via PM2..."
mkdir -p /var/log/pm2
pm2 startOrReload "${BACKEND_DIR}/ecosystem.config.js" --env production
pm2 save

# 5. Test & Reload Nginx
echo "🌐 Verifying & Reloading Nginx..."
nginx -t
systemctl reload nginx

# 6. Verify Healthcheck Endpoint
echo "🩺 Performing Production Health Check..."
sleep 3
HEALTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3033/health || echo "FAILED")

if [ "$HEALTH_STATUS" -eq 200 ]; then
    echo "✅ DEPLOYMENT SUCCESSFUL! Health check passed (HTTP 200)."
    echo "🌐 Site is LIVE at https://mashrue.com"
else
    echo "⚠️ Health check returned HTTP ${HEALTH_STATUS}. Please inspect PM2 logs: pm2 logs mashrue-api"
    exit 1
fi
echo "========================================================"
