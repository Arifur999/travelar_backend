#!/usr/bin/env bash
# Renews DOMAIN's Let's Encrypt certificate. Run daily by travelar-cert.timer.
#
# The certbot service in furnify's compose file sits behind a compose profile
# and only runs when someone calls it. This timer makes sure Travelar's
# certificate does not depend on anything else remembering to renew it;
# otherwise TLS would start failing 90 days after attach-site.sh.
#
# certbot itself decides whether a renewal is due (inside 30 days of expiry),
# so most days this is a no-op. Only our own certificate is touched
# (--cert-name). nginx is reloaded gracefully, after `nginx -t`, and only when
# the certificate file actually changed.
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
. "$SRC/lib.sh"

require_root
load_domain
docker inspect "$NGINX_CTR" >/dev/null 2>&1 || die "container $NGINX_CTR not found"
cert_exists || exit 0

fingerprint() { docker exec "$NGINX_CTR" sha256sum "$CERT" 2>/dev/null | cut -d' ' -f1; }

before=$(fingerprint)
if ! out=$( cd "$HATIM_STACK" && docker compose run --rm -T certbot renew \
              --cert-name "$DOMAIN" --non-interactive 2>&1 ); then
  printf '%s\n' "$out"
  die "certbot renew failed for $DOMAIN — the current certificate stays in use; check the output above"
fi
after=$(fingerprint)

if [ "$before" = "$after" ]; then
  exit 0
fi

loud "renewed the certificate for $DOMAIN"
nginx_reload >/dev/null || die "nginx -t failed after renewing $DOMAIN — not reloading"
# `nginx -s reload` returns before the new workers take over.
sleep 3
loud "nginx reloaded; now serving $(served_subject "$DOMAIN")"
