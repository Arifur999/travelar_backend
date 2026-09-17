# Shared by the Travelar deploy scripts. Sourced, never run on its own.
#
# The nginx container on this box (hatim_backend-nginx-1) belongs to the
# furnify stack and also serves softech.agency. Everything here is written so
# that a mistake costs Travelar its own hostname and nothing else:
#   * our vhost is our own file, bind mounted into conf.d — never an edit to
#     furnify's nginx.conf, which its deploy rewrites on every release
#   * before the proxy is recreated with a new mount, the result is test-loaded
#     in a throwaway copy of the container (same image, mounts and network)
#   * the proxy is recreated with --no-deps, so furnify's own containers are
#     never touched, and reloaded only after `nginx -t` passes
#   * the neighbours' HTTP status is recorded before and compared after

APP_DIR=/opt/travelar
ENV_FILE="$APP_DIR/.env"
NGINX_DIR="$APP_DIR/nginx"
LIB_DIR=/usr/local/lib/travelar

PROXY_NET=hatim_backend_default
NGINX_CTR=hatim_backend-nginx-1
HATIM_STACK=/srv/hatim/hatim_Backend
HATIM_COMPOSE="$HATIM_STACK/docker-compose.yml"
# The mount every extra vhost line is inserted directly under.
HATIM_ANCHOR="- ./nginx.conf:/etc/nginx/conf.d/default.conf:ro"

# Sites that must answer exactly as before through anything done here.
NEIGHBOURS=(https://softech.agency/ https://furnify.softech.agency/)

QUIET=${QUIET:-0}
ok()   { [ "$QUIET" = 1 ] || printf '\033[32m  ok\033[0m  %s\n' "$1"; }
info() { [ "$QUIET" = 1 ] || printf '\033[36m  ..\033[0m  %s\n' "$1"; }
step() { [ "$QUIET" = 1 ] || printf '\n\033[1m%s\033[0m\n' "$1"; }
loud() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1"; }
die()  { printf '\033[31m FAIL\033[0m  %s\n' "$1" >&2; exit 1; }

require_root() { [ "$(id -u)" -eq 0 ] || die "run as root"; }

# resolve_v4 NAME — its IPv4 addresses, space separated; empty when it has none.
# Never fails: getent exits 2 for an unknown name, and under `set -e -o pipefail`
# that used to end attach-site.sh silently instead of saying what was wrong.
resolve_v4() {
  { getent ahostsv4 "$1" || true; } | awk '{print $1}' | sort -u | tr '\n' ' ' | sed 's/ $//'
}

# The examples in the docs and messages, which must never become a real login
# or the Let's Encrypt contact.
is_placeholder_email() {
  case "$1" in
    your@email.com|you@example.com|*@example.com|*@example.org|*@example.net) return 0 ;;
    *) return 1 ;;
  esac
}

# The fix for a placeholder operator email. It only works before the API's
# first boot, which is when the operator account is created from it.
placeholder_email_help() {
  cat <<EOF
SUPER_ADMIN_EMAIL in $ENV_FILE is still the example address ($1).
       It becomes the operator login on the API's first start, so set yours first:
         sed -i 's|^SUPER_ADMIN_EMAIL=.*|SUPER_ADMIN_EMAIL=you@yourdomain|' $ENV_FILE
EOF
}

# env_get KEY — a value from /opt/travelar/.env, surrounding quotes removed.
# Read, never sourced: values such as BACKUP_SCHEDULE contain spaces and globs.
env_get() {
  [ -f "$ENV_FILE" ] || return 0
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1 \
    | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}

# Sets DOMAIN, OUR_CONF (on the host) and TARGET (inside the proxy).
load_domain() {
  DOMAIN=$(env_get DOMAIN)
  [ -n "$DOMAIN" ] || die "DOMAIN is not set in $ENV_FILE — run bootstrap.sh first"
  OUR_CONF="$NGINX_DIR/$DOMAIN.conf"
  TARGET="/etc/nginx/conf.d/$DOMAIN.conf"
  CERT="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
}

# render TEMPLATE — writes it to OUR_CONF with the domain filled in.
#
# Truncate-and-write, never a rename: OUR_CONF is a SINGLE-FILE bind mount, and
# those follow the inode. `sed -i` or `mv` swaps the inode, the container keeps
# reading the old file, and `nginx -t` then validates stale content while the
# reload appears to succeed and changes nothing.
render() {
  local tmp
  tmp=$(mktemp)
  sed "s/__DOMAIN__/$DOMAIN/g" "$1" > "$tmp"
  mkdir -p "$NGINX_DIR"
  cat "$tmp" > "$OUR_CONF"
  rm -f "$tmp"
}

