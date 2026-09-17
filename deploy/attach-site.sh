#!/usr/bin/env bash
# Stage 3 — puts DOMAIN (from /opt/travelar/.env) behind the proxy that serves
# furnify and softech.agency, with its own Let's Encrypt certificate.
# Runbook steps 05 and 06. Safe to re-run; it resumes where it left off.
#
#   bash attach-site.sh [email-for-letsencrypt]     (default: SUPER_ADMIN_EMAIL)
#
# Order matters and is enforced:
#   1. DNS must already point here — a failed certbot run spends Let's Encrypt's
#      rate limit (5 failures per hour, 5 certificates per domain per week).
#   2. A port-80-only block goes in first. furnify's `listen 80 default_server`
#      answers unknown names with 444, which would kill the ACME challenge.
#   3. Certificate.
#   4. Only now the HTTPS block: nginx refuses to start when ssl_certificate
#      points at a file that does not exist.
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
. "$SRC/lib.sh"

require_root
load_domain
EMAIL="${1:-$(env_get SUPER_ADMIN_EMAIL)}"
[ -n "$EMAIL" ] || die "usage: bash attach-site.sh your-real@email"
is_placeholder_email "$EMAIL" \
  && die "\"$EMAIL\" is not a usable email for Let's Encrypt. $(placeholder_email_help "$EMAIL")"

step "1. Preflight"
docker inspect "$NGINX_CTR" >/dev/null 2>&1 || die "container $NGINX_CTR not found"
[ -f "$HATIM_COMPOSE" ] || die "$HATIM_COMPOSE not found"

# This box's public address is wherever the neighbours resolve — they are
# served from here, whatever the interfaces say.
server_ips=$(resolve_v4 furnify.softech.agency)
point_to=${server_ips:-"the server IPv4 address"}
resolved=$(resolve_v4 "$DOMAIN")
[ -n "$resolved" ] || die "$DOMAIN has no DNS record yet. In hPanel -> Domains -> DNS Manager for softech.agency,
       add:  Type A   Name ${DOMAIN%%.softech.agency}   Points to $point_to
       then wait until  dig +short $DOMAIN  prints that address, and run this again."
ours=" $(hostname -I 2>/dev/null || true) $server_ips "
for ip in $resolved; do
  case "$ours" in
    *" $ip "*) ;;
    *) die "$DOMAIN resolves to $ip, which is not this server. Fix the A record first — certbot would fail and spend the rate limit." ;;
  esac
done
ok "$DOMAIN -> $resolved"

BEFORE=$(neighbour_codes)
info "neighbours: $BEFORE"
case " $BEFORE" in *"=000"*) die "a neighbour is not answering already — fix that before touching the proxy" ;; esac

step "2. Claiming port 80 for the ACME challenge"
if cert_exists; then
  ok "certificate already exists — skipping to the HTTPS block"
else
  render "$SRC/nginx/acme.conf.template"
  ok "wrote $OUR_CONF (port 80 only)"
  if mounted; then
    nginx_reload || die "nginx -t rejected the ACME block — nothing was reloaded"
    ok "reloaded"
  else
    ensure_mount
  fi

  step "3. Certificate"
  ( cd "$HATIM_STACK" && docker compose run --rm certbot certonly \
      --webroot -w /var/www/certbot \
      -d "$DOMAIN" \
      --cert-name "$DOMAIN" \
      --email "$EMAIL" --agree-tos --no-eff-email --non-interactive ) \
    || die "certbot failed. The port-80 block stays (it is harmless). Check that http://$DOMAIN/.well-known/acme-challenge/ reaches this server, then re-run."
  cert_exists || die "certbot finished but $CERT is not visible inside $NGINX_CTR"
  ok "certificate issued"
fi

step "4. HTTPS vhost"
render "$SRC/nginx/site.conf.template"
if ! mounted; then
  ensure_mount
fi
# Prove the container reads the file just written (not a detached inode)
# before trusting anything nginx -t says about it.
docker exec "$NGINX_CTR" grep -q 'travelar-web' "$TARGET" \
  || die "$NGINX_CTR still sees the old $TARGET — its bind mount points at a stale inode. Run: docker restart $NGINX_CTR"
if ! nginx_reload; then
  render "$SRC/nginx/acme.conf.template"
  docker exec "$NGINX_CTR" nginx -t >/dev/null 2>&1 && docker exec "$NGINX_CTR" nginx -s reload
  die "nginx -t rejected the HTTPS block — put the port-80 block back; nothing broken was loaded"
fi
ok "reloaded gracefully"

step "5. Verifying"
sleep 2
AFTER=$(neighbour_codes)
info "neighbours: $AFTER"
if [ "$AFTER" != "$BEFORE" ]; then
  render "$SRC/nginx/acme.conf.template"
  docker exec "$NGINX_CTR" nginx -t >/dev/null 2>&1 && docker exec "$NGINX_CTR" nginx -s reload
  die "a neighbour changed ($BEFORE -> $AFTER). Travelar's HTTPS block was withdrawn again; investigate before re-running."
fi
ok "furnify and softech.agency unaffected"

SUBJECT=$(served_subject "$DOMAIN")
case "$SUBJECT" in
  *"$DOMAIN"*) ok "serving its own certificate ($SUBJECT)" ;;
  *) die "the proxy presents '$SUBJECT' for $DOMAIN — the vhost is not being used" ;;
esac

SELF=$(http_code "https://$DOMAIN/login")
case "$SELF" in
  200) ok "https://$DOMAIN/login -> 200 — live" ;;
  502) info "https://$DOMAIN/ -> 502: expected until the stack is up (install.sh)" ;;
  *)   info "https://$DOMAIN/login -> $SELF; check: docker logs travelar-web --tail 30" ;;
esac
