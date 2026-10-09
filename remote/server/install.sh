#!/usr/bin/env bash
# DSH Remote server installer for Debian/Ubuntu. Run as root; safe to re-run.
set -euo pipefail

usage() {
  cat <<'EOF'
DSH Remote server installer for Debian/Ubuntu. Run as root; safe to re-run.

  install.sh [options]

  --domain NAME          also publish dsh at https://NAME/ behind a password login
  --tls MODE             letsencrypt (default) | selfsigned (e.g. behind Cloudflare "Full") | none (plain HTTP, not recommended)
  --email ADDR           Let's Encrypt account e-mail (optional)
  --password PW          set the browser password (default: keep the existing one, or generate one)
  --workdir DIR          dsh working directory (default /home/dsh/workspace)
  --dsh-version VER      npm version or tag of @deepseek-ai/dsh (default latest)
  --no-copy-root-keys    do not copy root's SSH authorized_keys to the dsh user

Without --domain, dsh is reachable only through SSH tunnels (DSH Remote's SSH mode).
EOF
}

REPO="${DSH_REMOTE_REPO:-JoshuaNibaba/dsh-pro}" REF="${DSH_REMOTE_REF:-main}"
DOMAIN="" TLS="letsencrypt" EMAIL="" PASSWORD="" WORKDIR="/home/dsh/workspace" DSH_VERSION="latest" COPY_KEYS=1
WEB_PORT=18790 GATEWAY_PORT=18800
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --tls) TLS="$2"; shift 2 ;;
    --email) EMAIL="$2"; shift 2 ;;
    --password) PASSWORD="$2"; shift 2 ;;
    --workdir) WORKDIR="$2"; shift 2 ;;
    --dsh-version) DSH_VERSION="$2"; shift 2 ;;
    --no-copy-root-keys) COPY_KEYS=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
case "$TLS" in letsencrypt|selfsigned|none) ;; *) echo "--tls must be letsencrypt, selfsigned or none" >&2; exit 2 ;; esac
[ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 1; }
command -v apt-get >/dev/null || { echo "this installer supports Debian/Ubuntu only" >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive
step() { printf '\n==> %s\n' "$*"; }

# Source files: next to this script (remote/server in a clone), or downloaded one by
# one from GitHub when piped through curl, which avoids fetching the whole repository.
SRC="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"
if [ ! -f "$SRC/gateway.mjs" ]; then
  step "Downloading remote/server from $REPO@$REF"
  SRC="$(mktemp -d)"
  for f in run-web.sh web.patch.yml gateway.mjs dsh-update nginx-acme.conf nginx-http.conf nginx-https.conf; do
    curl -fsSL "https://raw.githubusercontent.com/$REPO/$REF/remote/server/$f" -o "$SRC/$f"
  done
fi

step "System packages"
apt-get update -q >/dev/null 2>&1
apt-get install -y -q curl ca-certificates git rsync xz-utils build-essential python3 sudo >/dev/null 2>&1

step "Node.js 22"
need_node=1
if command -v node >/dev/null; then
  node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=19)?0:1)' && need_node=0
fi
if [ "$need_node" = 1 ]; then
  arch="$(uname -m)"; case "$arch" in x86_64) arch=x64 ;; aarch64) arch=arm64 ;; esac
  base="https://nodejs.org/dist/latest-v22.x"
  file="$(curl -fsSL "$base/SHASUMS256.txt" | grep -o "node-v22[0-9.]*-linux-$arch.tar.xz" | head -1)"
  (cd /tmp && curl -fsSLO "$base/$file" && curl -fsSL "$base/SHASUMS256.txt" | grep " $file\$" | sha256sum -c - >/dev/null)
  # --no-same-owner: the tarball's files belong to uid 1000; as root, tar would keep that
  # owner and let whoever later gets uid 1000 replace node, npm and dsh.
  tar -xJf "/tmp/$file" -C /usr/local --strip-components=1 --no-same-owner --exclude=CHANGELOG.md --exclude=LICENSE --exclude=README.md
  rm -f "/tmp/$file"
fi
# Installs before --no-same-owner left Node's files owned by the tarball's uid 1000.
# Give them back to root, but only when that uid is not a real account.
node_uid="$(stat -c %u "$(command -v node)")"
if [ "$node_uid" != 0 ] && ! getent passwd "$node_uid" >/dev/null; then
  find /usr/local -xdev -uid "$node_uid" -exec chown -h root:root {} +
fi
node -v

