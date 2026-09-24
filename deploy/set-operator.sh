#!/usr/bin/env bash
# Changes what signs into the platform operator account, on a running stack.
#
#   bash set-operator.sh
#
# SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD in .env only ever seed the account,
# on the very first boot — seedSuperAdmin() returns early once one exists. After
# that, editing them does nothing, and this is the way to change the login.
#
# Nothing is typed on a command line, so no value reaches shell history, a
# process list or `docker inspect`: the answers go to the container on stdin.
# The password is read without echo, and asked for twice.
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
. "$SRC/lib.sh"

require_root
[ -f "$ENV_FILE" ] || die "$ENV_FILE not found — run bootstrap.sh first"
docker inspect "$API_CTR" >/dev/null 2>&1 \
  || die "container $API_CTR is not running — start the stack first (install.sh)"

# The refusal is read, not just shown: an address already taken is an ordinary
# outcome with a second question after it, and any other failure is not.
TMP_ERR=$(mktemp)
trap 'rm -f "$TMP_ERR"' EXIT

# Answers come from the terminal even when this script's own stdin is not one.
if { true </dev/tty; } 2>/dev/null; then IN=/dev/tty; else IN=/dev/stdin; fi

# setOperator.ts reads one value per line, in this order. Lines rather than
# JSON because quoting a password containing \ or " into JSON from bash is
# exactly where this goes wrong.
send() {
  printf '%s\n%s\n%s\n%s\n' "$EMAIL" "$PASSWORD" "$NAME" "${1:-}" \
    | docker exec -i "$API_CTR" node --import tsx src/scripts/setOperator.ts
}

printf '\033[1mThe operator signs in with these.\033[0m\n' >&2

EMAIL=""
while [ -z "$EMAIL" ]; do
  printf '  Email: ' >&2
  IFS= read -r EMAIL <"$IN" || die "no answer"
  case "$EMAIL" in
    *@*) ;;
    *) printf '    that is not an email address\n' >&2; EMAIL="" ;;
  esac
done

PASSWORD=""
while [ -z "$PASSWORD" ]; do
  printf '  Password (at least 8 characters, not shown): ' >&2
  IFS= read -rs PASSWORD <"$IN" || die "no answer"
  printf '\n' >&2

  if [ "${#PASSWORD}" -lt 8 ]; then
    printf '    too short\n' >&2
    PASSWORD=""
    continue
  fi

  printf '  Again: ' >&2
  IFS= read -rs CONFIRM <"$IN" || die "no answer"
  printf '\n' >&2
  [ "$PASSWORD" = "$CONFIRM" ] || { printf '    they do not match\n' >&2; PASSWORD=""; }
done

printf '  Display name (blank to leave it): ' >&2
IFS= read -r NAME <"$IN" || NAME=""

if send "" 2>"$TMP_ERR"; then
  ok "done — sign in at https://$(env_get DOMAIN)/login"
  exit 0
fi

cat "$TMP_ERR" >&2
# Anything else is a real failure, and nothing was written: the script does its
# work in one transaction.
grep -q "already belongs to" "$TMP_ERR" || die "the operator was not changed"

# The owner of a platform usually also runs an agency on it, so their address
# being taken is the normal case rather than a mistake. Moving that account is
# a second, deliberate answer — it is somebody's login.
printf '\n  Move that account to which address? (blank to cancel): ' >&2
IFS= read -r MOVE <"$IN" || MOVE=""
[ -n "$MOVE" ] || die "cancelled — nothing was changed"

send "$MOVE" || die "the operator was not changed"

ok "done — sign in at https://$(env_get DOMAIN)/login"
