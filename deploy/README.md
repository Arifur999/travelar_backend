# Deploying Travelar to srv1881651

Target: `travance.softech.agency` on the Hostinger VPS (Ubuntu 24.04, KVM 2,
8 GB), beside `softech.agency` and `furnify.softech.agency`, which must keep
running untouched.

This is the box's *Adding another site* runbook applied to a two-container
app. The differences from a single Next.js site: Travelar is a web container
**and** an API container with its own Postgres, and the payment gateway has to
reach the API from the internet.

## How a change reaches the live site

```
push to main (either repo)
  -> GitHub Actions: CI (lint, tests, build) must pass
  -> image pushed to ghcr.io/arifur999/travelar-web or travelar-api
  -> within 2 min, travelar-deploy.timer on the VPS sees the new digest
  -> docker compose up -d   (a new API image runs migrations first)
  -> waits until travelar-api and travelar-web are both healthy
  -> otherwise re-tags the previous images and starts them again
```

A red CI run publishes nothing, so the site keeps running the last good
release. A push that only changes docs, `deploy/` or `ops/` (or, in the web
repo, only Markdown) publishes nothing either, so it does not restart
anything.

A release replaces the containers, which takes a few seconds. During that
window nginx answers with a 503 "Travelar is updating" page that reloads
itself, not a bare 502. Nothing in GitHub can reach the server: its runners are filtered on
port 22, so the server pulls instead, and no SSH key is stored in GitHub.

The two repos release independently. A change that needs both sides should
reach the API first and keep the API backward compatible, since the web
image may arrive a few minutes earlier or later. For the same reason, and
because a rollback restores code but not the schema, **migrations must be
additive** (new tables, nullable or defaulted columns).

## How it fits together

```
                      :80 / :443
                          |
            hatim_backend-nginx-1   (furnify's proxy, shared)
     |                    |                               |
 furnify...        softech.agency              travance.softech.agency
                                         /api/v1/billing/sslcommerz/*   everything else
                                                  |                          |
                                            travelar-api:5050        travelar-web:3000
                                                  |      \______________/
                                            travelar-db        (internal network)
          ------------------ hatim_backend_default ------------------
```

- **No host ports.** nginx reaches `travelar-web` and `travelar-api` by name
  over `hatim_backend_default`. Postgres is only on the stack's internal
  network.
- **Unique names.** Every service is `travelar-*`, because Docker adds each
  service name as a DNS alias on the shared network. A service called `api`
  could answer lookups meant for a neighbour's.
- **Only the payment callbacks are public on the API.** The web server calls
  the API over the internal network. The browser never calls it, and the
  web app's CSP forbids it anyway.
- **Memory.** Each container has a ceiling: db 512 MB, API 512 MB, web
  768 MB, backup 128 MB. Measured idle with the real images, the stack uses
  about 300 MB (API 173, web 72, db 57). Disk: about 1.2 GB for the two
  images.
- **Our own vhost file.** It lives at
  `/opt/travelar/nginx/travance.softech.agency.conf` and is bind mounted into
  the proxy's `conf.d`. It is never appended to furnify's `nginx.conf`, which
  furnify's deploy rewrites.

## First-time setup

**1. DNS.** In hPanel → Domains → DNS Manager, add an `A` record: name
`travance`, value `187.127.124.251` (the address `softech.agency` resolves
to). Leave every other record alone. Wait until this prints that address:

```bash
dig +short travance.softech.agency
```

**2. Images.** Each repo's *Deploy* workflow publishes its image on every
green push to `main`. Both packages were first published on 2026-09-17 and can
be pulled without logging in, so the server needs no GitHub credentials. If
`install.sh` ever reports that it cannot pull, check GitHub → Packages →
`travelar-api` / `travelar-web` → Package settings → visibility.

**3. On the VPS, as root:**

```bash
git clone https://github.com/Arifur999/travelar_backend.git /root/travelar-src
cd /root/travelar-src/deploy

# asks for your email: it becomes the operator login and the Let's Encrypt contact
read -rp "Your email: " E && bash bootstrap.sh "$E"
bash set-env.sh --smtp                 # outgoing mail (password reset) + a login test; can wait
bash set-env.sh SSLCOMMERZ_STORE_ID SSLCOMMERZ_STORE_PASSWORD   # payments; can wait
bash install.sh                        # start the stack, install the timers
bash attach-site.sh                    # certificate + vhost, checks the neighbours
```

Each script stops at the first problem and says what to fix, and each is safe
to re-run.

- `attach-site.sh` refuses to call certbot until DNS points here, so a typo
  does not spend Let's Encrypt's rate limit.
- It tests the proxy config in a throwaway container before recreating the
  real one.
- It compares `softech.agency` and `furnify` before and after, and withdraws
  its own block if either changed.

