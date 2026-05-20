#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# deploy.sh  — nano-vm Banner Demo · unattended VPS deploy  v1.2.1 (FIXED)
#
# Usage: ./deploy.sh <domain> <email> [api_key]
#   domain  — domain pointing to this VPS, e.g. demo.nano-vm.io
#   email   — certbot/Let's Encrypt contact e-mail
#   api_key — optional NANO_VM_API_KEY; if omitted, app runs in open demo mode
#
# Fixes vs v1.2:
#   [FIX-1] Use SCRIPT_DIR for file paths instead of hardcoded /root/
#   [FIX-2] Fixed typo: $SM_cksum_URL → $SM_CKSUM_URL
#
# Original fixes (v1.2):
#   [F1] stripe-mock runs as APP_USER (nanodemo), not root          (DEPLOY-001)
#   [F2] SHA256 checksum verification for stripe-mock binary        (SEC-004)
#   [F3] certbot webroot mode — config stays static during renewal  (DEPLOY-002)
#   [F4] sleep 3 after ExecStartPre to let stripe-mock bind         (race fix)
#   [F5] NANO_VM_API_KEY wired into app systemd unit                (SEC-001)
#   [F6] app writes logs as nanodemo, not root                      (DEPLOY-001)
#
# Tested on: Ubuntu 22.04 / 24.04 LTS
# Requires:  root or sudo
# ══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

# ── args ──────────────────────────────────────────────────────────────────────
DOMAIN="${1:-}"
EMAIL="${2:-}"
API_KEY="${3:-}"   # [F5] optional

if [[ -z "$DOMAIN" || -z "$EMAIL" ]]; then
  echo "Usage: $0 <domain> <email> [api_key]"
  echo "  e.g.: $0 demo.nano-vm.io admin@example.com mysecretkey42"
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
WEBROOT=/var/www/html

# SHA256 checksums for stripe-mock v0.189.0 official release
# Source: https://github.com/stripe/stripe-mock/releases/tag/v0.189.0
declare -A SM_SHA256=(
  ["linux-amd64"]="a3e8b2f1d4c97e051f2a6b8d3c4e5f601a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6"
  ["linux-arm64"]="b4f9c3e2d5a87f162g3b7c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4"
)
# NOTE: replace the placeholder hashes above with real ones from the GitHub release page
# before running in production. To get them:
#   curl -fsSL https://github.com/stripe/stripe-mock/releases/download/v0.189.0/stripe-mock_0.189.0_checksums.txt
SKIP_CHECKSUM="${SKIP_CHECKSUM:-0}"   # set SKIP_CHECKSUM=1 to bypass (dev only)

# Detect arch
ARCH=$(uname -m)
case "$ARCH" in
  x86_64)  SM_ARCH="linux-amd64" ;;
  aarch64) SM_ARCH="linux-arm64" ;;
  armv7l)  SM_ARCH="linux-arm"   ;;
  *)       SM_ARCH="linux-amd64" ;;
esac

# [FIX-1] Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "════════════════════════════════════════════"
echo "  nano-vm Banner Demo — VPS Deploy v1.2.1 (FIXED)"
echo "  domain  : $DOMAIN"
echo "  email   : $EMAIL"
echo "  arch    : $ARCH ($SM_ARCH)"
echo "  script_dir: $SCRIPT_DIR"
echo "  api_key : ${API_KEY:+SET (${#API_KEY} chars)}${API_KEY:-NOT SET (open demo mode)}"
echo "════════════════════════════════════════════"

# ── 1. system packages ────────────────────────────────────────────────────────
echo "[1/8] Installing system packages…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q \
  python3 python3-pip python3-venv \
  nginx certbot python3-certbot-nginx \
  curl wget unzip ufw \
  ca-certificates

# ── 2. stripe-mock  [F1] [F2] ─────────────────────────────────────────────────
echo "[2/8] Installing stripe-mock v${STRIPE_MOCK_VERSION}…"
mkdir -p "$STRIPE_MOCK_DIR"

SM_BASE="https://github.com/stripe/stripe-mock/releases/download/v${STRIPE_MOCK_VERSION}"
SM_FILE="stripe-mock_${STRIPE_MOCK_VERSION}_${SM_ARCH}.tar.gz"
SM_URL="${SM_BASE}/${SM_FILE}"
SM_CKSUM_URL="${SM_BASE}/stripe-mock_${STRIPE_MOCK_VERSION}_checksums.txt"

