---
title: "Dokploy Deployment Guide"
version: 3.8.50
lastUpdated: 2026-07-30
---

# Dokploy Deployment Guide

Step-by-step deployment of this project on a [Dokploy](https://dokploy.com/) VPS using
the purpose-built [`docker-compose.dokploy.yml`](../../docker-compose.dokploy.yml).

---

## 0. Read this first: there is no PostgreSQL

If you came here looking for "how do I set up the Postgres database" — you don't.
There is nothing to set up, and adding a Postgres service will do nothing.

| Claim                          | Reality                                                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| "It needs Postgres"            | **No.** PostgreSQL is an explicit **DROP** in [`docs/architecture/cluster-decisions.md`](../architecture/cluster-decisions.md).                   |
| "It needs an external DB"      | **No.** Persistence is SQLite only — 131 migrations in `src/lib/db/migrations/` and 111 modules in `src/lib/db/`, all targeting `better-sqlite3`. |
| "`DATABASE_URL` configures it" | **No.** That variable is not read anywhere in `src/`, `open-sse/`, or `bin/`.                                                                     |
| "Redis is the database"        | **No.** Redis is the rate-limiter backend only (`src/shared/utils/rateLimiter.ts`). No application state lives there.                             |

**The only storage decision that matters is the volume.** The SQLite file lives in
`DATA_DIR` (set to `/app/data` in the compose file), backed by the `api-router-data`
named volume. Protect that volume and you have protected the database. Section 7 covers it.

Two hard constraints that follow from SQLite:

- **Run exactly one replica.** Multiple processes writing one SQLite file over a shared
  volume loses data. Never scale this service in Dokploy.
- **Keep the volume on local disk.** SQLite locking is unreliable over NFS/CIFS/SMB, and
  WAL mode can corrupt on a network mount.

---

## 1. Prerequisites

| Item       | Requirement                                                                     |
| ---------- | ------------------------------------------------------------------------------- |
| Dokploy    | v0.7.0 or newer (native Compose domain support)                                 |
| VPS RAM    | 2 GB **free** (runtime heap is capped at 1 GB — `ENV OMNIROUTE_MEMORY_MB=1024`) |
| VPS disk   | 25 GB (image + SQLite + pre-migration backups)                                  |
| Domain     | A real domain if you want HTTPS. `traefik.me` domains are HTTP-only             |
| DNS access | Ability to create an `A` record                                                 |
| GHCR image | Published by `.github/workflows/build-fork.yml` — see Section 1.3               |

These are **runtime** figures, because the VPS never compiles anything. The compose
file pulls a prebuilt image.

Do not confuse them with **build** requirements. Building the Next.js bundle needs
~5–6 GB of _free_ RAM (a 4 GB V8 heap ceiling plus V8/Turbopack overhead) and ~15–20 GB
of transient disk. On a VPS already running other workloads the kernel OOM-kills that
build mid-run and reports no error — the log simply stops after
`Creating an optimized production build ...`. That is why the build lives in CI.

### 1.3 Publish the image first

The image must exist before the first deploy, or the pull fails.

1. `.github/workflows/build-fork.yml` runs on every push to `main`, and can be started
   manually from the repo's **Actions** tab via **Run workflow**.
2. Wait for it to finish, then confirm the package appears under the repo's
   **Packages** section.
3. **GHCR packages are private by default.** Either:
   - make it public: GitHub → **Packages** → `api-router` → **Package settings** →
     **Change visibility** → Public, or
   - add a GHCR registry credential in Dokploy (**Registry** in the left sidebar) using
     a personal access token with `read:packages`.

   Skipping this step produces a `403` / `denied` on pull.

### 1.1 Point DNS at the VPS

In your DNS provider, before touching Dokploy:

| Type | Name  | Value             | Proxy              |
| ---- | ----- | ----------------- | ------------------ |
| `A`  | `api` | `<your VPS IPv4>` | **Off / DNS only** |

That produces `api.example.com`. Keep Cloudflare's orange-cloud proxy **off** for the
first deploy — Let's Encrypt HTTP-01 validation needs to reach the VPS directly. Turn it
on afterwards if you want.

Verify propagation before continuing:

```bash
dig +short api.example.com
# must print your VPS IP
```

### 1.2 Generate your secrets

Run these **now** and paste the output into a scratch file. You need five values.

Linux / macOS:

```bash
echo "JWT_SECRET=$(openssl rand -base64 48)"
echo "API_KEY_SECRET=$(openssl rand -hex 32)"
echo "STORAGE_ENCRYPTION_KEY=$(openssl rand -hex 32)"
echo "REDIS_PASSWORD=$(openssl rand -hex 24)"
echo "MACHINE_ID_SALT=$(openssl rand -hex 16)"
```

Windows PowerShell (no OpenSSL needed):

```powershell
function New-Hex([int]$Bytes) {
  $b = New-Object byte[] $Bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  ($b | ForEach-Object { $_.ToString("x2") }) -join ""
}
function New-B64([int]$Bytes) {
  $b = New-Object byte[] $Bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  [Convert]::ToBase64String($b)
}
"JWT_SECRET=$(New-B64 48)"
"API_KEY_SECRET=$(New-Hex 32)"
"STORAGE_ENCRYPTION_KEY=$(New-Hex 32)"
"REDIS_PASSWORD=$(New-Hex 24)"
"MACHINE_ID_SALT=$(New-Hex 16)"
```

> ⚠️ **Back up `STORAGE_ENCRYPTION_KEY` somewhere outside the VPS.** It encrypts the
> SQLite database at rest (`src/lib/db/encryption.ts`). Lose it and the database is
> unreadable — there is no recovery path.

---

## 2. Create the Compose service in Dokploy

1. Log into the Dokploy panel.
2. Left sidebar → **Projects** → **Create Project**. Name it `api-router`. **Create**.
3. Open the project → **Create Service** → choose **Compose**.
4. Name it `api-router`. **Create**.

You now land on the service page with the tab row: **General · Environment · Domains ·
Deployments · Backups · Schedules · Volume Backups · Logs · Monitoring · Advanced**.

> Tip: Dokploy has GitHub-style tab shortcuts. Press `g` then `e` for Environment,
> `g` then `u` for Domains, `g` then `a` for Advanced.

---

## 3. General tab — point at the repo

Stay on **General**.

1. **Compose Type** → leave as **Docker Compose**.
   Do **not** pick **Stack**. Swarm mode ignores the `build:` directive, and this compose
   file builds from source.
2. **Provider** → **Github** (or Git / Gitea / GitLab, whichever holds your fork).
   - First time only: **Save** → follow the GitHub App install prompt → return here.
3. **Repository** → select your fork.
4. **Branch** → the active release line, e.g. `release/v3.8.49`. Not `main` — `main` only
   receives release squash-merges and lags weeks behind (see
   [`docs/ops/BRANCHING_MODEL.md`](BRANCHING_MODEL.md)).
5. **Compose Path** → type exactly:

   ```
   ./docker-compose.dokploy.yml
   ```

   This is the single most-skipped step. Leave it at the default `./docker-compose.yml`
   and you get the local-dev file instead, whose services are gated behind profiles and
   all publish host ports — see Appendix A for why that breaks.

6. Click **Save**.

**Do not deploy yet.** The compose file uses `${VAR:?}` fail-fast syntax; deploying
before Section 4 aborts the build with `set JWT_SECRET in the Dokploy environment`.

---

## 4. Environment tab — what to paste

Click **Environment** (or `g` `e`).

### 4.1 How Dokploy env vars actually reach the container

This trips up most people, so it is worth 20 seconds:

> Dokploy writes everything from this editor into a `.env` file **next to the compose
> file**. Those values are **not** auto-injected into containers. They only reach the app
> because `docker-compose.dokploy.yml` explicitly references each one as `${VAR}` inside
> its `environment:` block.

Practical consequence: **a variable you invent here has no effect** unless it appears in
the compose file. The block below contains only variables the compose file actually
consumes. Section 8 covers how to add ones that aren't in the list.

### 4.2 Paste this block

Replace every `<...>` placeholder with your real values from step 1.2.

```bash
# ── Required: public origin ───────────────────────────────────────────
# Must be the exact https origin you will add in the Domains tab.
# No trailing slash. Used for OAuth callbacks, dashboard links, cookies.
PUBLIC_URL=https://api.example.com

# ── Required: secrets (deploy aborts if any are unset) ────────────────
JWT_SECRET=<openssl rand -base64 48>
API_KEY_SECRET=<openssl rand -hex 32>
INITIAL_PASSWORD=<a strong password — change it after first login>
REDIS_PASSWORD=<openssl rand -hex 24>

# ── Strongly recommended: SQLite encryption at rest ───────────────────
# Back this value up OFF the VPS. Losing it makes the database unreadable.
STORAGE_ENCRYPTION_KEY=<openssl rand -hex 32>
STORAGE_ENCRYPTION_KEY_VERSION=v1

# ── Security posture for a public deployment ──────────────────────────
# Every /v1/* proxy call must carry an API key. Do not relax on a public host.
REQUIRE_API_KEY=true
# Per-deployment salt so machine IDs are not shared between instances.
MACHINE_ID_SALT=<openssl rand -hex 16>

# ── Optional: CORS ────────────────────────────────────────────────────
# Leave EMPTY unless a browser app on a different origin calls the API.
# The dashboard is same-origin and uses CSRF protection, so it needs nothing here.
CORS_ALLOWED_ORIGINS=

# ── Optional: pin a specific image build ──────────────────────────────
# Defaults to :latest, which tracks the tip of main. Pin a commit to make
# deploys reproducible and rollbacks trivial.
# API_ROUTER_IMAGE=ghcr.io/online-falconova/api-router:sha-<commit>

# ── Optional: raise the runtime heap ──────────────────────────────────
# The image caps the server heap at 1024 MB. Raise it only if you run large
# fusion combos, where many models fan out in parallel and each response is
# buffered whole. Clamped to 64-16384. Requires the Section 8 Option A patch,
# since the compose file does not reference it.
# OMNIROUTE_MEMORY_MB=2048

# ── Optional: live dashboard WebSocket (see Section 6) ────────────────
# Leave both empty unless you complete Section 6.
NEXT_PUBLIC_LIVE_WS_PUBLIC_URL=
LIVE_WS_ALLOWED_HOSTS=

# ── Optional: skills catalog ──────────────────────────────────────────
# Pinned to a commit SHA on purpose: SKILL.md files are instructions handed to a
# model that may hold tool access, so an upstream push must never silently change
# what users can install. This SHA serves the full catalog.
OMNIROUTE_SKILLS_CATALOG_REPO=diegosouzapw/awesome-omni-skills
OMNIROUTE_SKILLS_CATALOG_REF=c3af0048b70a4b84b2f2324e2f7b7ae5206d89b2

```

`OMNIROUTE_BASE_PATH` is deliberately absent. Next.js `basePath` is a build-time
constant, so with a prebuilt image it is fixed in CI and setting it here does nothing.
To serve under a subpath, set it as a build arg in the workflow and republish.

Click **Save**.

### 4.3 Values already set by the compose file — do not add these

These are hardcoded in `docker-compose.dokploy.yml`. Overriding them from the editor has
no effect, because the compose file does not read them as `${VAR}`:

| Variable                  | Fixed value                                    | Why                                               |
| ------------------------- | ---------------------------------------------- | ------------------------------------------------- |
| `NODE_ENV`                | `production`                                   | —                                                 |
| `DATA_DIR`                | `/app/data`                                    | Must match the volume mount                       |
| `PORT` / `DASHBOARD_PORT` | `20128`                                        | Single-port mode                                  |
| `BASE_URL`                | `http://localhost:20128`                       | Loopback for server-side sync jobs                |
| `NEXT_PUBLIC_BASE_URL`    | `${PUBLIC_URL}`                                | Derived from your `PUBLIC_URL`                    |
| `AUTH_COOKIE_SECURE`      | `true`                                         | Traefik terminates TLS, so cookies must be Secure |
| `ALLOW_API_KEY_REVEAL`    | `false`                                        | Never echo full key values into the UI            |
| `CORS_ALLOW_ALL`          | `false`                                        | No wildcard origin                                |
| `LIVE_WS_PORT`            | `20132`                                        | —                                                 |
| `LIVE_WS_ALLOWED_ORIGINS` | `${PUBLIC_URL}`                                | Derived from your `PUBLIC_URL`                    |
| `REDIS_URL`               | `redis://default:${REDIS_PASSWORD}@redis:6379` | Network-internal only                             |

---

## 5. Domains tab — the answer to "which service do I pick"

Click **Domains** (or `g` `u`) → **Add Domain**.

Fill the form exactly like this:

| Field              | Value             | Notes                                                                                                                               |
| ------------------ | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Service Name**   | `api-router`      | ← **this is the one.** The only HTTP-serving service in the file                                                                    |
| **Host**           | `api.example.com` | Bare hostname. No `https://`, no path, no port                                                                                      |
| **Path**           | `/`               | Default                                                                                                                             |
| **Internal Path**  | _(empty)_         | Leave blank. Do not type `/` — that attaches an `addPrefix` middleware for no benefit. The field already defaults to `/` when empty |
| **Strip Path**     | **Off**           | With Path `/` there is nothing to strip                                                                                             |
| **Container Port** | `20128`           | ← **must be 20128.** Dashboard + API in single-port mode                                                                            |
| **HTTPS**          | **On**            | —                                                                                                                                   |
| **Certificate**    | `letsencrypt`     | Requires a real domain with a resolving `A` record                                                                                  |

Click **Create**.

Notes on the fields:

- **Container Port is not a public port.** It only tells Traefik which port inside the
  container to forward to. Nothing gets exposed to the internet by setting it. The
  compose file uses `expose:` rather than `ports:`, so nothing is bound to the host at all.
- **Never select `redis` here.** It is a network-internal cache with no HTTP interface.
  Publishing it would expose your rate-limiter backend.
- **Compose domains require a redeploy.** Unlike Applications (which hot-reload via
  Traefik's file provider), Compose domains are Traefik _Docker labels_, read only at
  container creation. Every domain change needs a fresh deploy.
- Optional sanity check: click **Preview Compose** on the General tab to see the exact
  labels Dokploy will inject. You should see
  `traefik.http.services.<...>.loadbalancer.server.port=20128`.

---

## 6. Optional — live dashboard WebSocket

Skip this on your first deploy. The dashboard works fine without it; only the real-time
monitoring panel stays idle.

The WS server listens on **20132**, exposed on the compose network only. To reach it:

1. **Domains** → **Add Domain** again:

   | Field              | Value             |
   | ------------------ | ----------------- |
   | **Service Name**   | `api-router`      |
   | **Host**           | `api.example.com` |
   | **Path**           | `/live-ws`        |
   | **Strip Path**     | **Off**           |
   | **Container Port** | `20132`           |
   | **HTTPS**          | **On**            |
   | **Certificate**    | `letsencrypt`     |

   Keep **Strip Path** off: `/live-ws` is the default path the WS server itself expects
   (`src/app/api/v1/ws/route.ts`).

2. **Environment** → set:

   ```env
   NEXT_PUBLIC_LIVE_WS_PUBLIC_URL=wss://api.example.com/live-ws
   ```

3. Redeploy.

`LIVE_WS_ALLOWED_ORIGINS` is already wired to `${PUBLIC_URL}` in the compose file, so the
browser Origin check passes with no extra work. If you front the app with additional
hostnames (LAN, Tailscale), add them to `LIVE_WS_ALLOWED_HOSTS` as a comma-separated list.

---

## 7. Protect the database before you deploy

The entire application state is one SQLite file inside the `api-router-data` volume.

### 7.1 Set up volume backups

1. **Volume Backups** tab (or `g` `v`) → **Create Volume Backup**.
2. **Volume Name** → `api-router-data`.
3. **Destination** → an S3 destination. If you have none, create one first under
   **Server → S3 Destinations** in the left sidebar.
4. **Schedule** → daily is a sane default.
5. **Create**.

Volume Backups work on Docker **named** volumes only, not bind mounts. The compose file
already uses named volumes (`api-router-data`, `redis-data`), so you are set.

### 7.2 Leave the built-in pre-migration backup on

The app snapshots SQLite before every migration run. It is on by default
(`DISABLE_SQLITE_AUTO_BACKUP=false`). Do not set it to `true`.

### 7.3 Never scale this service

One replica. Always. See Section 0.

---

## 8. Adding a variable the compose file doesn't reference

If you need a variable that isn't in the Section 4.2 list — say
`OMNIROUTE_WS_BRIDGE_SECRET`, or a provider API key — putting it in the Environment tab
alone will not work. Pick one of these.

### Option A — reference it explicitly (recommended)

Edit `docker-compose.dokploy.yml` in your fork, adding to the `api-router` service's
`environment:` block:

```yaml
# Shared secret for the internal Codex Responses WebSocket bridge.
# Generate: openssl rand -base64 32
OMNIROUTE_WS_BRIDGE_SECRET: ${OMNIROUTE_WS_BRIDGE_SECRET:-}
```

Commit, push, then add `OMNIROUTE_WS_BRIDGE_SECRET=<value>` in the Environment tab and
redeploy. This keeps the surface explicit and auditable.

### Option B — inject everything

Add `env_file: - .env` to the `api-router` service. Every variable in the editor reaches
the container. Simpler, but it also forwards typos and unrelated values into the process
environment, so Option A is preferred.

The full catalog of variables the runtime reads is [`.env.example`](../../.env.example) —
it documents every one, with the source file that consumes it.

---

## 9. Deploy

1. **General** tab → **Deploy**.
2. **Deployments** tab (or `g` `d`) → click the running entry to stream build logs.

Expect **1–3 minutes**. Nothing is compiled here — Compose pulls the prebuilt image and
starts two containers.

Milestones to look for, in order:

| Log signal                               | Meaning                      |
| ---------------------------------------- | ---------------------------- |
| `Pulling api-router ...`                 | Fetching the image from GHCR |
| `Pull complete` on each layer            | Download progressing         |
| `Container ... Started` for `redis`      | Rate-limiter backend up      |
| `Container ... Started` for `api-router` | App booting                  |

First boot then runs 131 SQLite migrations — allow **another ~1 minute** before the
container reports healthy. The compose healthcheck has `start_period: 60s` to cover this.

If the pull fails with `denied` or `403`, the GHCR package is still private. Go back to
Section 1.3.

---

## 10. Verify

### 10.1 Container health

**Monitoring** tab (`g` `m`) — `api-router` and `redis` should both be running.
**Logs** tab (`g` `l`) — no repeating error loops.

### 10.2 HTTP reachability

```bash
curl -I https://api.example.com
```

Expect `200` or a `307` redirect to the login page, plus a valid Let's Encrypt chain.

### 10.3 Dashboard login

1. Open `https://api.example.com` in a browser.
2. Confirm the padlock shows a valid certificate.
3. Log in with the `INITIAL_PASSWORD` you set.
4. **Immediately** go to **Settings → Security** and change it. `INITIAL_PASSWORD` is a
   bootstrap value that stays in the Dokploy environment editor in plaintext.

### 10.4 Create an API key and test the proxy

Since `REQUIRE_API_KEY=true`, unauthenticated `/v1/*` calls are rejected — that is
correct behavior, not a broken deploy.

1. Dashboard → **API Keys** → create one → copy it (you will not see it again;
   `ALLOW_API_KEY_REVEAL` is `false`).
2. Add at least one provider under **Providers**.
3. Test:

```bash
curl https://api.example.com/v1/models \
  -H "Authorization: Bearer <your-api-key>"
```

---

## 11. Troubleshooting

| Symptom                                                                                                   | Cause                                                                                                                                                                                                                                  | Fix                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build aborts: `set JWT_SECRET in the Dokploy environment`                                                 | Required secret missing. The `${VAR:?}` syntax fails fast by design                                                                                                                                                                    | Fill in every required value from Section 4.2, save, redeploy                                                                                                                                                          |
| Traefik 404 on your domain                                                                                | Wrong **Service Name**, wrong **Container Port**, or domain added before the deploy                                                                                                                                                    | Service `api-router`, port `20128`. Confirm via **Preview Compose**, then redeploy                                                                                                                                     |
| Dropdown lists `omniroute-base` / `omniroute-web` / `omniroute-cli`                                       | **Compose Path** still points at `./docker-compose.yml`                                                                                                                                                                                | Set it to `./docker-compose.dokploy.yml` and redeploy. See Appendix A                                                                                                                                                  |
| Let's Encrypt certificate fails                                                                           | DNS not propagated, or Cloudflare proxy on during HTTP-01 validation                                                                                                                                                                   | `dig +short api.example.com` must return the VPS IP. Set Cloudflare to DNS-only, redeploy                                                                                                                              |
| Cloudflare **Error 526** (Invalid SSL certificate)                                                        | Proxy ON with SSL mode Full (strict), but the origin has no valid Let's Encrypt cert, so Traefik answers with its default self-signed one. Usually a symptom, not the disease — often no container is running, so ACME never completed | Fix the origin first (correct Compose Path, container healthy, domain on the right service/port). Set the record to **DNS only** so HTTP-01 can reach the VPS, redeploy, confirm a real cert, then re-enable the proxy |
| Cloudflare **Error 521 / 522**                                                                            | Origin not listening at all — container down, or Traefik has no route for the host                                                                                                                                                     | Check **Monitoring** and **Logs**; verify the domain's Service Name and Container Port                                                                                                                                 |
| App listens on the wrong port                                                                             | `PORT` overridden in the Environment tab (e.g. `PORT=3000`)                                                                                                                                                                            | Remove it. The compose file pins `PORT` / `DASHBOARD_PORT` to `20128`, which is what the domain routes to                                                                                                              |
| Deploy aborts with `Domain <host> is attached to service <name> which does not exist in the compose`      | A domain still references a service name from a previously configured compose file. Dokploy validates domain bindings **before** running Compose, so nothing builds                                                                    | **Domains** → edit the domain → **Service Name** → `api-router`. If the dropdown is stale, click the refresh icon beside it, or use **Manual** and type the name. Save, then deploy                                    |
| Only `redis` shows under **Containers**                                                                   | Compose Path points at `./docker-compose.yml`, whose app services are behind Compose profiles that Dokploy does not activate                                                                                                           | Set Compose Path to `./docker-compose.dokploy.yml`. See Appendix A                                                                                                                                                     |
| Deployment shows **Cancelled** and the log stops right after `Creating an optimized production build ...` | The VPS is building from source and the kernel OOM-killed it. Nothing prints because the process was killed, not failed                                                                                                                | Use the prebuilt image (this guide's default). To build on the VPS anyway: add swap **and** set `OMNIROUTE_BUILD_MEMORY_MB=3072`. Confirm the cause with `dmesg -T                                                     | grep -i 'killed process'` |
| Image pull fails: `denied` / `403` / `unauthorized`                                                       | The GHCR package is private, which is the default                                                                                                                                                                                      | Make the package public, or add a GHCR credential under Dokploy → **Registry**. See Section 1.3                                                                                                                        |
| Image pull fails: `manifest unknown` / `not found`                                                        | The workflow has not published yet, or the tag is wrong                                                                                                                                                                                | Run **Publish Fork Image to GHCR** from the Actions tab and let it finish                                                                                                                                              |
| Deployed code is missing your latest changes                                                              | `:latest` was served from cache, or the workflow has not finished                                                                                                                                                                      | Wait for the workflow, then redeploy. For reproducible deploys pin `API_ROUTER_IMAGE` to a `sha-<commit>` tag                                                                                                          |
| Runtime OOM under load                                                                                    | Server heap ceiling too low for your workload                                                                                                                                                                                          | Add `OMNIROUTE_MEMORY_MB` via Section 8 Option A (clamped to 64–16384; auto-calibrates from host RAM)                                                                                                                  |
| OAuth callbacks land on `localhost`                                                                       | `PUBLIC_URL` unset, wrong, or has a trailing slash                                                                                                                                                                                     | Set the exact https origin, no trailing slash, redeploy                                                                                                                                                                |
| Live monitoring panel never connects                                                                      | Section 6 not completed, or origin mismatch                                                                                                                                                                                            | Add the `/live-ws` domain on port 20132 and set `NEXT_PUBLIC_LIVE_WS_PUBLIC_URL`                                                                                                                                       |
| `401` on every `/v1/*` call                                                                               | Working as configured — `REQUIRE_API_KEY=true`                                                                                                                                                                                         | Send `Authorization: Bearer <key>`. Do not disable this on a public host                                                                                                                                               |
| Redis errors in logs                                                                                      | `REDIS_PASSWORD` changed but only one service picked it up                                                                                                                                                                             | The app never reads it directly — Compose interpolates it into `REDIS_URL` _and_ the redis `--requirepass` flag. Redeploy the whole stack so both are rebuilt from the same value                                      |
| Data vanished after redeploy                                                                              | Volume detached, or a bind mount to an absolute host path was used                                                                                                                                                                     | Keep the named volume `api-router-data`. Dokploy wipes absolute host paths on deploy                                                                                                                                   |
| Domain change had no effect                                                                               | Compose domains are Traefik labels, read only at container creation                                                                                                                                                                    | Redeploy. Compose does not hot-reload domains                                                                                                                                                                          |

---

## Appendix A — why `docker-compose.yml` is the wrong file for Dokploy

If your Domains dropdown lists `redis`, `omniroute-base`, `omniroute-web`,
`omniroute-cli`, `omniroute-host`, `qdrant`, `bifrost`, `cliproxyapi`, you are pointed at
`docker-compose.yml`, the local-development file. Three problems:

1. **The four `omniroute-*` services are mutually exclusive alternatives, not a stack.**
   They share `container_name: omniroute` and identical host port mappings. Only one can
   run. Each is gated behind a Compose profile (`base`, `web`, `cli`, `host`), and Dokploy
   does not enable profiles by default — so typically _none_ of them start, leaving Traefik
   with no backend and your domain returning 404.
2. **They use `ports:`, not `expose:`.** That publishes 20128/20129/20132 on the host,
   where Traefik already owns 80/443. Conflict-prone on a shared VPS and unnecessary.
3. **It reads `env_file: .env` from the repo,** which Dokploy's git clone overwrites on
   every deploy.

`docker-compose.dokploy.yml` fixes all three: one service (`api-router`), `expose:` instead
of `ports:`, joins the external `dokploy-network`, and fails fast on missing secrets.

If you genuinely need the Chromium-based web-cookie providers (`gemini-web`, `claude-web`,
`claude-turnstile`), don't switch files — change one line in `docker-compose.dokploy.yml`:

```yaml
build:
  target: runner-web # was: runner-base
```

That adds Chromium and roughly 300 MB to the image. The service name stays `api-router`,
so your domain configuration needs no change.

> If you enable Dokploy's **Isolated Deployments** (Advanced tab), delete the `networks:`
> blocks from the compose file — Dokploy manages connectivity itself in that mode.

---

## Appendix B — post-deploy hardening checklist

- [ ] `INITIAL_PASSWORD` changed via **Settings → Security**
- [ ] `STORAGE_ENCRYPTION_KEY` backed up outside the VPS
- [ ] `REQUIRE_API_KEY=true` confirmed still set
- [ ] Volume backup configured on `api-router-data` with an S3 destination
- [ ] One replica only — service never scaled
- [ ] `CORS_ALLOWED_ORIGINS` empty, or narrowed to specific origins (never `CORS_ALLOW_ALL`)
- [ ] Restore tested at least once from a volume backup
- [ ] Dokploy panel itself behind its own domain with 2FA enabled

---

## Related docs

| Topic                      | Doc                                                                              |
| -------------------------- | -------------------------------------------------------------------------------- |
| Every environment variable | [`.env.example`](../../.env.example)                                             |
| SQLite runtime behavior    | [`docs/ops/SQLITE_RUNTIME.md`](SQLITE_RUNTIME.md)                                |
| Database operations        | [`docs/ops/DATABASE_GUIDE.md`](DATABASE_GUIDE.md)                                |
| Generic VPS deployment     | [`docs/ops/VM_DEPLOYMENT_GUIDE.md`](VM_DEPLOYMENT_GUIDE.md)                      |
| Why no PostgreSQL          | [`docs/architecture/cluster-decisions.md`](../architecture/cluster-decisions.md) |
| Branch to deploy from      | [`docs/ops/BRANCHING_MODEL.md`](BRANCHING_MODEL.md)                              |
| Authorization model        | [`docs/architecture/AUTHZ_GUIDE.md`](../architecture/AUTHZ_GUIDE.md)             |

External: [Dokploy Compose docs](https://docs.dokploy.com/docs/core/docker-compose) ·
[Dokploy Domains](https://docs.dokploy.com/docs/core/domains) ·
[Compose domains](https://docs.dokploy.com/docs/core/docker-compose/domains) ·
[Environment variables](https://docs.dokploy.com/docs/core/variables).
Dokploy behavior described here was verified against those pages; content was rephrased
for compliance with licensing restrictions.
