# AGENTS.md

Context for AI agents (and humans) working in this repo. Read this before making changes.

## What this is

A small **2026 inventory/stock checklist web app** in **Indonesian**, for a government (OPD) context.
Purpose: let each OPD record its stock inputs so the results can be **reconciled (disandingkan) with the SIMASET application**.

- **One row per OPD** — NOT per item. There is no per-item input anywhere.
- **Penerimaan (incoming)** is tracked as **one total per month** (Jan–Des, 12 months).
- **Pengeluaran (outgoing)** is tracked as **one total per semester** (Semester 1, Semester 2) — only 2.
- **Saldo Awal 2026** = opening stock, entered per OPD; it is the base for Semester 1.
- **Saldo Awal Juli** = opening stock for Semester 2. It is **auto-filled client-side to equal Stock S1** (read-only field).
- The end result (per OPD) is a **Stock Opname** figure that the **admin** compares against SIMASET.

## Quick start

```bash
cp .env.example .env      # fill DATABASE_URL (+ admin vars)
npm install
npm start                 # node server.js -> http://localhost:3000
```

- No build step. The frontend is a **vanilla-JS SPA** (hash routing) served from `public/`.
- `DATABASE_URL` is **required** — the server exits if it's missing.
- There is **no test runner**. Verify with `node --check <file>` and by hitting the API with `curl`.
- **No browser automation is available** in this environment. Do NOT try to drive a browser; verify via the API + code inspection.

## Architecture

- **`server.js`** — Express + `pg` (PostgreSQL). Serves the static frontend, the JSON API, admin auth, and runs schema migration on boot.
- **`public/`** — `index.html` (SPA shell), `styles.css` (design system), `app.js` (all frontend logic + hash routing).
- **`OPDHerman.json`** — static list of 38 OPDs. `PBSubk` = code, `KetPBSubk` = name. Loaded once at boot; the code is the PK in the DB.
- **`.env`** — gitignored. `DATABASE_URL`, `PORT`, `ADMIN_USER`, `ADMIN_PASS`, `ADMIN_SECRET`.
- **`Dockerfile` / `.dockerignore`** — for deployment (Coolify / Docker). In a container the env vars are **injected by the platform**, not read from a `.env` file.

Routing (hash-based, client-side):

| Route | Page |
|---|---|
| `#/` | Landing: autocomplete OPD picker + "Cara pakai" |
| `#/opd/:code` | Laporan Manual form for one OPD |
| `#/pp-pakai-habis` | Full recap table (all OPDs) + search + Full Screen toggle |
| `#/admin` | **Hidden** admin login + SIMASET reconciliation (no nav link) |

## Data model

Table `entries` (created/migrated in `ensureSchema()`):

- `opd_code TEXT PRIMARY KEY`
- `saldo_awal`, `saldo_awal_juli`, `jan`…`dec`, `sem1`, `sem2`, `opname_simaset` — all `NUMERIC(12,2) NOT NULL DEFAULT 0`
- `updated_at TIMESTAMPTZ`

**All numeric fields: max 2 decimal places, non-negative.** The server clamps every input to `Math.max(0, round2(v))`.

## Formulas (CRITICAL — keep server and client in sync)

All computed in `GET /api/statistik` (and mirrored client-side in `public/app.js` `paintTotals()`). `round2` = round to 2 decimals.

```
total_in   = jan + … + dec                 (all 12 months)
in_s1      = jan … jun                      (months 1-6)
in_s2      = jul … des                      (months 7-12)
total_out  = sem1 + sem2

stock1     = saldo_awal + in_s1 - sem1
stock2     = saldo_awal_juli + in_s2 - sem2
stock_year = saldo_awal + total_in - total_out

selisih    = opname_simaset - stock_year    (0 = matches SIMASET; negative = shortfall)
```

**Invariant:** because the client auto-sets `saldo_awal_juli = stock1`, in practice **`stock2 == stock_year` always**. This is a **client behavior, not a server guarantee** — the server stores whatever `saldo_awal_juli` it's given. If you change the client's auto-fill, this invariant can break.