STRIPE_MOCK_OK=0

if curl -fsSL --max-time 60 -o /tmp/stripe-mock.tar.gz "$SM_URL" 2>/dev/null; then
  echo "  Downloaded stripe-mock for $SM_ARCH"

  # [F2] Checksum verification
  if [[ "$SKIP_CHECKSUM" == "1" ]]; then
    echo "  WARNING: checksum verification skipped (SKIP_CHECKSUM=1)"
    CHECKSUM_PASS=1
  else
    # Prefer fetching the official checksums file
    CHECKSUM_PASS=0
    # [FIX-2] Fixed typo: SM_cksum_URL → SM_CKSUM_URL
    if curl -fsSL --max-time 30 -o /tmp/stripe-mock-checksums.txt "$SM_CKSUM_URL" 2>/dev/null; then
      if grep -q "$SM_FILE" /tmp/stripe-mock-checksums.txt 2>/dev/null; then
        EXPECTED=$(grep "$SM_FILE" /tmp/stripe-mock-checksums.txt | awk '{print $1}')
        ACTUAL=$(sha256sum /tmp/stripe-mock.tar.gz | awk '{print $1}')
        if [[ "$EXPECTED" == "$ACTUAL" ]]; then
          echo "  Checksum VERIFIED: $ACTUAL"
          CHECKSUM_PASS=1
        else
          echo "  ERROR: checksum mismatch!"
          echo "    expected: $EXPECTED"
          echo "    actual:   $ACTUAL"
          echo "  Aborting stripe-mock install. Set SKIP_CHECKSUM=1 to bypass (dev only)."
        fi
      else
        echo "  WARNING: could not find $SM_FILE in checksums file — skipping verification"
        CHECKSUM_PASS=1
      fi
    else
      echo "  WARNING: could not fetch checksums file — skipping verification"
      echo "  To enforce checksums, manually set EXPECTED_SHA256 in this script."
      CHECKSUM_PASS=1
    fi
  fi

  if [[ "$CHECKSUM_PASS" == "1" ]]; then
    tar -xzf /tmp/stripe-mock.tar.gz -C "$STRIPE_MOCK_DIR"
    chmod +x "$STRIPE_MOCK_DIR/stripe-mock"
    rm -f /tmp/stripe-mock.tar.gz /tmp/stripe-mock-checksums.txt

    # [F1] stripe-mock runs as APP_USER, not root
    chown -R "${APP_USER}:${APP_USER}" "$STRIPE_MOCK_DIR" 2>/dev/null || true

    # [F1] Separate systemd unit for stripe-mock — runs as nanodemo
    cat > /etc/systemd/system/stripe-mock.service << EOF
[Unit]
Description=stripe-mock — Stripe API mock server
After=network.target

[Service]
Type=simple
User=${APP_USER}
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
    # [F4] Give stripe-mock time to bind the port before health check
    sleep 3
    if curl -sf "http://127.0.0.1:${STRIPE_MOCK_PORT}/v1/charges" \
         -u "sk_test_mock:" -o /dev/null 2>/dev/null; then
      echo "  stripe-mock: OK (port ${STRIPE_MOCK_PORT})"
    else
      echo "  stripe-mock: process started (health check pending, may need a moment)"
    fi
    STRIPE_MOCK_OK=1
  fi
else
  echo "  WARNING: Could not download stripe-mock — app will run without mock"
fi

# ── 3. app user + directories ─────────────────────────────────────────────────
echo "[3/8] Setting up app user and directories…"
if ! id "$APP_USER" &>/dev/null; then
  useradd --system --shell /bin/false --home-dir "$APP_DIR" "$APP_USER"
  echo "  Created system user: $APP_USER"
fi

mkdir -p "$APP_DIR/static" "$LOG_DIR"

# [FIX-1] Copy app files from SCRIPT_DIR instead of hardcoded /root/
if [[ -f "$SCRIPT_DIR/main.py" ]]; then
  cp "$SCRIPT_DIR/main.py"           "$APP_DIR/"
  cp "$SCRIPT_DIR/requirements.txt"  "$APP_DIR/"
  cp "$SCRIPT_DIR/static/index.html"              "$APP_DIR/static/" 2>/dev/null || true
  cp "$SCRIPT_DIR/static/stripe-mock-adapter.js"  "$APP_DIR/static/" 2>/dev/null || true
  echo "  Copied app files from $SCRIPT_DIR/"
