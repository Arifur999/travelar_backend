#!/usr/bin/env bash
# Pull-based release, run every 2 minutes by travelar-deploy.timer.
#
# Both repos publish to GHCR only after their quality gate is green; this is
# the other half. GitHub's runners cannot reach this host on port 22, so the
# release is pulled rather than pushed — and no SSH key lives in GitHub.
#
# Does nothing unless an image digest changed. When one did:
#   docker compose up -d   recreates only what changed; a new API image runs
#                          travelar-migrate to completion before the API starts
#   waits for health       travelar-api (/health, which queries Postgres) and
#                          travelar-web (/login) must both report healthy
#   rolls back otherwise   the previous images are re-tagged and started again
#
# A rollback restores the code, not the schema. Migrations must therefore stay
# additive (new tables and nullable columns) so the previous release still runs
# against a migrated database.
set -euo pipefail

APP_DIR=/opt/travelar
cd "$APP_DIR"

log() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1"; }
env_get() { sed -n "s/^$1=//p" .env | tail -n 1 | sed -e 's/^"\(.*\)"$/\1/'; }

IMAGES=("$(env_get API_IMAGE)" "$(env_get WEB_IMAGE)")
CONTAINERS=(travelar-api travelar-web)

# Image ids that already failed a release. :latest keeps pointing at a bad
# build until the next push, so without this list every run would deploy it
# again — a short outage every two minutes. A new push has a new id and is
# tried normally.
REJECTED="$APP_DIR/.rejected-images"
touch "$REJECTED"

declare -A BEFORE AFTER
for image in "${IMAGES[@]}"; do
  BEFORE[$image]=$(docker image inspect --format '{{.Id}}' "$image" 2>/dev/null || echo none)
done

for image in "${IMAGES[@]}"; do
  if ! docker pull -q "$image" >/dev/null 2>&1; then
    log "pull of $image failed (registry unreachable, or the package is private) — leaving the running release alone"
    exit 0
  fi
done

changed=()
for image in "${IMAGES[@]}"; do
  AFTER[$image]=$(docker image inspect --format '{{.Id}}' "$image")
  [ "${AFTER[$image]}" = "${BEFORE[$image]}" ] && continue
  if grep -qxF "${AFTER[$image]}" "$REJECTED"; then
    # Point the local tag back at the running release, so a compose run
    # triggered by the other image cannot pick the rejected one up.
    [ "${BEFORE[$image]}" != "none" ] && docker tag "${BEFORE[$image]}" "$image"
    continue
  fi
  changed+=("$image")
done

# Also start the stack if it is not running at all (first run, or after a
# reboot that Docker's restart policy did not cover).
running=$(docker ps --filter name='^travelar-(api|web)$' --format '{{.Names}}' | wc -l)
if [ "${#changed[@]}" -eq 0 ] && [ "$running" -eq 2 ]; then
  exit 0
fi

for image in "${changed[@]}"; do
  log "new image: $image ${BEFORE[$image]:7:12} -> ${AFTER[$image]:7:12}"
done

rollback() {
  log "ERROR: $1 — rolling back"
  # Before anything is recreated: afterwards these would be the old release's.
  log "output of the failed release:"
  docker compose logs --no-color --tail=60 travelar-migrate travelar-api travelar-web || true
  for image in "${changed[@]}"; do
    echo "${AFTER[$image]}" >> "$REJECTED"
    log "rejected ${AFTER[$image]:7:12} ($image) — it will not be tried again; push a fix to release"
  done
  tail -n 50 "$REJECTED" > "$REJECTED.tmp" && mv "$REJECTED.tmp" "$REJECTED"
  for image in "${IMAGES[@]}"; do
    [ "${BEFORE[$image]}" != "none" ] && docker tag "${BEFORE[$image]}" "$image"
  done
  if docker compose up -d --remove-orphans; then
    log "previous release restored"
  else
    log "ERROR: the previous release did not start either — check: docker compose -f $APP_DIR/docker-compose.yml ps"
  fi
  exit 1
}

docker compose up -d --remove-orphans || rollback "docker compose up failed (a failed migration shows in the output below)"

for i in $(seq 1 30); do
  healthy=0
  for c in "${CONTAINERS[@]}"; do
    state=$(docker inspect -f '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$c" 2>/dev/null || echo missing/)
    case "$state" in
      */healthy) healthy=$((healthy + 1)) ;;
      # Definitive: the healthcheck used up its retries, or the process died.
      # Waiting out the full five minutes would only extend the outage.
      */unhealthy|exited/*|dead/*) rollback "$c is ${state%/}" ;;
    esac
  done
  if [ "$healthy" -eq "${#CONTAINERS[@]}" ]; then
    log "healthy — release complete"
    docker image prune -f --filter "until=168h" >/dev/null 2>&1 || true
    exit 0
  fi
  sleep 10
done

rollback "not healthy after 5 minutes"
