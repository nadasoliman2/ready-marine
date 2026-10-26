# ReadyMarine — Docker audit (2026-10-25)

ReadyMarine (`/root/ready-marine`) was copied from ReadyCar (`/root/ready-car`), which runs **live in production on the same host**. This audit compared both projects' Dockerfiles, Compose files, `.env` files, container names, ports, networks, volumes, database names and Redis setup. Only ReadyMarine files were changed. No ReadyCar file, container, volume or database was touched. The only ReadyMarine container running so far is `readymarine_mongo`, which holds a copy of the Atlas data (section 4). The backend and frontend have not been built or started yet.

## 1. Conflicts found

| # | Area | Before (ReadyMarine) | ReadyCar (live) | Effect | Fix |
|---|------|----------------------|-----------------|--------|-----|
| 1 | Container name | frontend `container_name: readycar_frontend` | `readycar_frontend` | `up` fails with a name conflict. Anyone who "resolves" that by removing the container takes ReadyCar's storefront down. | `readymarine_frontend` |
| 2 | Backend host port | `4001:4000` | `0.0.0.0:4001` | Port already allocated: Marine backend cannot start. | `127.0.0.1:4041:4000` |
| 3 | Frontend host port | `3001:3000` | `0.0.0.0:3001` | Port already allocated. | `127.0.0.1:3041:3000` |
| 4 | Network subnet | `172.22.0.0/16` | `ready-car_default` = `172.22.0.0/16` | "Pool overlaps" error: Marine network cannot be created. | `172.16.0.0/16` (free, and outside Docker's automatic pools) |
| 5 | Compose project name | implicit, taken from the folder name | `ready-car` | If the folder were renamed/copied as `ready-car`, or `COMPOSE_PROJECT_NAME=ready-car` were set, compose would treat ReadyCar's containers as its own and recreate them. | `name: ready-marine` pinned in the file |
| 6 | Backend URLs | `FRONTEND_URL` / `BACKEND_PUBLIC_URL` default `https://readycar.store` | same | Marine's payment callbacks, email links, CORS and image URLs would point at the ReadyCar production site. | default `https://readymarine.store` |
| 7 | Email sender | `RESEND_FROM=ReadyCar <verify@readycar.store>` | same | Marine mail would be sent as ReadyCar. | `ReadyMarine <verify@readymarine.store>` |
| 8 | Payment mode | `FAWATERAK_MODE` default `live` | `live` | A dev project defaulting to real charges. | default `sandbox` |
| 9 | Google sign-in | build arg fell back to ReadyCar's OAuth client ID | same ID | ReadyCar's Google identity baked into Marine's JS bundle. | no default; button hides until Marine's own ID is set |
| 10 | Database name | `readycar` (in its own mongod) | `readycar` | Data was already separate, but a Marine dump has the same DB name as prod, so restoring it into the wrong mongod would overwrite ReadyCar's `readycar` DB. | `readymarine` |
| 11 | Local Mongo port (`docker-compose.localdev.yml`) | `27017:27017` on all interfaces | ReadyCar's localdev file also uses `27017` | Port clash. It also re-exposes Mongo publicly; ReadyCar's Mongo was ransomed in May 2026 through exactly that. | `127.0.0.1:27018:27017` |
| 12 | Local frontend port (`docker-compose.local.yml`) | override to `3002` | — | `3002` is taken on this host by `tech-oriented-app`. | override removed (base `3041` is free) |
| 13 | `reset:local-db` script | default `localhost:27017/readycar`, only allows DB `readycar` | — | Would target ReadyCar's DB if its Mongo were ever published on 27017. | default `localhost:27018/readymarine`, only allows `readymarine` |
| 14 | `.env` files | none existed | `.env` + `Backend/.env` | Compose refuses to start, and the easy fix of copying ReadyCar's files would share prod secrets (JWT keys, payment and courier keys, admin password). | Created from `.env.example` with freshly generated secrets; nothing copied from ReadyCar |
| 15 | `CLAUDE.md` | listed `readycar_*` containers and ports 4001/3001 | — | Deploy instructions pointed at the production containers. | Updated to `readymarine_*`, with a warning that ReadyCar is live on this host |

### Already isolated (no change needed)

- **Mongo data:** `./docker-data/mongo` is relative, so it resolves to `/root/ready-marine/docker-data/mongo`. Marine's Mongo has no host port, its own root user, and sits on its own network. Marine containers cannot resolve or reach `readycar_mongo`.
- **Redis:** separate `readymarine_redis` container with no host port. `REDIS_URL=redis://redis:6379` resolves only inside `ready-marine_default`, and no keys are shared.
- **Uploads, scraping and carbrands mounts:** all relative paths inside `/root/ready-marine`. `./readycar_scrapping` does not exist in Marine yet, so Docker creates it empty on first start. Only the category seeder reads it, and without it categories seed without local images. The folder name is what the code expects, so it was left as is.
- **Images:** compose names them `ready-marine-backend` / `ready-marine-frontend`, separate from `ready-car-*`.
- **Dockerfiles:** these have no hardcoded names or host ports, so they were not changed.
- **imagetools:** ReadyCar's `readycar_imagetools` service does not exist in Marine, and Marine's code does not call it.

## 2. Files changed (all in `/root/ready-marine`)

| File | Change |
|------|--------|
| `docker-compose.yml` | `name: ready-marine`. Changes #1–#10 above. |
| `docker-compose.local.yml` | Removed the 3002 port override. Volume renamed to `readymarine_mongo_local`. |
| `docker-compose.localdev.yml` | Mongo published on `127.0.0.1:27018`. |
| `.env.example` | Ports 3041/4041/27018, user `readymarine_admin`, DB `readymarine`, ReadyMarine names. |
| `Backend/scripts/resetLocalReadycarDb.js` | Targets `localhost:27018/readymarine` only. |
| `CLAUDE.md` | Service names, ports, and a warning about ReadyCar. |
| `.env`, `Backend/.env` (new, gitignored, mode 600) | Copied from `.env.example` with new Mongo password, JWT/cookie secrets and admin password. All third-party keys (payments, courier, WhatsApp, Resend, EverySecond, Google) are blank, so those features stay off. `NODE_ENV=development`. |

Some uncommitted edits (Mongo/Redis/backend container names and the frontend `NEXT_PUBLIC_*` defaults) were already in the working tree before this audit and were kept.

## 3. Final configuration

| | ReadyCar (live — do not touch) | ReadyMarine |
|---|---|---|
| Folder | `/root/ready-car` | `/root/ready-marine` |
| Compose project | `ready-car` | `ready-marine` (pinned) |
| Backend | `readycar_backend`, `0.0.0.0:4001` | `readymarine_backend`, `127.0.0.1:4041` |
| Frontend | `readycar_frontend`, `0.0.0.0:3001` | `readymarine_frontend`, `127.0.0.1:3041` |
| Mongo | `readycar_mongo` (`mongo:6`), no host port, DB `readycar` | `readymarine_mongo` (`mongo:7`), no host port, DB `readymarine` |
| Mongo data | `/root/ready-car/docker-data/mongo` | `/root/ready-marine/docker-data/mongo` |
| Redis | `readycar_redis`, no host port | `readymarine_redis`, no host port |
| imagetools | `readycar_imagetools` | — |
| Network | `ready-car_default`, `172.22.0.0/16` | `ready-marine_default`, `172.16.0.0/16` |
| Images | `ready-car-backend`, `ready-car-frontend` | `ready-marine-backend`, `ready-marine-frontend` |
| Local-only Mongo port | `27017` (localdev file) | `127.0.0.1:27018` (localdev file) |

Marine's ports are bound to `127.0.0.1`. The host firewall (`DOCKER-USER`) already drops outside traffic to container ports, and the binding is a second layer. Public access goes through host nginx. `readymarine.store` currently serves a "coming soon" page from `/etc/nginx/sites-available/readymarine.store`.

## 4. Database: local copy of the Atlas data

ReadyMarine's data started on MongoDB Atlas (DB `ready-marine` on `cluster0.wd6ueit`; no other project on this server uses that cluster). It was copied into the local `readymarine_mongo` container on 2026-10-25. The app now uses the local copy only. Atlas is no longer written to, so the two will drift apart from here on.

- **Image:** `mongo:7` (7.0.34), not `mongo:6`. Atlas runs 8.0, and 8.x cannot run on this host's kernel (Linux 7.0, MongoDB SERVER-121912). 7 is the closest version that can. ReadyCar stays on its own `mongo:6`.
- **How it was copied:**
  1. A throwaway `mongo:7` container ran `mongodump` against Atlas (read-only).
  2. The result is in `docker-data/atlas-dumps/atlas-ready-marine-20261025-200213.archive.gz` (gitignored).
  3. `mongorestore` ran inside `readymarine_mongo`, renaming `ready-marine.*` to `readymarine.*`.
- **Verified:** 80/80 collections, 218/218 documents (0 failed), and the same index count in every collection. Marine's mongod holds only `admin`, `config`, `local` and `readymarine`, with no `readycar`.
- **Data:** about 52 products, 14 categories, 12 brands, 16 car brands, 28 cities, shipping setup, 4 pages, 1 seller and 1 subscription package. The app seeders were **not** run on top, because the Atlas data already contains this reference data.

To refresh the local copy from Atlas later, run this from `/root/ready-marine`. It **replaces** the local `readymarine` DB:

```bash
read -rsp 'Atlas URI: ' URI; echo; TS=$(date +%Y%m%d-%H%M%S)
docker run --rm -e URI="$URI" -v "$PWD/docker-data/atlas-dumps:/dump" mongo:7 \
  sh -c 'mongodump --uri="$URI" --db=ready-marine --archive=/dump/atlas-'"$TS"'.archive.gz --gzip'
docker exec -i readymarine_mongo sh -c 'mongorestore -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" \
  --authenticationDatabase admin --archive --gzip --drop \
  --nsInclude "ready-marine.*" --nsFrom "ready-marine.*" --nsTo "readymarine.*"' \
  < docker-data/atlas-dumps/atlas-$TS.archive.gz
```

Never point `mongorestore` at `readycar_mongo`.

## 5. Safe commands

Rules:
- Always run compose **from `/root/ready-marine`**. Always pass `-p ready-marine` as a second guard.
- Never run `docker system prune`, `docker volume prune`, or `docker network prune` on this host.
- Never run `--remove-orphans` or `down -v` from the wrong folder.
- Never touch anything named `readycar_*` or `ready-car*`.

### Pre-flight (read-only)

```bash
cd /root/ready-marine
docker compose -p ready-marine config | grep -E '^name:|container_name:|published:|subnet:'
#   expect: name: ready-marine, readymarine_* only, 4041/3041, 172.16.0.0/16
docker compose -p ready-marine up -d --no-build --dry-run
#   expect: only "ready-marine_default" and "readymarine_*" lines
```

### Build and start

The host's `/tmp` lives in RAM and ReadyCar runs on the same box, so build one image at a time:

```bash
cd /root/ready-marine
docker compose -p ready-marine build backend
docker compose -p ready-marine build frontend
docker compose -p ready-marine up -d
```

### Verify

```bash
docker compose -p ready-marine ps                                   # 4 services, mongo/redis healthy
curl -s -o /dev/null -w 'backend %{http_code}\n'  http://127.0.0.1:4041/api/
curl -s -o /dev/null -w 'frontend %{http_code}\n' http://127.0.0.1:3041/
docker exec readymarine_mongo sh -c 'mongosh --quiet -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --eval "db.getMongo().getDBNames()"'
#   must NOT list "readycar"
docker exec readymarine_backend getent hosts readycar_mongo || echo "isolated: cannot see ReadyCar mongo"
docker ps --filter name=readycar_ --format '{{.Names}}\t{{.Status}}'  # ReadyCar uptime unchanged
```

### Stop (Marine only)

```bash
cd /root/ready-marine && docker compose -p ready-marine down          # keeps ./docker-data/mongo
```

## 6. Open items (not changed)

1. **Empty folder `/root/ready-car/ready-marine/`** was created at 19:17 today, inside ReadyCar's folder. Compose searches parent folders for a compose file, so running `docker compose up` from that folder would pick up **ReadyCar's production** compose file. It is empty and untracked. It was not removed because it sits inside ReadyCar's folder, and deleting it needs your OK (`rmdir /root/ready-car/ready-marine`).
2. **Going public on `readymarine.store`:**
   - Set `FRONTEND_URL`, `BACKEND_PUBLIC_URL`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL` and `NODE_ENV=production` in Marine's `.env`, then rebuild the frontend.
   - Proxy nginx to `127.0.0.1:3041` and `127.0.0.1:4041` (`/api`, `/socket.io`, `/uploads`).
   - Issue a TLS certificate.
3. **Marine's own third-party accounts:** Resend domain, Fawaterak/Paymob, Bosta/Arrive, WhatsApp, EverySecond agent, and a Google OAuth client. Never paste ReadyCar's keys: webhooks and payouts would cross between the two shops.
4. **App code still mentions `readycar.store`** in a few places:
   - fallback URLs in `services/everysecond/catalogSync.js` and `routes/admin.js`, which are only used when `FRONTEND_URL` is unset (it is always set now);
   - customer-facing text in `services/everysecond/helpers.js`;
   - comments.

   This is app branding, not Docker, and is outside this audit's scope.
5. `docker-compose.local.yml` says it is "not committed", but it is tracked in Marine's git.
6. **Uploaded files were not in Atlas.** The 14 category images (`/uploads/categories/*.png`) and the logos (`/uploads/branding/*`) are files on whichever machine used the Atlas DB before. `Backend/public/uploads` is empty here, so copy that folder over or those images will be broken.
7. **Site logo settings point at a developer's laptop:** in `sitesettings`, `logo_url = http://localhost:4001/uploads/branding/…` and `logo_light_url = http://localhost:2000/uploads/branding/…`. They were copied as-is. Re-upload the logos from Admin once the site is running.
8. **Atlas credentials:** the Atlas user has `atlasAdmin` (full control of the whole cluster), and its password was shared in chat. Rotate the password. If Atlas stays in use, give the app a user limited to `readWrite` on `ready-marine` only.