cert_exists() { docker exec "$NGINX_CTR" test -f "$CERT" 2>/dev/null; }
mounted()     { docker exec "$NGINX_CTR" test -f "$TARGET" 2>/dev/null; }

http_code() {
  curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$1" 2>/dev/null || true
}

# "url=code url=code", for comparing before and after.
neighbour_codes() {
  local out="" url
  for url in "${NEIGHBOURS[@]}"; do out+="$url=$(http_code "$url") "; done
  printf '%s' "${out% }"
}

neighbours_healthy() {
  local url code
  for url in "${NEIGHBOURS[@]}"; do
    code=$(http_code "$url")
    case "$code" in 2*|3*|4*) ;; *) return 1 ;; esac
  done
}

# The certificate the proxy presents for a name, as "subject=CN=...".
served_subject() {
  echo | timeout 10 openssl s_client -connect 127.0.0.1:443 -servername "$1" 2>/dev/null \
    | openssl x509 -noout -subject 2>/dev/null || true
}

nginx_reload() {
  # Full output: "conflicting server name" is only a warning, and hiding it
  # once made a duplicated block look like a clean apply.
  if ! docker exec "$NGINX_CTR" nginx -t; then
    return 1
  fi
  docker exec "$NGINX_CTR" nginx -s reload
}

# Loads the proxy's config exactly as a recreated container would see it — its
# image, its mounts, its network, plus our file — without touching the live one.
dry_run_with_our_mount() {
  local image
  image=$(docker inspect -f '{{.Config.Image}}' "$NGINX_CTR")
  docker run --rm \
    --volumes-from "$NGINX_CTR" \
    -v "$OUR_CONF:$TARGET:ro" \
    --network "$PROXY_NET" \
    --entrypoint nginx \
    "$image" -t
}

# Makes the proxy see OUR_CONF at TARGET. No-op when it already does.
ensure_mount() {
  mounted && return 0

  [ -f "$HATIM_COMPOSE" ] || die "$HATIM_COMPOSE not found"
  [ -f "$OUR_CONF" ] || die "$OUR_CONF does not exist yet"

  info "test-loading the proxy config with $DOMAIN in a throwaway container"
  dry_run_with_our_mount || die "nginx rejected the config with $OUR_CONF mounted — the live proxy was not touched"

  local backup=""
  if grep -qF "$OUR_CONF:$TARGET" "$HATIM_COMPOSE"; then
    info "furnify's compose already declares the mount; the container just needs recreating"
  else
    grep -qF -- "$HATIM_ANCHOR" "$HATIM_COMPOSE" \
      || die "anchor line not found in $HATIM_COMPOSE: $HATIM_ANCHOR"
    backup="$HATIM_COMPOSE.bak-$(date +%Y%m%d-%H%M%S)"
    cp "$HATIM_COMPOSE" "$backup"
    python3 - "$HATIM_COMPOSE" "$HATIM_ANCHOR" "- $OUR_CONF:$TARGET:ro" <<'PY'
import re, sys
path, anchor, line = sys.argv[1:4]
text = open(path).read()
indent = re.search(r"^([ \t]*)" + re.escape(anchor), text, re.M).group(1)
# Written in place (truncate + write) for the same inode reason as render().
with open(path, "r+") as f:
    f.seek(0)
    f.write(text.replace(anchor, f"{anchor}\n{indent}{line}", 1))
    f.truncate()
PY
    ok "added the mount to $HATIM_COMPOSE (backup: $backup)"
  fi

  info "recreating only the nginx container (--no-deps: furnify's own containers are left alone)"
  ( cd "$HATIM_STACK" && docker compose up -d --no-deps nginx )

  local i
  for i in $(seq 1 15); do
    [ "$(docker inspect -f '{{.State.Running}}' "$NGINX_CTR" 2>/dev/null)" = "true" ] && break
    sleep 1
  done

  if ! mounted || ! docker exec "$NGINX_CTR" nginx -t >/dev/null 2>&1; then
    if [ -n "$backup" ]; then
      cat "$backup" > "$HATIM_COMPOSE"
      ( cd "$HATIM_STACK" && docker compose up -d --no-deps nginx )
      die "the recreated proxy did not accept $TARGET — compose file restored from $backup and nginx recreated"
    fi
    die "the recreated proxy does not see $TARGET — check: docker logs $NGINX_CTR --tail 30"
  fi
  ok "proxy recreated and sees $TARGET"
}
