#!/usr/bin/env bash
# Stage 2 — starts the Travelar stack and installs the two timers. Safe to
# re-run; after a `git pull` it installs the updated scripts.
#
#   bash install.sh
#
# Touches no other project: the stack publishes no port and only joins the
# proxy network. The site stays unreachable until attach-site.sh adds its vhost.
#
# Timers, both no-ops in the common case:
#   travelar-deploy  every 2 min — pulls newly published images and rolls
#                    forward, or back if the new release is not healthy
#   travelar-vhost   every 2 min — re-attaches the vhost if a furnify deploy
#                    dropped it
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
. "$SRC/lib.sh"

require_root
[ -f "$APP_DIR/docker-compose.yml" ] || die "$APP_DIR/docker-compose.yml not found — run bootstrap.sh first"
load_domain
for key in POSTGRES_PASSWORD BETTER_AUTH_SECRET ACCESS_TOKEN_SECRET REFRESH_TOKEN_SECRET SUPER_ADMIN_EMAIL SUPER_ADMIN_PASSWORD API_IMAGE WEB_IMAGE; do
  [ -n "$(env_get "$key")" ] || die "$key is empty in $ENV_FILE"
done

step "1. Scripts"
# A copy that does not depend on the git clone staying where it is.
rm -rf "$LIB_DIR"
mkdir -p "$LIB_DIR"
cp -r "$SRC/lib.sh" "$SRC/ensure-site.sh" "$SRC/nginx" "$SRC/agent" "$LIB_DIR/"
chmod 0755 "$LIB_DIR/ensure-site.sh" "$LIB_DIR/agent/travelar-deploy.sh"
ok "installed into $LIB_DIR"

step "2. First release"
cd "$APP_DIR"
if ! docker compose pull; then
  die "could not pull the images. Has each repo's Deploy workflow finished once, and is each
       package public? GitHub -> Packages -> travelar-api / travelar-web -> Package settings
       -> Change visibility -> Public"
fi
# The agent does the rest: start, wait for health, report.
bash "$LIB_DIR/agent/travelar-deploy.sh" || die "the stack did not become healthy — see the logs above"
docker ps --filter name=travelar- --format '     {{.Names}}  {{.Status}}'

step "3. Timers"
for unit in travelar-deploy travelar-vhost; do
  install -m 0644 "$SRC/agent/$unit.service" /etc/systemd/system/
  install -m 0644 "$SRC/agent/$unit.timer"   /etc/systemd/system/
done
systemctl daemon-reload
systemctl enable --now travelar-deploy.timer travelar-vhost.timer
systemctl list-timers 'travelar-*' --no-pager | head -4

cat <<EOF

$(printf '\033[1mStage 2 done.\033[0m') The stack is running, reachable only inside Docker.

Next, if $DOMAIN is not attached yet:
  bash $SRC/attach-site.sh
EOF