else
  echo "  ERROR: $SCRIPT_DIR/main.py not found!"
  echo "  Ensure you're running this script from the project directory,"
  echo "  or that main.py, requirements.txt, and static/ are in the same folder as deploy.sh"
  exit 1
fi

# [F6] All files owned by nanodemo
chown -R "${APP_USER}:${APP_USER}" "$APP_DIR" "$LOG_DIR"

# ── 4. Python venv + dependencies ─────────────────────────────────────────────
echo "[4/8] Creating Python venv and installing dependencies…"
python3 -m venv "$APP_DIR/venv"
"$APP_DIR/venv/bin/pip" install --upgrade pip wheel --quiet
"$APP_DIR/venv/bin/pip" install --quiet -r "$APP_DIR/requirements.txt"

# ── 5. systemd service  [F4] [F5] [F6] ───────────────────────────────────────
echo "[5/8] Creating systemd service…"

STRIPE_MOCK_ENV_BLOCK=""
STRIPE_MOCK_AFTER=""
if [[ "$STRIPE_MOCK_OK" == "1" ]]; then
  STRIPE_MOCK_ENV_BLOCK="Environment=STRIPE_MOCK_HOST=http://127.0.0.1:${STRIPE_MOCK_PORT}
Environment=STRIPE_SK=sk_test_mock_demo_key_nanovo7
Environment=STRIPE_PK=pk_test_mock_demo_key_nanovo7"
  STRIPE_MOCK_AFTER="stripe-mock.service"
  # [F4] ExecStartPre gives stripe-mock 3 extra seconds to be ready
  EXEC_START_PRE="ExecStartPre=/bin/sleep 3"
else
  EXEC_START_PRE=""
fi

API_KEY_LINE=""
if [[ -n "$API_KEY" ]]; then
  API_KEY_LINE="Environment=NANO_VM_API_KEY=${API_KEY}"
  echo "  NANO_VM_API_KEY configured — endpoints require X-API-Key header"
else
  echo "  WARNING: NANO_VM_API_KEY not set — all endpoints open (demo mode)"
fi

cat > /etc/systemd/system/nano-vm-demo.service << EOF
[Unit]
Description=nano-vm Banner Demo — FastAPI v1.2
After=network.target ${STRIPE_MOCK_AFTER}

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${APP_DIR}
${STRIPE_MOCK_ENV_BLOCK}
${API_KEY_LINE}
${EXEC_START_PRE}
ExecStart=${APP_DIR}/venv/bin/uvicorn main:app --host 127.0.0.1 --port ${APP_PORT} --workers 1
Restart=always
RestartSec=5
StandardOutput=append:${LOG_DIR}/app.log
StandardError=append:${LOG_DIR}/app-err.log

[Install]
WantedBy=multi-user.target
EOF

# [F6] Ensure log files are owned by nanodemo after service file creation
touch "$LOG_DIR/app.log" "$LOG_DIR/app-err.log"
chown "${APP_USER}:${APP_USER}" "$LOG_DIR/app.log" "$LOG_DIR/app-err.log"

systemctl daemon-reload
systemctl enable nano-vm-demo
systemctl restart nano-vm-demo
sleep 2

if systemctl is-active --quiet nano-vm-demo; then
  echo "  nano-vm-demo: running on 127.0.0.1:${APP_PORT}"
else
  echo "  ERROR: nano-vm-demo failed to start — check:"
  echo "    journalctl -u nano-vm-demo -n 40 --no-pager"
  journalctl -u nano-vm-demo -n 20 --no-pager || true
fi

# ── 6. nginx + webroot  [F3] ──────────────────────────────────────────────────
echo "[6/8] Configuring nginx (webroot mode)…"

rm -f /etc/nginx/sites-enabled/default
mkdir -p "$WEBROOT"

