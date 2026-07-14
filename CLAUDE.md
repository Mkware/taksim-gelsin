# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

Five top-level workspaces in a single git repo, each independently buildable:

- `backend/` — Node 22.19+ / TypeScript / Express + Socket.io API server (bumped from 18+ on 14 Tem 2026 — testcontainers' `undici@8` dependency requires Node ≥22.19; production runtime code itself doesn't need anything Node 20+ specific).
- `mobile/` — Flutter app (customer + driver in one binary, role-routed). Admin was removed from mobile on 14 Tem 2026 — see `admin-panel/`.
- `admin-panel/` — Vite + React + TypeScript admin web UI, deployed at `panel.taksimgelsin.com`. Talks to the backend via `VITE_API_ORIGIN` (`.env.development` / `.env.production`, both gitignored). Since 14 Tem 2026 this is the *only* admin surface — mobile's `admin_home_screen.dart`, `/admin` route, admin API methods (`api_service.dart`), and `UserModel.isAdmin` were all deleted as dead code.
- `web/` — Astro marketing/legal site (landing page, gizlilik/kvkk/kullanım koşulları, sürücü sayfası).
- `supabase/` — Raw SQL migrations and ad-hoc scripts for the Supabase (PostgreSQL + PostGIS) database. There is no Supabase CLI config — migrations are applied manually via the Supabase SQL editor.

The whole tree is one root-level git repo (GitHub: `Mkware/taksim-gelsin`). Previously only `mobile/` had its own separate git history; that got folded into this single monorepo on 2026-07-13 (old mobile-only history backed up locally, not preserved in the new repo).

The repo root path itself contains a space and a Turkish character (`taksim-gelsin yedek kopyası 2`); always quote paths in shell commands.

Most code comments, log strings, and user-facing copy are in Turkish. Match that convention when editing.

## Backend (`backend/`)

### Commands

```bash
cd backend
npm install
npm run dev      # ts-node-dev hot-reload on src/server.ts
npm run build    # tsc → dist/
npm start        # node dist/server.js (production)
npm run lint     # eslint src/ --ext .ts (flat config: backend/eslint.config.mjs)
npm test         # vitest run — tests/ integration suite (testcontainers)
```

