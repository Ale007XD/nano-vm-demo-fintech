# Deployment Guide — nano-vm Banner Demo

## Prerequisites

| What | Requirement |
|------|-------------|
| VPS | Ubuntu 22.04 or 24.04 LTS, 1 vCPU / 512 MB RAM minimum |
| DNS | A-record for your domain pointing to the VPS IP |
| Access | SSH as root (or sudo user) |
| Files | `main.py`, `requirements.txt`, `deploy.sh`, `static/` |

---

## Step 1 — Upload files to VPS

```bash
# From your local machine:
scp deploy.sh main.py requirements.txt root@<VPS_IP>:/root/
scp static/index.html static/stripe-mock-adapter.js root@<VPS_IP>:/root/static/

# Make deploy script executable
ssh root@<VPS_IP> "chmod +x /root/deploy.sh"
```

---

## Step 2 — Run deploy script

```bash
ssh root@<VPS_IP>
./deploy.sh demo.yourdomain.com your@email.com
```

The script runs fully unattended (~3–5 min) and:

1. `apt install` — Python 3, nginx, certbot, curl, ufw
2. Downloads `stripe-mock` binary (official Stripe release) → runs on `:12111`
3. Creates system user `nanodemo`, sets up `/opt/nano-vm-demo/`
4. Python venv → `pip install -r requirements.txt`
5. Creates `systemd` units for both `stripe-mock` and `nano-vm-demo`
6. Configures nginx reverse-proxy (SSE buffering disabled for `/api/stream/`)
7. Runs `certbot` → Let's Encrypt SSL → auto-redirect HTTP→HTTPS
8. `ufw` → only SSH + 80 + 443

---

## Step 3 — Smoke test

```bash
# Health check
curl https://demo.yourdomain.com/health

# Expected:
# {"status":"ok","version":"nano-vm-demo-v1.1","nano_vm":"0.7.5","stripe":"test_mode","mock":true}

# stripe-mock check (from VPS)
curl http://127.0.0.1:12111/v1/payment_intents -u sk_test_mock: | python3 -m json.tool | head -5
```

---

## Services

| Service | Command |
|---------|---------|
| Start   | `systemctl start nano-vm-demo` |
| Stop    | `systemctl stop nano-vm-demo` |
| Restart | `systemctl restart nano-vm-demo` |
| Logs    | `journalctl -u nano-vm-demo -f` |
| stripe-mock logs | `journalctl -u stripe-mock -f` |
| App log | `tail -f /var/log/nano-vm-demo/app.log` |

---

## Re-deploy after code changes

```bash
# Upload updated files
scp main.py root@<VPS_IP>:/opt/nano-vm-demo/
scp static/index.html static/stripe-mock-adapter.js root@<VPS_IP>:/opt/nano-vm-demo/static/

# Restart app
ssh root@<VPS_IP> "systemctl restart nano-vm-demo"
```

---

## GitHub redirect (optional)

To redirect `github.com/youruser/nano-vm` visitors to the demo, add to your
GitHub repository README:

```markdown
## Live Demo
→ [demo.yourdomain.com](https://demo.yourdomain.com)
```

Or add a `website` field in the GitHub repo settings:
`https://demo.yourdomain.com`

---

## Environment variables

Defined in the systemd unit at `/etc/systemd/system/nano-vm-demo.service`.
Edit and restart to change:

```bash
# Edit
nano /etc/systemd/system/nano-vm-demo.service

# Apply
systemctl daemon-reload && systemctl restart nano-vm-demo
```

| Variable | Default | Purpose |
|----------|---------|---------|
| `STRIPE_MOCK_HOST` | `http://127.0.0.1:12111` | stripe-mock URL |
| `STRIPE_SK` | `sk_test_mock_demo_key_nanovo7` | Stripe secret key (test) |
| `STRIPE_PK` | `pk_test_mock_demo_key_nanovo7` | Stripe publishable key (test) |

To use a real Stripe test account, replace with your `sk_test_` / `pk_test_`
keys and remove `STRIPE_MOCK_HOST`.

---

## SSL renewal

Certbot auto-renewal is configured via a systemd timer (installed by certbot):

```bash
systemctl status certbot.timer
# Force renewal test (dry run):
certbot renew --dry-run
```

---

## Troubleshooting

**App not starting:**
```bash
journalctl -u nano-vm-demo -n 50 --no-pager
```

**SSE not streaming (events frozen in browser):**
Ensure the nginx `location /api/stream/` block has `proxy_buffering off`.
Check: `grep -A5 "api/stream" /etc/nginx/sites-available/nano-vm-demo`

**stripe-mock not responding:**
```bash
systemctl status stripe-mock
curl http://127.0.0.1:12111/v1/charges -u sk_test_mock:
```

**certbot failed (DNS not propagated yet):**
```bash
# After DNS propagates:
certbot --nginx -d demo.yourdomain.com --email your@email.com --agree-tos --non-interactive
systemctl reload nginx
```

**Port 8000 already in use:**
```bash
lsof -i :8000
```