## API

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /api/opds` | – | List all OPDs (`PBSubk`, `KetPBSubk`) |
| `GET /api/opds/:code` | – | One OPD's entry (or `null`) |
| `PUT /api/opds/:code` | – | Upsert an OPD's checklist (12 months + 2 semesters + saldo awal + saldo awal juli) |
| `GET /api/statistik` | – | Full recap for all OPDs (see formula output shape) |
| `POST /api/admin/login` | – | Sets `admin_token` cookie (HttpOnly, 12h TTL) |
| `POST /api/admin/logout` | – | Clears the cookie |
| `GET /api/admin/me` | – | `{ authenticated, user }` |
| `GET /api/admin/rekonsiliasi` | admin | Per-OPD `stock_year`, `opname_simaset`, `selisih` |
| `PUT /api/admin/opname/:code` | admin | Set `opname_simaset` for one OPD |

Admin auth is **stateless**: HMAC-SHA256 signed token in an HttpOnly cookie, secret from `ADMIN_SECRET`, 12h TTL. Endpoints guarded by `requireAdmin` return `401` without a valid cookie.

## Conventions & hard rules (do not break)

- **No auto-save.** The user explicitly rejected it. Only a **leave/unsaved-changes warning** (beforeunload + hash-nav guard + autocomplete guard).
- **Admin route is hidden.** No link in the nav — users reach `#/admin` by typing the URL.
- **No per-item input.** One total row per OPD. Never add per-item fields.
- **Indonesian number format** `100.000,00` for all display (via `fmtID()` / `Intl.NumberFormat('id-ID')`). Inputs accept free text (`inputmode="decimal"`, `type="text"`) and are parsed with `parseMoney()` / `liveFormat()`.
- **Max 2 decimals** everywhere (DB `NUMERIC(12,2)` + client + server).
- **Neobrutalism design only.** No dark mode, no gradients/glow/glass/emoji/generic icons in the UI.
- **WCAG AA** for all text/background pairs.
- **Desktop width** is 1280px for non-PP pages. The Laporan Manual page is 1280px by default with a **Full Screen toggle**.

## Design system (CSS tokens in `styles.css`)

```
--bg #efe7d6        --ink #171512        --paper #ffffff
--yellow #ffd400    --pink #ff5ca8       --pink-deep #d61f7a
--blue #2d6bff      --blue-deep #1e4fd6  --green #177a3d
--red #b71c16       --yellow-soft #fff3c4 --pink-soft #ffd9ea  --muted #6b665b
--border 2.5px      --shadow 5px 5px 0 var(--ink)   --shadow-sm 3px 3px 0 var(--ink)
--radius 10px       --radius-sm 7px
Fonts: 'Archivo Black' (display), 'Manrope' (body)
```

Color semantics: yellow = penerimaan, pink = pengeluaran, blue = focus, blue-deep = stock header, green = success/saldo, red = error/negative.

## Responsive breakpoints

- `≤1200px` → ringkasan goes to 3 columns.
- `≤760px` → everything 1 column; topbar wraps; form rows 1 column.

## Gotchas (learned the hard way)

- **Loading/empty rows inside `<tbody>` MUST be `<tr><td>…</td></tr>`**, never a `<div>`. A `<div>` inside `<tbody>` breaks the table DOM.
- **`.env` values containing `#` (or `@`, `:`, spaces) MUST be quoted** — e.g. `ADMIN_PASS="GFzQ…#uK@CTV"`. dotenv treats an unquoted `#` as a comment and truncates the value. (In Coolify/Docker this is not an issue — env vars are set directly.)
- **Never `taskkill //F //IM node.exe`.** Kill by specific PID only (e.g. find the PID listening on port 3000, then `Stop-Process -Id <pid>`).
- **Sticky table** requires: wrapper `.sum-table` with `overflow:auto` + `max-height` (≈82vh) and the table with `border-collapse:separate`.
- **Search/filter is client-side** (live, DOM filtering via `data-search` attributes) — no server round-trip.
- The remote Postgres must be **reachable from the deploy host** (firewall/allowlist). The DB is on a public port; restrict it to the app server's IP.

## Deployment

- Docker: single-stage `node:22-alpine`, `npm ci --omit=dev`, runs as `node`, `CMD ["node","server.js"]`, `EXPOSE 3000`.
- On **Coolify**: add a Dockerfile-type app pointing at this repo; set env vars in the dashboard (NOT via a `.env` file): `DATABASE_URL`, `PORT=3000`, `ADMIN_USER`, `ADMIN_PASS`, `ADMIN_SECRET`.
- **`ADMIN_SECRET` must be set** — if empty, the HMAC key is empty and admin tokens are forgeable.
- `.env` is gitignored and never committed.

## File structure

```
server.js          Express + pg — API, static serving, admin auth, schema migration
.env               DB + admin credentials (GITIGNORED)
.env.example       template
OPDHerman.json     38 OPDs (PBSubk, KetPBSubk)
public/
  index.html       SPA shell
  styles.css       neobrutalism design system
  app.js           SPA logic (hash routing, forms, totals, admin)
Dockerfile / .dockerignore
package.json       deps: dotenv, express, pg
```
