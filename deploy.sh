#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# deploy.sh  — nano-vm Banner Demo · unattended VPS deploy
# Usage: ./deploy.sh <domain> <email>
#   domain  — your domain pointing to this VPS, e.g. demo.nano-vm.io
#   email   — certbot/Let's Encrypt contact e-mail
#
# Tested on: Ubuntu 22.04 / 24.04 LTS
# Requires:  root or sudo
# ══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

# ── args ──────────────────────────────────────────────────────────────────────
DOMAIN="${1:-}"
EMAIL="${2:-}"
if [[ -z "$DOMAIN" || -z "$EMAIL" ]]; then
  echo "Usage: $0 <domain> <email>"
  echo "  e.g.: $0 demo.nano-vm.io admin@example.com"
  exit 1
fi

# ── config ────────────────────────────────────────────────────────────────────
APP_DIR=/opt/nano-vm-demo
APP_USER=nanodemo
APP_PORT=8000
STRIPE_MOCK_PORT=12111
LOG_DIR=/var/log/nano-vm-demo
STRIPE_MOCK_DIR=/opt/stripe-mock
STRIPE_MOCK_VERSION=0.189.0

# Detect arch for stripe-mock binary
ARCH=$(uname -m)
case "$ARCH" in
  x86_64)  SM_ARCH="linux-amd64"   ;;
  aarch64) SM_ARCH="linux-arm64"   ;;
  armv7l)  SM_ARCH="linux-arm"     ;;
  *)       SM_ARCH="linux-amd64"   ;;
esac

echo "════════════════════════════════════════════"
echo "  nano-vm Banner Demo — VPS Deploy"
echo "  domain : $DOMAIN"
echo "  email  : $EMAIL"
echo "  arch   : $ARCH ($SM_ARCH)"
echo "════════════════════════════════════════════"

# ── 1. system packages ────────────────────────────────────────────────────────
echo "[1/7] Installing system packages…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q \
  python3 python3-pip python3-venv \
  nginx certbot python3-certbot-nginx \
  curl wget unzip ufw \
  ca-certificates

# ── 2. stripe-mock ────────────────────────────────────────────────────────────
echo "[2/7] Installing stripe-mock v${STRIPE_MOCK_VERSION}…"
mkdir -p "$STRIPE_MOCK_DIR"

SM_URL="https://github.com/stripe/stripe-mock/releases/download/v${STRIPE_MOCK_VERSION}/stripe-mock_${STRIPE_MOCK_VERSION}_${SM_ARCH}.tar.gz"
SM_FALLBACK="https://github.com/stripe/stripe-mock/releases/download/v${STRIPE_MOCK_VERSION}/stripe-mock_${STRIPE_MOCK_VERSION}_linux-amd64.tar.gz"

if curl -fsSL --max-time 30 -o /tmp/stripe-mock.tar.gz "$SM_URL" 2>/dev/null; then
  echo "  Downloaded stripe-mock for $SM_ARCH"
elif curl -fsSL --max-time 30 -o /tmp/stripe-mock.tar.gz "$SM_FALLBACK" 2>/dev/null; then
  echo "  Downloaded stripe-mock fallback (amd64)"
else
  echo "  WARNING: Could not download stripe-mock — will skip stripe-mock service"
  STRIPE_MOCK_DIR=""
fi

if [[ -n "$STRIPE_MOCK_DIR" ]]; then
  tar -xzf /tmp/stripe-mock.tar.gz -C "$STRIPE_MOCK_DIR"
  chmod +x "$STRIPE_MOCK_DIR/stripe-mock"
  rm -f /tmp/stripe-mock.tar.gz

  cat > /etc/systemd/system/stripe-mock.service << EOF
[Unit]
Description=stripe-mock — Stripe API mock server
After=network.target

[Service]
Type=simple
ExecStart=${STRIPE_MOCK_DIR}/stripe-mock -port ${STRIPE_MOCK_PORT}
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable stripe-mock
  systemctl restart stripe-mock
  sleep 1
  if curl -sf "http://127.0.0.1:${STRIPE_MOCK_PORT}/v1/charges" \
       -u "sk_test_mock:" -o /dev/null 2>/dev/null; then
    echo "  stripe-mock: OK (port ${STRIPE_MOCK_PORT})"
  else
    echo "  stripe-mock: started (health check pending)"
  fi
fi

# ── 3. app user + directories ─────────────────────────────────────────────────
echo "[3/7] Setting up app user and directories…"
if ! id "$APP_USER" &>/dev/null; then
  useradd --system --shell /bin/false --home-dir "$APP_DIR" "$APP_USER"
fi

mkdir -p "$APP_DIR/static" "$LOG_DIR"

# Copy app files from /root (scp destination)
if [[ -f /root/main.py ]]; then
  cp /root/main.py          "$APP_DIR/"
  cp /root/requirements.txt "$APP_DIR/"
  cp /root/static/index.html           "$APP_DIR/static/" 2>/dev/null || true
  cp /root/static/stripe-mock-adapter.js "$APP_DIR/static/" 2>/dev/null || true
  echo "  Copied app files from /root/"
else
  echo "  WARNING: /root/main.py not found — ensure you scp'd the files first"
fi

chown -R "$APP_USER:$APP_USER" "$APP_DIR" "$LOG_DIR"