step "dsh user and files"
id dsh >/dev/null 2>&1 || useradd -m -s /bin/bash dsh
install -d -o dsh -g dsh "$WORKDIR"
install -d -m 755 /opt/dsh-remote /etc/dsh-remote
install -m 755 "$SRC/run-web.sh" /opt/dsh-remote/run-web.sh
install -m 644 "$SRC/web.patch.yml" /opt/dsh-remote/web.patch.yml
install -m 644 "$SRC/gateway.mjs" /opt/dsh-remote/gateway.mjs
install -m 755 "$SRC/dsh-update" /usr/local/sbin/dsh-update
if [ "$COPY_KEYS" = 1 ] && [ -s /root/.ssh/authorized_keys ]; then
  install -d -m 700 -o dsh -g dsh /home/dsh/.ssh
  touch /home/dsh/.ssh/authorized_keys
  while IFS= read -r key; do
    [ -n "$key" ] && ! grep -qxF "$key" /home/dsh/.ssh/authorized_keys && printf '%s\n' "$key" >> /home/dsh/.ssh/authorized_keys
  done < <(grep -E '^(ssh-|ecdsa-|sk-)' /root/.ssh/authorized_keys)
  chown dsh:dsh /home/dsh/.ssh/authorized_keys; chmod 600 /home/dsh/.ssh/authorized_keys
fi
# Lets the dsh SSH user (and DSH Remote) restart the services, read their logs and
# upgrade dsh (dsh-update only accepts an npm version or tag), nothing else.
cat > /etc/sudoers.d/dsh-remote <<'EOF'
dsh ALL=(root) NOPASSWD: /usr/bin/systemctl restart dsh-web, /usr/bin/systemctl restart dsh-gateway, /usr/bin/journalctl -u dsh-web -o cat --no-pager -n 200, /usr/bin/journalctl -u dsh-gateway -o cat --no-pager -n 200, /usr/local/sbin/dsh-update
EOF
chmod 440 /etc/sudoers.d/dsh-remote
visudo -cf /etc/sudoers.d/dsh-remote >/dev/null

step "dsh ($DSH_VERSION)"
/usr/local/sbin/dsh-update "$DSH_VERSION" --no-restart

PUBLIC_URL="" SCHEME="https"
[ "$TLS" = none ] && SCHEME="http"
[ -n "$DOMAIN" ] && PUBLIC_URL="$SCHEME://$DOMAIN/"
cat > /etc/systemd/system/dsh-web.service <<EOF
[Unit]
Description=DeepSeek Harness Web (loopback only)
After=network-online.target
Wants=network-online.target

[Service]
User=dsh
Group=dsh
WorkingDirectory=$WORKDIR
Environment=HOME=/home/dsh
Environment=PATH=/usr/local/bin:/usr/bin:/bin
Environment=DSH_WEB_PORT=$WEB_PORT
Environment=DSH_PUBLIC_URL=$PUBLIC_URL
Environment=DSH_TRUSTED_HOST=$DOMAIN
ExecStart=/opt/dsh-remote/run-web.sh
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

if [ -n "$DOMAIN" ]; then
  step "Password gateway"
  CONFIG=/etc/dsh-remote/gateway.json
  SECURE=true; [ "$TLS" = none ] && SECURE=false
  node -e '
    const fs = require("fs"), [file, secure, gw, web] = process.argv.slice(1)
    const c = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {}
    Object.assign(c, { listen: `127.0.0.1:${gw}`, upstream: `127.0.0.1:${web}`,
      urlFile: "/home/dsh/.dsh-remote/url", secureCookie: secure === "true" })
    c.sessionDays ??= 365
    fs.writeFileSync(file, JSON.stringify(c, null, 2) + "\n", { mode: 0o640 })
  ' "$CONFIG" "$SECURE" "$GATEWAY_PORT" "$WEB_PORT"
  GENERATED=""
  if [ -z "$PASSWORD" ] && ! grep -q passwordHash "$CONFIG"; then
    PASSWORD="$(node -e 'const a="abcdefghjkmnpqrstuvwxyz23456789",b=require("crypto").randomBytes(16);console.log([0,4,8,12].map(i=>[...b.subarray(i,i+4)].map(x=>a[x%a.length]).join("")).join("-"))')"
    GENERATED=1
  fi
  [ -n "$PASSWORD" ] && printf '%s' "$PASSWORD" | node /opt/dsh-remote/gateway.mjs set-password --config "$CONFIG" >/dev/null
  chown root:dsh "$CONFIG"; chmod 640 "$CONFIG"

  cat > /etc/systemd/system/dsh-gateway.service <<EOF
