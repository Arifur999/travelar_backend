#!/usr/bin/env bash
# Keeps DOMAIN attached to the proxy. Run every 2 minutes by travelar-vhost.timer.
#
# Why it can come undone: /srv/hatim/hatim_Backend belongs to the furnify
# deploy, which can rewrite its docker-compose.yml and drop our mount. softech
# .agency lost its certificate that way twice before this check existed.
#
# Cheap and idempotent: the common case is one `docker exec test -f` and a TLS
# probe. It repairs only what is actually missing, never acts while a
# neighbour is unhealthy, and never installs the HTTPS block before the
# certificate exists (nginx would refuse to start, taking every site down).
#
#   bash ensure-site.sh            verbose, for running by hand
#   bash ensure-site.sh --quiet    silent unless it repaired something
set -euo pipefail

[ "${1:-}" = "--quiet" ] && QUIET=1
SRC="$(cd "$(dirname "$0")" && pwd)"
. "$SRC/lib.sh"

require_root
load_domain
docker inspect "$NGINX_CTR" >/dev/null 2>&1 || die "container $NGINX_CTR not found"

if ! cert_exists; then
  info "no certificate for $DOMAIN yet — nothing to keep attached (run attach-site.sh)"
  exit 0
fi

# Fast path: attached, and the proxy presents our certificate for our name.
if mounted && docker exec "$NGINX_CTR" grep -q 'travelar-web' "$TARGET" 2>/dev/null; then
  case "$(served_subject "$DOMAIN")" in
    *"$DOMAIN"*) ok "attached and serving the right certificate"; exit 0 ;;
  esac
  loud "$TARGET is mounted but nginx is not using it — reloading"
  nginx_reload >/dev/null || die "nginx -t failed with $TARGET — not reloading"
  loud "reloaded"
  exit 0
fi

loud "$DOMAIN is not attached to $NGINX_CTR — repairing"
neighbours_healthy || die "a neighbour is unhealthy right now ($(neighbour_codes)) — not touching the proxy"
BEFORE=$(neighbour_codes)

render "$SRC/nginx/site.conf.template"
ensure_mount
docker exec "$NGINX_CTR" grep -q 'travelar-web' "$TARGET" \
  || die "$NGINX_CTR still sees an old $TARGET (stale inode) — run: docker restart $NGINX_CTR"
nginx_reload >/dev/null || die "nginx -t failed with $TARGET — not reloading"

sleep 2
AFTER=$(neighbour_codes)
[ "$AFTER" = "$BEFORE" ] || die "a neighbour changed after the repair ($BEFORE -> $AFTER) — investigate"
loud "repaired: $DOMAIN -> $(http_code "https://$DOMAIN/login"); neighbours unchanged"