# ── 4. Python venv + dependencies ─────────────────────────────────────────────
echo "[4/7] Creating Python venv and installing dependencies…"
python3 -m venv "$APP_DIR/venv"
"$APP_DIR/venv/bin/pip" install --upgrade pip wheel --quiet
"$APP_DIR/venv/bin/pip" install --quiet -r "$APP_DIR/requirements.txt"

# ── 5. systemd service ────────────────────────────────────────────────────────
echo "[5/7] Creating systemd service…"

STRIPE_MOCK_ENV=""
if [[ -n "$STRIPE_MOCK_DIR" ]]; then
  STRIPE_MOCK_ENV="Environment=STRIPE_MOCK_HOST=http://127.0.0.1:${STRIPE_MOCK_PORT}
Environment=STRIPE_SK=sk_test_mock_demo_key_nanovo7
Environment=STRIPE_PK=pk_test_mock_demo_key_nanovo7"
fi

cat > /etc/systemd/system/nano-vm-demo.service << EOF
[Unit]
Description=nano-vm Banner Demo — FastAPI
After=network.target stripe-mock.service

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${APP_DIR}
${STRIPE_MOCK_ENV}
ExecStart=${APP_DIR}/venv/bin/uvicorn main:app --host 127.0.0.1 --port ${APP_PORT} --workers 1
Restart=always
RestartSec=5
StandardOutput=append:${LOG_DIR}/app.log
StandardError=append:${LOG_DIR}/app-err.log

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable nano-vm-demo
systemctl restart nano-vm-demo
sleep 2

if systemctl is-active --quiet nano-vm-demo; then
  echo "  nano-vm-demo: running on 127.0.0.1:${APP_PORT}"
else
  echo "  ERROR: nano-vm-demo failed to start. Check: journalctl -u nano-vm-demo -n 40"
  journalctl -u nano-vm-demo -n 20 --no-pager || true
fi

# ── 6. nginx ──────────────────────────────────────────────────────────────────
echo "[6/7] Configuring nginx…"

# Remove default site if present
rm -f /etc/nginx/sites-enabled/default

cat > /etc/nginx/sites-available/nano-vm-demo << EOF
server {
    listen 80;
    server_name ${DOMAIN};

    # ACME challenge (certbot)
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name ${DOMAIN};

    ssl_certificate     /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    include             /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam         /etc/letsencrypt/ssl-dhparams.pem;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options DENY always;
    add_header X-Content-Type-Options nosniff always;

    # Gzip
    gzip on;
    gzip_types text/plain text/css application/json application/javascript;

    location / {
        proxy_pass         http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_read_timeout 90s;
    }

    # SSE endpoint — MUST disable buffering
    location /api/stream/ {
        proxy_pass             http://127.0.0.1:${APP_PORT};
        proxy_http_version     1.1;
        proxy_set_header       Host \$host;
        proxy_set_header       Connection '';
        proxy_buffering        off;
        proxy_cache            off;
        proxy_read_timeout     3600s;
        chunked_transfer_encoding on;
        add_header             X-Accel-Buffering no;
    }
}
EOF

ln -sf /etc/nginx/sites-available/nano-vm-demo /etc/nginx/sites-enabled/nano-vm-demo

# Test nginx config (HTTP only for now, SSL cert not yet obtained)
cat > /etc/nginx/sites-available/nano-vm-demo-http-only << EOF
server {
    listen 80;
    server_name ${DOMAIN};
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { proxy_pass http://127.0.0.1:${APP_PORT}; }
}
EOF

# Use HTTP-only config temporarily for certbot
ln -sf /etc/nginx/sites-available/nano-vm-demo-http-only /etc/nginx/sites-enabled/nano-vm-demo
nginx -t && systemctl reload nginx

# ── 7. SSL (certbot) ──────────────────────────────────────────────────────────
echo "[7/7] Obtaining SSL certificate (Let's Encrypt)…"

mkdir -p /var/www/html

if certbot --nginx -d "$DOMAIN" \
     --email "$EMAIL" \
     --agree-tos \
     --non-interactive \
     --redirect \
     2>&1 | tail -5; then
  echo "  SSL: certificate obtained"

  # Switch to full HTTPS config
  ln -sf /etc/nginx/sites-available/nano-vm-demo /etc/nginx/sites-enabled/nano-vm-demo
  rm -f /etc/nginx/sites-enabled/nano-vm-demo-http-only
  nginx -t && systemctl reload nginx
  echo "  nginx: reloaded with HTTPS config"
else
  echo "  WARNING: certbot failed — site will run on HTTP only"
  echo "  Ensure DNS for ${DOMAIN} points to this server's IP before re-running certbot"
fi

# ── ufw firewall ──────────────────────────────────────────────────────────────
echo "[UFW] Configuring firewall…"
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
echo "  ufw: SSH + 80 + 443 open"

# ── done ──────────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════"
echo "  DEPLOY COMPLETE"
echo "════════════════════════════════════════════"
echo ""
echo "  App URL    : https://${DOMAIN}"
echo "  Health     : https://${DOMAIN}/health"
echo "  stripe-mock: http://127.0.0.1:${STRIPE_MOCK_PORT}"
echo ""
echo "  Logs:"
echo "    journalctl -u nano-vm-demo -f"
echo "    journalctl -u stripe-mock  -f"
echo "    tail -f ${LOG_DIR}/app.log"
echo ""
echo "  Quick smoke test:"
echo "    curl https://${DOMAIN}/health"
echo ""
echo "  Re-deploy after file changes:"
echo "    systemctl restart nano-vm-demo"
echo ""
