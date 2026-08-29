#!/usr/bin/env bash
# ==============================================================================
# Mashrue (mashrue.com) — Complete Initial Production Server Setup Script
# Target: Ubuntu 22.04 / 24.04 LTS on Hetzner Cloud (95.217.152.187)
# Run as: sudo bash server_setup.sh
# ==============================================================================

set -e

echo "===================================================================="
echo "🚀 MASHRUE ENTERPRISE BMS — PRODUCTION SERVER SETUP & PROVISIONING"
echo "Target Host: 95.217.152.187 (mashrue.com / www.mashrue.com)"
echo "Timestamp: $(date -u)"
echo "===================================================================="

# Check root privileges
if [ "$EUID" -ne 0 ]; then
  echo "❌ Please run this script with sudo or as root: sudo bash server_setup.sh"
  exit 1
fi

APP_DIR="/var/www/mashrue"
BACKEND_DIR="${APP_DIR}/backend"
FRONTEND_DIR="${APP_DIR}/frontend"
DB_DIR="${APP_DIR}/database"
DB_NAME="mashrueDB"
DB_USER="mashrue_user"
DB_PASS="vurfP9aCUEHnbZLACN/u4QfdzIBvDm+aEjT4gBJjGUg="

# -----------------------------------------------------------------------------
# 1. System Updates & Core Tools Installation
# -----------------------------------------------------------------------------
echo ""
echo "📦 1/8. Updating System & Installing Core Packages..."
apt-get update -y
apt-get install -y curl wget git build-essential ufw nginx postgresql postgresql-contrib certbot python3-certbot-nginx rsync unzip

# -----------------------------------------------------------------------------
# 2. Install Node.js 20.x LTS & PM2 Process Manager
# -----------------------------------------------------------------------------
echo ""
echo "⚙️ 2/8. Installing Node.js 20 LTS & PM2..."
if ! command -v node >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi

npm install -g pm2
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7

# -----------------------------------------------------------------------------
# 3. Configure PostgreSQL Database & mashrue_user
# -----------------------------------------------------------------------------
echo ""
echo "🐘 3/8. Configuring PostgreSQL & Database Security..."
systemctl enable postgresql
systemctl start postgresql

# Create Database User and Database with provided credentials
sudo -u postgres psql -c "DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} WITH LOGIN ENCRYPTED PASSWORD '${DB_PASS}';
  ELSE
    ALTER ROLE ${DB_USER} WITH ENCRYPTED PASSWORD '${DB_PASS}';
  END IF;
END
\$\$;"

sudo -u postgres psql -c "SELECT 'CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${DB_NAME}')\gexec"
sudo -u postgres psql -d ${DB_NAME} -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};"
sudo -u postgres psql -d ${DB_NAME} -c "GRANT ALL ON SCHEMA public TO ${DB_USER};"

# -----------------------------------------------------------------------------
# 4. Prepare Directory Structure & Permissions
# -----------------------------------------------------------------------------
echo ""
echo "📁 4/8. Setting up Application Directories..."
mkdir -p "${APP_DIR}" "${BACKEND_DIR}" "${FRONTEND_DIR}" "${DB_DIR}" "${APP_DIR}/scripts" /var/log/pm2 /var/log/nginx /var/www/certbot

# -----------------------------------------------------------------------------
# 5. Execute Schema Initialization and Super Admin Seed
# -----------------------------------------------------------------------------
echo ""
echo "🗄️ 5/8. Executing Database Schema & SuperAdmin Provisioning..."
if [ -f "${DB_DIR}/01_schema_init.sql" ]; then
    echo "  -> Running 01_schema_init.sql..."
    PGPASSWORD="${DB_PASS}" psql -h 127.0.0.1 -U "${DB_USER}" -d "${DB_NAME}" -f "${DB_DIR}/01_schema_init.sql"
fi

