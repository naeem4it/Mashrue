#!/usr/bin/env bash
# ==============================================================================
# Mashrue (mashrue.com) — Automated HTTPS / SSL Setup Script
# Target: Hetzner Cloud (95.217.152.187)
# Run as: sudo bash configure_https.sh
# ==============================================================================

set -e

echo "===================================================================="
echo "🔒 CONFIGURING HTTPS & SSL FOR MASHRUE.COM & WWW.MASHRUE.COM"
echo "===================================================================="

# 1. Ensure Certbot & Python Nginx plugin are installed
echo "📦 1/4. Verifying Certbot installation..."
sudo apt-get update -y
sudo apt-get install -y certbot python3-certbot-nginx

# 2. Ensure UFW allows HTTP and HTTPS
echo "🛡️ 2/4. Opening Firewall Ports (80, 443, 22)..."
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw reload || true

# 3. Test Nginx Configuration
echo "🌐 3/4. Testing Nginx Syntax..."
sudo nginx -t

# 4. Request & Install Let's Encrypt Certificate for both domains
echo "🔑 4/4. Requesting and installing SSL certificate (mashrue.com + www.mashrue.com)..."
sudo certbot --nginx \
  -d mashrue.com \
  -d www.mashrue.com \
  --non-interactive \
  --agree-tos \
  --email naeem4it@gmail.com \
  --redirect

# 5. Reload Nginx
sudo systemctl reload nginx

echo ""
echo "===================================================================="
echo "🎉 HTTPS CONFIGURATION COMPLETE!"
echo "--------------------------------------------------------------------"
echo "Your site is now secured with valid SSL at:"
echo "👉 https://mashrue.com"
echo "👉 https://www.mashrue.com"
echo "===================================================================="
