#!/usr/bin/env bash
# Sets values in /opt/travelar/.env by asking for them, then applies them.
# Nothing is typed into a command line (shell history) or has to be pasted
# anywhere, and passwords are read without echo.
#
#   bash set-env.sh --smtp                       outgoing mail, then a login test
#   bash set-env.sh SSLCOMMERZ_STORE_ID SSLCOMMERZ_STORE_PASSWORD
#   bash set-env.sh KEY [KEY ...]                any setting in .env
#
# Values are stored single-quoted, which docker compose reads literally:
# spaces, #, $ and & are kept as typed. Only a single quote cannot be stored.
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
. "$SRC/lib.sh"

require_root
[ -f "$ENV_FILE" ] || die "$ENV_FILE not found — run bootstrap.sh first"
[ $# -gt 0 ] || die "usage: bash set-env.sh --smtp | KEY [KEY ...]"

is_secret() { case "$1" in *PASS*|*SECRET*|*PASSWORD*|*KEY) return 0 ;; *) return 1 ;; esac; }

# write_env KEY VALUE — replaces the line in place (the file is read by compose,
# not bind-mounted, but keeping its inode and mode costs nothing).
write_env() {
  local key=$1 value=$2 tmp
  case "$value" in *"'"*) die "$key: a single quote (') cannot be stored in .env — choose a value without one" ;; esac
  case "$value" in *$'\n'*|*$'\r'*) die "$key: one line only" ;; esac
  tmp=$(mktemp)
  KEY="$key" VALUE="$value" awk '
    BEGIN { k = ENVIRON["KEY"]; v = ENVIRON["VALUE"]; done = 0 }
    index($0, k "=") == 1 { print k "='\''" v "'\''"; done = 1; next }
    { print }
    END { if (!done) print k "='\''" v "'\''" }
  ' "$ENV_FILE" > "$tmp"
  cat "$tmp" > "$ENV_FILE"
  rm -f "$tmp"
}

# Answers come from the terminal, even when this script's stdin is not one;
# without a terminal (scripted use) they are read from stdin, one per line.
if { true </dev/tty; } 2>/dev/null; then IN=/dev/tty; else IN=/dev/stdin; fi

ask() { # ask KEY [DEFAULT] — prints the chosen value; prompts go to stderr
  local key=$1 default=${2:-} value=""
  if is_secret "$key"; then
    read -rsp "  $key (hidden): " value <"$IN" || true; echo >&2
  elif [ -n "$default" ]; then
    read -rp "  $key [$default]: " value <"$IN" || true
    value=${value:-$default}
  else
    read -rp "  $key: " value <"$IN" || true
  fi
  [ -n "$value" ] || die "$key: empty — nothing changed"
  printf '%s' "$value"
}

test_smtp=0
if [ "$1" = "--smtp" ]; then
  step "Outgoing mail"
  info "a mailbox you own; for a Hostinger mailbox the defaults below are right"
  host=$(ask EMAIL_SENDER_SMTP_HOST smtp.hostinger.com)
  port=$(ask EMAIL_SENDER_SMTP_PORT 465)
  [[ "$port" =~ ^[0-9]+$ ]] || die "EMAIL_SENDER_SMTP_PORT must be a number"
  user=$(ask EMAIL_SENDER_SMTP_USER)
  is_placeholder_email "$user" && die "EMAIL_SENDER_SMTP_USER \"$user\" is not a real mailbox address"
  pass=$(ask EMAIL_SENDER_SMTP_PASS)
  from=$(ask EMAIL_SENDER_SMTP_FROM "Travelar <$user>")
  write_env EMAIL_SENDER_SMTP_HOST "$host"
  write_env EMAIL_SENDER_SMTP_PORT "$port"
  write_env EMAIL_SENDER_SMTP_USER "$user"
  write_env EMAIL_SENDER_SMTP_PASS "$pass"
  write_env EMAIL_SENDER_SMTP_FROM "$from"
  test_smtp=1
else
  step "Settings"
  for key in "$@"; do
    [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ ]] || die "not a setting name: $key"
    grep -q "^$key=" "$ENV_FILE" || die "$key is not in $ENV_FILE"
    case "$key" in
      POSTGRES_PASSWORD|ACCESS_TOKEN_SECRET|REFRESH_TOKEN_SECRET|BETTER_AUTH_SECRET)
        die "$key is fixed after the first start (the database and every session depend on it)" ;;
    esac
    write_env "$key" "$(ask "$key")"
  done
fi
ok "saved to $ENV_FILE"

step "Applying"
# Recreates only the containers whose settings changed. The API restarts in a
# few seconds; meanwhile the web app shows its "can't reach Travelar" page.
( cd "$APP_DIR" && docker compose up -d ) >/dev/null
for i in $(seq 1 30); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' travelar-api 2>/dev/null)" = healthy ] \
    && [ "$(docker inspect -f '{{.State.Health.Status}}' travelar-web 2>/dev/null)" = healthy ] && break
  sleep 3
done
[ "$(docker inspect -f '{{.State.Health.Status}}' travelar-api 2>/dev/null)" = healthy ] \
  || die "travelar-api is not healthy after the change — see: docker logs travelar-api --tail 30"
ok "travelar-api and travelar-web healthy with the new settings"

if [ "$test_smtp" = 1 ]; then
  step "Mail server login test (nothing is sent)"
  if docker exec travelar-api node -e '
      const nodemailer = require("nodemailer");
      const port = Number(process.env.EMAIL_SENDER_SMTP_PORT);
      nodemailer.createTransport({
        host: process.env.EMAIL_SENDER_SMTP_HOST, port, secure: port === 465,
        auth: { user: process.env.EMAIL_SENDER_SMTP_USER, pass: process.env.EMAIL_SENDER_SMTP_PASS },
        connectionTimeout: 15000,
      }).verify()
        .then(() => { console.log("  ok  the mail server accepted the login"); })
        .catch((e) => { console.error("  FAIL  " + (e.response || e.message)); process.exit(1); });
    '; then
    ok "password-reset emails will now be delivered"
  else
    die "the mail server refused — run: bash $SRC/set-env.sh --smtp  and check the mailbox, password, server and port"
  fi
fi
