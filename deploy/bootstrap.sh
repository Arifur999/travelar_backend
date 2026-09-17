#!/usr/bin/env bash
# Stage 1 — prepares /opt/travelar. Touches NOTHING that serves traffic: no
# nginx config, no container, no other project's files. Safe to re-run; after
# a `git pull` it refreshes the compose file and backup scripts.
#
#   bash bootstrap.sh your-real@email [travelar.softech.agency]
#
# The email becomes the platform operator's login (SUPER_ADMIN_EMAIL) and the
# Let's Encrypt contact.
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$SRC/.." && pwd)"
. "$SRC/lib.sh"

EMAIL="${1:-}"
DOMAIN_ARG="${2:-travelar.softech.agency}"

require_root

step "1. What is already here"
command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1 \
  || die "docker with the compose plugin is required (it runs furnify already, so this should not happen)"
docker network inspect "$PROXY_NET" >/dev/null 2>&1 \
  || die "network $PROXY_NET not found — it belongs to the furnify stack"
docker inspect "$NGINX_CTR" >/dev/null 2>&1 || die "container $NGINX_CTR not found"
command -v openssl >/dev/null 2>&1 || die "openssl is required"
ok "docker, $PROXY_NET and $NGINX_CTR present"

step "2. $APP_DIR"
mkdir -p "$APP_DIR/nginx" "$APP_DIR/backups" "$APP_DIR/ops"

if [ -f "$APP_DIR/docker-compose.yml" ] && ! cmp -s "$SRC/docker-compose.yml" "$APP_DIR/docker-compose.yml"; then
  cp "$APP_DIR/docker-compose.yml" "$APP_DIR/docker-compose.yml.bak-$(date +%Y%m%d-%H%M%S)"
  info "compose file changed — previous one kept as a .bak"
fi
cp "$SRC/docker-compose.yml" "$APP_DIR/docker-compose.yml"
rm -rf "$APP_DIR/ops/backup"
cp -r "$REPO/ops/backup" "$APP_DIR/ops/backup"
ok "docker-compose.yml and ops/backup in place"

step "3. $ENV_FILE"
if [ -f "$ENV_FILE" ]; then
  ok "already exists — left as is (DOMAIN=$(env_get DOMAIN))"
  current=$(env_get SUPER_ADMIN_EMAIL)
  [ -n "$current" ] && is_placeholder_email "$current" && printf '\033[33m WARN\033[0m  %s\n' "$(placeholder_email_help "$current")"
else
  [ -n "$EMAIL" ] || die "usage: bash bootstrap.sh your-real@email [domain]  (the email is needed to create .env)"
  is_placeholder_email "$EMAIL" \
    && die "\"$EMAIL\" is not a usable email address. Give your own — it becomes the operator login and the Let's Encrypt contact."
  secret() { openssl rand -hex 32; }
  # Letters, digits and a symbol, so it passes any password rule.
  operator_password="Tv-$(openssl rand -hex 10)"
  umask 077
  sed \
    -e "s|^DOMAIN=.*|DOMAIN=$DOMAIN_ARG|" \
    -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(secret)|" \
    -e "s|^BETTER_AUTH_SECRET=.*|BETTER_AUTH_SECRET=$(secret)|" \
    -e "s|^ACCESS_TOKEN_SECRET=.*|ACCESS_TOKEN_SECRET=$(secret)|" \
    -e "s|^REFRESH_TOKEN_SECRET=.*|REFRESH_TOKEN_SECRET=$(secret)|" \
    -e "s|^SUPER_ADMIN_EMAIL=.*|SUPER_ADMIN_EMAIL=$EMAIL|" \
    -e "s|^SUPER_ADMIN_PASSWORD=.*|SUPER_ADMIN_PASSWORD=$operator_password|" \
    "$SRC/travelar.env.example" > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  ok "wrote $ENV_FILE with generated secrets (mode 600)"
  info "operator login: $EMAIL — password: grep SUPER_ADMIN_PASSWORD $ENV_FILE"
fi

step "4. Nothing else changed"
info "containers running:"
docker ps --format '     {{.Names}}  {{.Status}}'

cat <<EOF

$(printf '\033[1mStage 1 done.\033[0m') Nothing serving traffic was touched.

Next:
  1. Optional now, needed before real customers: fill in the SMTP and
     SSLCommerz values in $ENV_FILE
  2. bash $SRC/install.sh          start the stack and the release timers
  3. bash $SRC/attach-site.sh      certificate + nginx vhost for $(env_get DOMAIN)
EOF