Tests live under `backend/tests/` (separate from `src/`, not part of the `tsc` build — `tsconfig.json`'s `include` only covers `src/`). Two testing styles:

1. **SQL-level** (`tests/integration/wallet_ledger.test.ts`, `ride_status_transitions.test.ts`): spin up a real Postgres+PostGIS container via testcontainers (`@testcontainers/postgresql`, image `postgis/postgis:16-3.4`) and replay every forward migration from `supabase/migrations/` (`tests/support/db.ts` skips `*_revert.sql` and `*_seed_data.sql`, and stubs Supabase's `auth.uid()`/`auth.role()` + `anon`/`authenticated`/`service_role` roles since those don't exist on vanilla Postgres — migrations reference them in RLS policies/GRANTs). Tests call SQL functions (e.g. `accept_ride_with_fee`) or run the same conditional-UPDATE pattern `ride.service.ts` uses, directly over a `pg` connection — bypassing `supabase-js`/PostgREST entirely. `tests/support/fixtures.ts` has minimal `insertCustomer`/`insertDriver`/`insertSearchingRide` helpers.
2. **Redis-backed service tests** (`tests/integration/smart_matching_queue.test.ts`): start a `@testcontainers/redis` container, then *dynamically* `import()` the real service module (e.g. `smart_matching.service.ts`) after pointing `process.env.REDIS_HOST`/`REDIS_PORT` at the container — the module's top-level `import { redis } from '../config/redis'` picks up the override. `tests/support/env.ts`'s `setDummyAppEnv()` must be called first to satisfy `config/env.ts`'s Zod validation (which `process.exit(1)`s on failure) with syntactically-valid dummy Supabase/JWT values, and **explicitly sets every Redis-related key** (`REDIS_TLS=false`, `REDIS_PASSWORD=''`, etc.) — `dotenv.config()` only fills in keys not already in `process.env`, so a real local `backend/.env` (needed for `npm run dev`) would otherwise leak production Redis TLS/password into the test and break the connection. `smart_matching.service.ts` exports a few normally-private symbols (`acquireNextDriver`, `sendRequestToNextDriver`, `REDIS_KEYS`, `DRIVER_SOCKET_KEY`, `DRIVER_PENDING_OFFER_PREFIX`, `OFFER_DEADLINES_ZSET`) solely for this test's use — no behavior change.
3. **Full-stack (PostgREST + Redis + real Socket.io) tests** (`tests/integration/ride_matching_socket_flow.test.ts`, `postgrest_smoke.test.ts`): `tests/support/postgrest_stack.ts` puts the Postgres+PostGIS container and a real `postgrest/postgrest` container on a shared testcontainers `Network`, replays migrations, then exposes a `supabaseUrl`/`serviceRoleKey` pair that make `supabaseAdmin` (supabase-js) actually work — no mocking. Two things Supabase's managed setup does for free had to be reproduced: an `authenticator` role (PostgREST connects as this, then `SET ROLE`s per the JWT's `role` claim) with `service_role` granted `BYPASSRLS` and `ALTER DEFAULT PRIVILEGES` on all tables (`tests/support/db.ts`), and a path-rewriting proxy in `tests/support/postgrest.ts` (supabase-js always calls `${url}/rest/v1/...`, but bare PostgREST serves at root — real Supabase's Kong gateway does this rewrite, so a small in-process Node `http` proxy stands in for it here). This lets tests spin up a real `http.createServer()` + `initSocketManager()` and drive it with real `socket.io-client` connections signing real JWTs (`generateAccessToken()` from `utils/jwt.ts`) — e.g. the socket flow test has a driver actually emit `driver:go_online` and receive a real `ride:new_request` event, then lets the real in-memory offer timeout (`DRIVER_RESPONSE_TIMEOUT_SECONDS`, clamped to a 5s minimum) reassign to the next driver.

Layer 3 unlocks testing `ride.service.ts`/`auth.service.ts` directly too (not done yet, only `smart_matching.service.ts` currently uses it) — worth reaching for before adding more SQL-only tests for logic that's actually in the TS layer.

**Running locally requires Docker.** On macOS without Docker Desktop, [colima](https://github.com/abiosoft/colima) works (`brew install colima docker`, `colima start`), but its VM-forwarded socket breaks testcontainers' Ryuk reaper container (bind-mount error) — run with `TESTCONTAINERS_RYUK_DISABLED=true DOCKER_HOST="unix://$HOME/.colima/default/docker.sock" npm test`. Plain Docker Desktop or Linux/CI (GitHub Actions `ubuntu-latest` ships Docker already) need neither workaround.

CI (`.github/workflows/ci.yml`) runs `tsc --noEmit` + `npm run lint` + `npm test` on every push/PR to `main`, alongside a mobile job (`flutter analyze` + `flutter test`).

A `.env` is required at `backend/.env`; copy `backend/.env.example` and fill in Supabase, Redis, JWT, FCM, and `ADMIN_PHONES`. Env is parsed and validated by Zod in `src/config/env.ts` — the process exits on any validation failure with a list of missing/invalid keys.

**Production (`NODE_ENV=production`):** Zod additionally enforces `WALLET_CARD_SIMULATION_ENABLED=false`, non-empty `ADMIN_PHONES`, and distinct `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`. Optional: `ADMIN_LOG_OUT_PATH` and `ADMIN_LOG_ERROR_PATH` for the admin log viewer (PM2 paths). HTTP: `GET /health` (liveness), `GET /health/ready` (Redis + DB ping for load balancers).

**Mobile release:** do not commit API keys in Dart sources — use `--dart-define=SERVER_ORIGIN=...` and `--dart-define=GOOGLE_MAPS_API_KEY=...` (see `docs/MOBILE_URETIM_DERLEMESI.md`).

### Architecture

Two parallel transports share the same HTTP server (`src/server.ts`):

1. **REST API** mounted under `/api/v1/{auth,users,drivers,rides,reviews,admin,config}` (`src/app.ts`). Each module under `src/modules/<name>/` follows the pattern `<name>.routes.ts` → `<name>.controller.ts` → `<name>.service.ts` with Zod schemas in `<name>.schema.ts`.
2. **Socket.io** initialized by `initSocketManager()` in `src/sockets/socket.manager.ts`. `socketAuthMiddleware` validates the same JWT used by REST and stuffs `userId`/`role`/`sessionVersion` onto `socket.data`. Three handler modules register events: `driver.handler.ts` (online/offline + location), `ride.handler.ts` (request/accept/reject/state transitions), `tracking.handler.ts` (snapshot on reconnect).

Shared helpers in `src/services/` are deliberately cross-module (don't fold them back into modules):

- **`smart_matching.service.ts`** is the active driver-selection algorithm. `matching.service.old.ts` is the previous implementation kept for reference — do not edit it; route any matching changes through `smart_matching`. The matcher keeps per-ride state in Redis (`ride:matching:*`, `ride:rejected:*`, `ride:pending:*`, `driver:pending_offer:*`, `driver:penalty:*`, `driver:timeout_streak:*`) — debugging matching usually means inspecting these keys, not the database.
- **`platform_settings.service.ts`** — operational knobs (`rideAcceptFeePercent`, `minDriverOnlineBalanceTcoin`, `pickupMaskRadiusM`, `driverResponseTimeoutSeconds`, etc.) live in the Supabase `platform_settings` table and are mutated at runtime by admins via `PUT /api/v1/admin/settings/platform`. The corresponding env vars in `.env` are **only bootstrap defaults** for an empty DB — never treat env as the source of truth for these values.
- **`driving_distance.service.ts`** wraps Google Distance Matrix with a Redis TTL cache; `MATCHING_ROAD_MATRIX_MAX_DRIVERS` caps how many candidates we ask the API to score per ride.
- **`driver_cleanup.service.ts`** runs a cron that marks "ghost" online drivers offline; started in `server.ts` and stopped on graceful shutdown.
- **`stale_searching_recovery.service.ts`** — every 5 minutes (and once at startup) cancels `searching` rides older than `STALE_SEARCHING_MINUTES` (default 15), clears matching Redis keys, and notifies the customer; mitigates lost timers after deploy/restart.

### Authentication & session model

- JWT access token (15m) + refresh token (30d), signed with separate secrets (`utils/jwt.ts`).
- Each user row has a `session_version` column. On login the version is bumped, and `disconnectStaleSocketsForUser(userId, activeSessionVersion)` (in `socket.manager.ts`) drops all sockets carrying an older version — this is how "another device logged in" is enforced. The auth middleware caches `session_version` in Redis for 60s (`auth:sv:<userId>`); clear that key (or call `invalidateSessionVersionCache`) after any change.
- Admin-ness is determined by phone number against `ADMIN_PHONES` (comma-separated E.164 list in env), checked via `isAdminPhone()` in `auth.service.ts`. There is no `is_admin` column.

### Other gotchas

- `app.set('trust proxy', 1)` is required for the rate limiter and CORS to see the real IP — keep it when editing `app.ts`.
- The global rate limiter skips `/health` and `/api/v1/admin/*`. Auth routes attach their own stricter limiters in `auth.routes.ts`.
- `WALLET_CARD_SIMULATION_ENABLED=true` makes the driver wallet "card top-up" flow credit T-Coin without any real payment integration. Disable for production.
- If `FCM_SERVICE_ACCOUNT_JSON` is empty, ride offers fall back to Socket.io only — drivers won't be woken from background.

## Mobile (`mobile/`)

### Commands

```bash
cd mobile
flutter pub get
flutter run                                 # debug, attached device
flutter test                                # unit tests under test/ (currently empty — no tests written yet)
dart run flutter_launcher_icons             # rebuild app icons after changing brand_logo.png
```

Dart SDK ≥ 3.0. Firebase config is generated into `lib/firebase_options.dart` via `flutterfire configure`; `firebase.json` is checked in.

### Architecture

- **State**: `flutter_riverpod`, hand-written providers (no code generation) — top-level providers are wired in `lib/providers/providers.dart` using plain `Provider`/`StateNotifierProvider` declarations. `riverpod_annotation`/`riverpod_generator`/`freezed`/`json_serializable`/`build_runner` were removed 2026-07-13: none were ever actually used (no `@riverpod`/`@freezed` annotations, no `part '*.g.dart'` directives, no generated files existed).
- **Routing**: `go_router` declared in `lib/core/router/app_router.dart`. The `_GoRouterRefresh` listenable rebuilds redirects on `isLoggedInProvider` / `userRoleProvider` changes — do not replace the router on auth changes (would reset the stack and double-connect the socket).
- **Networking**: `lib/services/api_service.dart` (Dio) and `lib/services/socket_service.dart` (socket_io_client) talk to the same backend origin. The base URL is **runtime-mutable** via `providers.dart`'s `BackendOriginNotifier`: `AppConstants.defaultServerOrigin` (currently `https://api.taksimgelsin.com`) is just the seed; the active origin is persisted under `AppConstants.backendOriginKey` and restored on startup (`StorageService.getBackendOrigin`/`saveBackendOrigin`) — don't hardcode URLs anywhere else. There's no longer any in-app UI to change it manually (that lived in the now-deleted admin screen, see `admin-panel/` above); `saveBackendOrigin` is still called once at startup by a legacy-`localhost`-seed migration fix in `BackendOriginNotifier._load()`, so don't remove it as dead code.
- **Token refresh**: the Dio auth interceptor (`api_service.dart`) coalesces concurrent 401s through a single in-flight refresh `Completer` and surfaces three callbacks — `onAccessTokenRefreshed` (resync socket JWT), `onRefreshFailed`, `onSessionReplaced` (handles the backend's `SESSION_REPLACED` error code from the session_version mechanism).
- **Screens** are split by role under `lib/screens/{customer,driver,auth,profile,review,legal}/`. The same binary serves both roles; `redirect` in the router decides where to land (`customer` vs `driver` — there is no admin role in mobile anymore).
- **FCM**: `lib/fcm_background_handler.dart` is the top-level background handler registered in `main.dart`. The driver registers its FCM token via `lib/services/driver_push_registration.dart` against the backend's `device_push_tokens` table.

### Pinned dependency

`pubspec.yaml` pins `path_provider_foundation: 2.5.1` via `dependency_overrides` to dodge an iOS Simulator FFI crash in 2.6+ (`DOBJC_initializeApi` failing to load `objective_c.framework`). Do not bump it without testing on the simulator. `main.dart` additionally swallows `path_provider`-flavored `PlatformException(channel-error)` from `google_fonts` disk cache writes — leave that filter in place.

## Admin panel (`admin-panel/`)

```bash
cd admin-panel
npm install
npm run dev      # vite dev server
npm run build    # tsc -b && vite build → dist/
npm run lint     # oxlint
```

Vite + React + TypeScript, talks to the backend's `/api/v1/admin/*` routes. Base URL comes from `VITE_API_ORIGIN` in `.env.development` / `.env.production` (both gitignored — copy the value pattern from an existing deploy, not committed anywhere).

## Marketing site (`web/`)

```bash
cd web
npm install
npm run dev       # astro dev
npm run build     # astro build → dist/
```

Astro static site: landing page, driver info page, and the legal pages (`gizlilik`, `kvkk`, `kullanım-koşulları`) whose copy also backs the in-app legal screens (`mobile/lib/screens/legal/`, `mobile/lib/content/legal_texts_tr.dart`) — keep the two in sync when legal text changes.

## Database (`supabase/`)

- Migrations are plain SQL files in `supabase/migrations/`, applied **manually in alphabetical order** through the Supabase SQL editor.
- Multiple files share the `002_` prefix (`002_add_driver_balance.sql`, `002_driver_request_log.sql`, `002_ride_pickup_verification.sql`, `002_seed_data.sql`, plus a `002_add_driver_balance_revert.sql` rollback). They are independent feature migrations that just happened to ship together — apply them all, and when adding a new migration pick the next free number rather than reusing `002`.
- **`schema_migrations` tracking** (`010_schema_migrations.sql`, added 14 Tem 2026): every migration from now on must end with `INSERT INTO schema_migrations (filename) VALUES ('0NN_name.sql') ON CONFLICT (filename) DO NOTHING;` — running the file in the SQL editor then automatically records that it was applied, no separate step to forget. This exists because two real gaps were found by accident this way: `007`'s `deduct_driver_balance` return-type conflict, and `users.session_version` never having a migration file at all (it was added via the now-deleted ad-hoc `backend/scripts/add_session_version.sql`, superseded by `009_user_session_version.sql`) — both had already been hand-fixed in the live SQL editor with no trace in the repo. `backend/npm run check-migrations` diffs local `supabase/migrations/*.sql` against the live project's `schema_migrations` table (read-only, uses `backend/.env`'s `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`) and reports drift either direction.
- Core tables: `users`, `drivers`, `rides`, `reviews`, `driver_locations_history`, plus later additions `platform_settings`, `device_push_tokens`, and the `session_version` column on `users` (`009_user_session_version.sql` — added 14 Tem 2026 after discovering the code had depended on this column since early on with **no migration file ever defining it**; if the live Supabase project doesn't already have it from a manual SQL-editor edit, auth/socket connections are broken there until this migration runs). PostGIS is used for the driver location queries hit by the matcher's nearby-drivers RPC.
- `backend/tests/support/db.ts`'s migration replay (see Backend Commands above) is the only thing that exercises the full migration sequence end-to-end — it already caught two real bugs this way (the `deduct_driver_balance` return-type conflict in `007`, and the missing `session_version` column). Treat a `npm test` failure on a fresh migration as a signal to check the migration itself, not just the test.