if [ -f "${DB_DIR}/02_seed_superadmin_only.sql" ]; then
    echo "  -> Running 02_seed_superadmin_only.sql (SuperAdmin: naeem4it)..."
    PGPASSWORD="${DB_PASS}" psql -h 127.0.0.1 -U "${DB_USER}" -d "${DB_NAME}" -f "${DB_DIR}/02_seed_superadmin_only.sql"
fi

# -----------------------------------------------------------------------------
# 6. Configure Backend .env & Install Dependencies
# -----------------------------------------------------------------------------
echo ""
echo "🔒 6/8. Configuring Production Backend Environment..."
cat << 'EOF' > "${BACKEND_DIR}/.env"
# ==============================================================================
# Mashrue Production Environment Variables
# ==============================================================================
NODE_ENV=production
PORT=3033

DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=mashrueDB
DB_USER=mashrue_user
DB_PASSWORD=vurfP9aCUEHnbZLACN/u4QfdzIBvDm+aEjT4gBJjGUg=

JWT_SECRET=e7b4cf251786dbbb90f7a9d3e8e19c32f8319f074a689b9d031c26b5ea3c78d5236f3322bf2016335a298bf0245a4a15
ALLOWED_ORIGINS=https://mashrue.com,https://www.mashrue.com,http://localhost:3033

FBR_ENVIRONMENT=Sandbox
FBR_SANDBOX_URL=https://gw.fbr.gov.pk/di_data/v1/di/postinvoicedata_sb
FBR_PRODUCTION_URL=https://gw.fbr.gov.pk/di_data/v1/di/postinvoicedata
FBR_VALIDATE_SANDBOX_URL=https://gw.fbr.gov.pk/di_data/v1/di/validateinvoicedata_sb
FBR_VALIDATE_PRODUCTION_URL=https://gw.fbr.gov.pk/di_data/v1/di/validateinvoicedata
EOF

chmod 600 "${BACKEND_DIR}/.env"

if [ -f "${BACKEND_DIR}/package.json" ]; then
    echo "  -> Installing Backend NPM dependencies..."
    cd "${BACKEND_DIR}"
    npm install --production
fi

# -----------------------------------------------------------------------------
# 7. Configure Nginx Reverse Proxy & SSL (Certbot)
# -----------------------------------------------------------------------------
echo ""
echo "🌐 7/8. Configuring Nginx Web Server..."

# Copy Nginx config if present or create standard production block
if [ -f "${APP_DIR}/nginx/mashrue.conf" ]; then
    cp "${APP_DIR}/nginx/mashrue.conf" /etc/nginx/sites-available/mashrue.conf
fi

# Create symlink in sites-enabled
ln -sf /etc/nginx/sites-available/mashrue.conf /etc/nginx/sites-enabled/mashrue.conf
rm -f /etc/nginx/sites-enabled/default

# Test Nginx syntax
nginx -t
systemctl reload nginx

# -----------------------------------------------------------------------------
# 8. Start PM2 Backend Cluster & Firewall
# -----------------------------------------------------------------------------
echo ""
echo "⚡ 8/8. Starting PM2 Process Manager & Firewall..."
cd "${BACKEND_DIR}"
pm2 start ecosystem.config.js --env production || pm2 start server.js --name "mashrue-api"
pm2 save
pm2 startup systemd -u root --hp /root || true

# UFW Firewall Settings
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo ""
echo "===================================================================="
echo "🎉 SERVER SETUP COMPLETE!"
echo "--------------------------------------------------------------------"
echo "🌐 Domain: https://mashrue.com and https://www.mashrue.com"
echo "👤 Super Admin Username: naeem4it"
echo "🔑 Super Admin Password: Password123!"
echo "🐘 Database: mashrueDB (User: mashrue_user)"
echo ""
echo "To obtain Let's Encrypt Free SSL Certificate, run:"
echo "sudo certbot --nginx -d mashrue.com -d www.mashrue.com --agree-tos -m naeem@mashrue.com --redirect"
echo "===================================================================="
