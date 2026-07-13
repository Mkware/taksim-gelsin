# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

Three top-level workspaces, each independently buildable:

- `backend/` — Node 18+ / TypeScript / Express + Socket.io API server.
- `mobile/` — Flutter app (customer + driver + admin in one binary, role-routed).
- `supabase/` — Raw SQL migrations and ad-hoc scripts for the Supabase (PostgreSQL + PostGIS) database. There is no Supabase CLI config — migrations are applied manually via the Supabase SQL editor.

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
npm run lint     # eslint src/ --ext .ts
```

There is no test runner configured.

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
flutter test                                # unit tests under test/
dart run build_runner build --delete-conflicting-outputs   # regenerate freezed/json/riverpod
dart run flutter_launcher_icons             # rebuild app icons after changing brand_logo.png
```

Dart SDK ≥ 3.0. Firebase config is generated into `lib/firebase_options.dart` via `flutterfire configure`; `firebase.json` is checked in.

### Architecture

- **State**: `flutter_riverpod` with code-generation (`riverpod_annotation` + `riverpod_generator`). Top-level providers are wired in `lib/providers/providers.dart`.
- **Routing**: `go_router` declared in `lib/core/router/app_router.dart`. The `_GoRouterRefresh` listenable rebuilds redirects on `isLoggedInProvider` / `userRoleProvider` changes — do not replace the router on auth changes (would reset the stack and double-connect the socket).
- **Networking**: `lib/services/api_service.dart` (Dio) and `lib/services/socket_service.dart` (socket_io_client) talk to the same backend origin. The base URL is **runtime-mutable**: `AppConstants.defaultServerOrigin` (currently `http://213.142.133.176:3000`) is just the seed; the active origin is persisted under `AppConstants.backendOriginKey` and editable from the admin screen, so don't hardcode URLs anywhere else.
- **Token refresh**: the Dio auth interceptor (`api_service.dart`) coalesces concurrent 401s through a single in-flight refresh `Completer` and surfaces three callbacks — `onAccessTokenRefreshed` (resync socket JWT), `onRefreshFailed`, `onSessionReplaced` (handles the backend's `SESSION_REPLACED` error code from the session_version mechanism).
- **Screens** are split by role under `lib/screens/{customer,driver,admin,auth,profile,review,legal}/`. The same binary serves all three roles; `redirect` in the router decides where to land.
- **FCM**: `lib/fcm_background_handler.dart` is the top-level background handler registered in `main.dart`. The driver registers its FCM token via `lib/services/driver_push_registration.dart` against the backend's `device_push_tokens` table.

### Pinned dependency

`pubspec.yaml` pins `path_provider_foundation: 2.5.1` via `dependency_overrides` to dodge an iOS Simulator FFI crash in 2.6+ (`DOBJC_initializeApi` failing to load `objective_c.framework`). Do not bump it without testing on the simulator. `main.dart` additionally swallows `path_provider`-flavored `PlatformException(channel-error)` from `google_fonts` disk cache writes — leave that filter in place.

## Database (`supabase/`)

- Migrations are plain SQL files in `supabase/migrations/`, applied **manually in alphabetical order** through the Supabase SQL editor.
- Multiple files share the `002_` prefix (`002_add_driver_balance.sql`, `002_driver_request_log.sql`, `002_ride_pickup_verification.sql`, `002_seed_data.sql`, plus a `002_add_driver_balance_revert.sql` rollback). They are independent feature migrations that just happened to ship together — apply them all, and when adding a new migration pick the next free number rather than reusing `002`.
- Core tables: `users`, `drivers`, `rides`, `reviews`, `driver_locations_history`, plus later additions `platform_settings`, `device_push_tokens`, and the `session_version` column on `users`. PostGIS is used for the driver location queries hit by the matcher's nearby-drivers RPC.
