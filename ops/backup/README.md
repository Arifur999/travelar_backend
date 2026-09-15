# Database backups

The `backup` service in `docker-compose.production.yaml` runs `pg_dump` once
when it starts and then on `BACKUP_SCHEDULE` (default `0 21 * * *`, i.e. 03:00
Asia/Dhaka), writing `travelar-<UTC timestamp>.dump` files to `BACKUP_DIR` on
the host (default `./backups`). Dumps older than `BACKUP_RETENTION_DAYS`
(default 14) are deleted after each successful run.

> **Copy `BACKUP_DIR` off the machine.** A backup on the same disk as the
> database does not survive losing that disk. Sync it to object storage or
> another host with whatever you already use (rclone, restic, a provider's
> snapshot of that folder). This setup deliberately stops at producing the files.

## Check it is working

```bash
docker compose -f docker-compose.production.yaml logs backup   # "[backup] ok …" per run
ls -lh backups/
```

## Take one now

```bash
docker compose -f docker-compose.production.yaml exec backup sh -c '. /tmp/backup.env && /ops/backup.sh'
```

## Restore

Dumps are custom format, so use `pg_restore`, not `psql`.

**Rehearse into a scratch database first** — it touches nothing live:

```bash
C="docker compose -f docker-compose.production.yaml --env-file .env.production"
DUMP=travelar-20260915T210000Z.dump

$C exec backup sh -c ". /tmp/backup.env && createdb travelar_restore \
  && pg_restore --no-owner --no-privileges -d travelar_restore /backups/$DUMP"
$C exec backup sh -c '. /tmp/backup.env && psql -d travelar_restore -c "select count(*) from agencies"'
```

**Replace the live database** (downtime; stop everything that writes first):

```bash
$C stop web api
$C exec backup sh -c ". /tmp/backup.env && pg_restore --clean --if-exists --no-owner --no-privileges \
  -d \$PGDATABASE /backups/$DUMP"
$C up -d api web      # migrate runs first and applies anything newer than the dump
```

`--clean --if-exists` drops each object before recreating it, so the result is
exactly the dump. Restoring a dump older than the current code is fine: the
`migrate` job applies the missing migrations on start.
