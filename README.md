# lenra-api (backend)

Standalone HTTP API + MySQL for Lenra. The Next.js app (`../lenra`) is the **frontend only** (UI + API proxy).

## Layout

```text
src/
  api-routes/     ← all REST handlers (was app/api)
  lib/            ← database, auth, learning, payments, OpenAPI spec, …
  helper/         ← shared utilities used by lib
  types/          ← TypeScript schema types
  routes/         ← Hono server (dispatch, Swagger, health)
```

Browse **`src/api-routes/auth/phone/start/route.ts`** — same paths as public `/api/...`.

## Run

```bash
cp .env.example .env
# DATABASE_URL, AUTH_SECRET, BitPay, media keys, …
npm install
npm run dev
```

- API: `http://localhost:4000/api/...`
- Swagger: `http://localhost:4000/docs`
- OpenAPI JSON: `http://localhost:4000/api/openapi`

Dev env also loads `../lenra/.env.local` if present (shared secrets during local setup).

## Frontend (`../lenra`)

```env
LENRA_API_URL=http://localhost:4000
```

Next.js proxies `/api/*` to this server (except `/api/revalidate`, which stays on Next for cache tags).

**Note:** The frontend repo symlinks `lib/` and `helper/` → `lenra-api/src/…` so existing Server Components still compile while pages are migrated to fetch the API. New backend code belongs **only here**, not under `lenra/`.

## Route registry

After adding a file under `src/api-routes/**/route.ts`:

```bash
npm run generate:routes
```