[Unit]
Description=DSH Remote password gateway
After=network-online.target dsh-web.service

[Service]
User=dsh
Group=dsh
ExecStart=/usr/local/bin/node /opt/dsh-remote/gateway.mjs serve --config $CONFIG
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

  step "nginx ($TLS)"
  apt-get install -y -q nginx >/dev/null 2>&1
  CERT="" KEY=""
  case "$TLS" in
    selfsigned)
      install -d -m 755 /etc/nginx/ssl
      CERT="/etc/nginx/ssl/$DOMAIN.crt" KEY="/etc/nginx/ssl/$DOMAIN.key"
      [ -f "$CERT" ] || openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=$DOMAIN" \
        -addext "subjectAltName=DNS:$DOMAIN" -keyout "$KEY" -out "$CERT" 2>/dev/null
      chmod 600 "$KEY" ;;
    letsencrypt)
      apt-get install -y -q certbot >/dev/null 2>&1
      CERT="/etc/letsencrypt/live/$DOMAIN/fullchain.pem" KEY="/etc/letsencrypt/live/$DOMAIN/privkey.pem"
      if [ ! -f "$CERT" ]; then
        # Serve the HTTP-01 challenge from the nginx that already owns port 80.
        install -d /var/www/dsh-acme
        sed -e "s/__DOMAIN__/$DOMAIN/g" "$SRC/nginx-acme.conf" > /etc/nginx/sites-available/dsh-remote.conf
        ln -sf /etc/nginx/sites-available/dsh-remote.conf /etc/nginx/sites-enabled/dsh-remote.conf
        nginx -t && systemctl reload nginx
        account=(--register-unsafely-without-email)
        [ -n "$EMAIL" ] && account=(--email "$EMAIL")
        certbot certonly --webroot -w /var/www/dsh-acme -d "$DOMAIN" --non-interactive --agree-tos "${account[@]}"
      fi
      install -d /etc/letsencrypt/renewal-hooks/deploy
      printf '#!/bin/sh\nsystemctl reload nginx\n' > /etc/letsencrypt/renewal-hooks/deploy/dsh-remote-nginx
      chmod 755 /etc/letsencrypt/renewal-hooks/deploy/dsh-remote-nginx ;;
  esac
  if [ "$TLS" = none ]; then TEMPLATE="$SRC/nginx-http.conf"; else TEMPLATE="$SRC/nginx-https.conf"; fi
  sed -e "s#__DOMAIN__#$DOMAIN#g" -e "s#__CERT__#$CERT#g" -e "s#__KEY__#$KEY#g" -e "s#__GATEWAY_PORT__#$GATEWAY_PORT#g" \
    "$TEMPLATE" > /etc/nginx/sites-available/dsh-remote.conf
  ln -sf /etc/nginx/sites-available/dsh-remote.conf /etc/nginx/sites-enabled/dsh-remote.conf
  nginx -t
  systemctl reload nginx
fi

step "Starting services"
systemctl daemon-reload
systemctl enable dsh-web >/dev/null 2>&1
systemctl restart dsh-web
if [ -n "$DOMAIN" ]; then systemctl enable dsh-gateway >/dev/null 2>&1; systemctl restart dsh-gateway; fi
for _ in $(seq 60); do [ -s /home/dsh/.dsh-remote/url ] && break; sleep 1; done
[ -s /home/dsh/.dsh-remote/url ] || { echo "dsh-web did not start; see: journalctl -u dsh-web" >&2; exit 1; }

SSH_PORT="$( (sshd -T 2>/dev/null || true) | awk '/^port /{print $2; exit}')"
cat <<EOF

DSH Remote server is ready.
  dsh version:   $(dsh --version)
  SSH mode:      DSH Remote → 设置 → 服务器 = <this server's IP or name>, SSH 端口 = ${SSH_PORT:-22}, SSH 用户 = dsh
EOF
if [ -n "$DOMAIN" ]; then
  echo "  Browser:       $PUBLIC_URL"
  echo "  Mac client:    DSH Remote → 设置 → 网页地址 = $PUBLIC_URL, 访问密码 = <password>"
  if [ -n "${GENERATED:-}" ]; then echo "  Password:      $PASSWORD   (generated; change with: install.sh --domain $DOMAIN --tls $TLS --password NEW)"; fi
fi
