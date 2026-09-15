#!/bin/sh
# Backup container: one backup at start (so a fresh deploy is covered from
# minute one), then on a cron schedule, in the foreground so the container's
# logs show every run.
set -eu

SCHEDULE="${BACKUP_SCHEDULE:-0 21 * * *}"   # 21:00 UTC = 03:00 Dhaka

# busybox crond runs jobs with an empty environment, so the connection
# settings are written into a file the job sources.
env_file=/tmp/backup.env
{
  for name in PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE BACKUP_DIR BACKUP_RETENTION_DAYS; do
    eval "value=\${$name:-}"
    [ -n "$value" ] && printf "export %s='%s'\n" "$name" "$(printf '%s' "$value" | sed "s/'/'\\\\''/g")"
  done
} > "$env_file"
chmod 600 "$env_file"

echo "$SCHEDULE . $env_file && /ops/backup.sh > /proc/1/fd/1 2>/proc/1/fd/2" > /etc/crontabs/root

echo "[backup] waiting for the database"
until pg_isready -q; do sleep 2; done

/ops/backup.sh

echo "[backup] scheduled: $SCHEDULE (UTC)"
exec crond -f -l 8