**4. Sign in** at `https://travance.softech.agency/login` with
`SUPER_ADMIN_EMAIL` and the generated password:

```bash
grep SUPER_ADMIN_PASSWORD /opt/travelar/.env
```

**5. Check from anywhere:**

```bash
curl -sI https://travance.softech.agency/login | head -1
echo | openssl s_client -connect travance.softech.agency:443 \
  -servername travance.softech.agency 2>/dev/null | openssl x509 -noout -subject
for d in softech.agency furnify.softech.agency; do
  curl -s -o /dev/null -w "$d -> %{http_code}\n" "https://$d/"
done
```

Seeing a neighbour's certificate in the second check means nginx is not using
our block. Run `bash ensure-site.sh`.

## Making it permanent on the furnify side

`travelar-vhost.timer` puts the mount back if a furnify release drops it, but
it is better if that never happens. Add this line to the nginx service's
`volumes:` in the **furnify repo's** compose file, under the `./nginx.conf`
line, and commit it:

```yaml
- /opt/travelar/nginx/travance.softech.agency.conf:/etc/nginx/conf.d/travance.softech.agency.conf:ro
```

## Operations

```bash
# state
docker ps --filter name=travelar-
systemctl list-timers 'travelar-*'
journalctl -u travelar-deploy -u travelar-vhost --since '1 hour ago'

# release now instead of waiting up to 2 minutes
systemctl start travelar-deploy

# roll back to a specific commit (pin, then release)
systemctl stop travelar-deploy.timer
sed -i 's|^WEB_IMAGE=.*|WEB_IMAGE=ghcr.io/arifur999/travelar-web:<sha>|' /opt/travelar/.env
cd /opt/travelar && docker compose up -d
# undo the pin later: set it back to :latest and `systemctl start travelar-deploy.timer`

# logs (JSON lines; a user-quoted reference is a web `digest` or an API `requestId`)
docker logs -f travelar-web
docker logs -f travelar-api
docker logs travelar-api | jq 'select(.requestId == "<id>")'

# change settings: asks for each value (passwords hidden), saves, applies
bash /root/travelar-src/deploy/set-env.sh --smtp
bash /root/travelar-src/deploy/set-env.sh SSLCOMMERZ_IS_LIVE
# after editing /opt/travelar/.env by hand instead
cd /opt/travelar && docker compose up -d

# no SMTP yet? a password-reset link is only written to the API log:
docker logs travelar-api 2>&1 | grep 'email not sent' | tail -1

# move to another public name (its A record must already point here)
read -rp "New public name: " D && sed -i "s|^DOMAIN=.*|DOMAIN=$D|" /opt/travelar/.env
cd /opt/travelar && docker compose up -d        # apps now build URLs for the new name
bash /root/travelar-src/deploy/attach-site.sh   # certificate + vhost for it
# a previously attached name keeps its vhost file and mount line until removed by hand

# update the scripts, the compose file or the vhost after they change in git
cd /root/travelar-src && git pull
bash deploy/bootstrap.sh && bash deploy/install.sh && bash deploy/attach-site.sh
cd /opt/travelar && docker compose up -d

# If that recreated travelar-api but left travelar-web running — which is what
# a compose change touching only the API does — restart the web container too:
docker compose restart travelar-web
# The new API container has a new address, and the web app holds pooled
# connections open to the old one. Until those are dropped every page says
# "Can't reach Travelar" while the API is perfectly healthy. A normal release
# replaces both containers, so this only bites after a partial recreation.

# backups: /opt/travelar/backups (copy them off the box); restore: ops/backup/README.md

# Travelar's certificate: travelar-cert.timer checks daily and renews inside
# 30 days of expiry. To run the check now:
systemctl start travelar-cert && journalctl -u travelar-cert -n 5 --no-pager

# every certificate on the box (all domains share furnify's certbot volumes).
# furnify's certbot service only runs when called, so check that something
# renews softech's and furnify's too: systemctl list-timers; crontab -l
cd /srv/hatim/hatim_Backend
docker compose run --rm certbot renew
docker exec hatim_backend-nginx-1 nginx -t && docker exec hatim_backend-nginx-1 nginx -s reload
```

## Never, on this box

- `docker compose down` in `/srv/hatim/hatim_Backend` — stops furnify.
- Editing furnify's `nginx.conf`, or the server blocks of any other site.
- `sed -i` on a file that is bind mounted into the proxy. It swaps the inode,
  and the container keeps reading the old file. Write in place instead
  (`cat tmp > file`).
- `nginx -s reload` without `nginx -t` first.
- hPanel → OS & Panel → reinstall or change OS, which wipes everything.
- `docker compose down -v` in `/opt/travelar`, which deletes the database volume.