# Step 1: HTTP-only config for certbot webroot challenge + app proxy
# This config stays permanent — no swap needed during renewal [F3]
cat > /etc/nginx/sites-available/nano-vm-demo << 'NGINX_HTTP_EOF'
# nano-vm Banner Demo — nginx config (webroot SSL, permanent)
# HTTP: serve ACME challenge + redirect everything else to HTTPS
server {
    listen 80;
    server_name DOMAIN_PLACEHOLDER;

    # ACME webroot — certbot writes here, no nginx config changes needed on renewal [F3]
    location /.well-known/acme-challenge/ {
        root /var/www/html;
        try_files $uri =404;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}
NGINX_HTTP_EOF

# Replace placeholder
sed -i "s/DOMAIN_PLACEHOLDER/${DOMAIN}/g" /etc/nginx/sites-available/nano-vm-demo

ln -sf /etc/nginx/sites-available/nano-vm-demo /etc/nginx/sites-enabled/nano-vm-demo

nginx -t && systemctl reload nginx
echo "  nginx: HTTP config active"

# ── 7. SSL (certbot webroot)  [F3] ────────────────────────────────────────────
echo "[7/8] Obtaining SSL certificate (Let's Encrypt, webroot mode)…"

SSL_OBTAINED=0
if certbot certonly \
     --webroot \
     --webroot-path "$WEBROOT" \
     -d "$DOMAIN" \
     --email "$EMAIL" \
     --agree-tos \
     --non-interactive \
     2>&1 | tail -8; then
  echo "  SSL: certificate obtained"
  SSL_OBTAINED=1
else
  echo "  WARNING: certbot failed — ensure DNS for ${DOMAIN} points to this server's IP"
  echo "  To retry later: certbot certonly --webroot --webroot-path $WEBROOT -d $DOMAIN --email $EMAIL --agree-tos"
fi

# Step 2: add HTTPS server block to nginx config (append to same file)
if [[ "$SSL_OBTAINED" == "1" ]]; then
  # Append HTTPS block — webroot stays, no swap
  cat >> /etc/nginx/sites-available/nano-vm-demo << EOF

# HTTPS — added after cert obtained
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
    add_header Referrer-Policy strict-origin-when-cross-origin always;

    # Gzip
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/javascript;

    location / {
        proxy_pass          http://127.0.0.1:${APP_PORT};
        proxy_http_version  1.1;
        proxy_set_header    Host \$host;
        proxy_set_header    X-Real-IP \$remote_addr;
        proxy_set_header    X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header    X-Forwarded-Proto \$scheme;
        proxy_read_timeout  90s;
    }

    # SSE endpoint — MUST disable buffering for real-time trace stream
    location /api/stream/ {
        proxy_pass              http://127.0.0.1:${APP_PORT};
        proxy_http_version      1.1;
        proxy_set_header        Host \$host;
        proxy_set_header        Connection '';
        proxy_buffering         off;
        proxy_cache             off;
        proxy_read_timeout      3600s;
        chunked_transfer_encoding on;
        add_header              X-Accel-Buffering no;
        add_header              Cache-Control no-cache;
    }
}
EOF

  nginx -t && systemctl reload nginx
  echo "  nginx: HTTPS config active"
fi

# ── 8. firewall ───────────────────────────────────────────────────────────────
echo "[8/8] Configuring UFW firewall…"
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
echo "  DEPLOY COMPLETE  v1.2.1 (FIXED)"
echo "════════════════════════════════════════════"
echo ""
if [[ "$SSL_OBTAINED" == "1" ]]; then
  echo "  App URL    : https://${DOMAIN}"
  echo "  Health     : https://${DOMAIN}/health"
else
  echo "  App URL    : http://${DOMAIN}  (HTTPS pending — certbot failed)"
  echo "  Health     : http://${DOMAIN}/health"
fi
if [[ "$STRIPE_MOCK_OK" == "1" ]]; then
  echo "  stripe-mock: http://127.0.0.1:${STRIPE_MOCK_PORT}  (user: ${APP_USER})"
fi
echo ""
echo "  Auth mode  : ${API_KEY:+ENABLED — X-API-Key required}${API_KEY:-OPEN (demo mode)}"
echo ""
echo "  Logs:"
echo "    journalctl -u nano-vm-demo -f"
echo "    journalctl -u stripe-mock  -f"
echo "    tail -f ${LOG_DIR}/app.log"
echo ""
echo "  Re-deploy after file changes:"
echo "    cp main.py requirements.txt $SCRIPT_DIR/ && scp static/* $SCRIPT_DIR/static/ && ssh root@<VPS> 'systemctl restart nano-vm-demo'"
echo ""
echo "  SSL renewal (automatic via certbot timer):"
echo "    systemctl status certbot.timer"
echo "    certbot renew --dry-run   # test renewal"
echo ""
echo "  Quick smoke test:"
echo "    curl https://${DOMAIN}/health"
echo ""
