# Taksim Gelsin — Teknik Sistem Analizi

**Proje:** Kırıkkale özelinde ~350 sürücüyle çalışacak MVP taksi çağırma uygulaması
**Stack:** Flutter (mobil) + Node.js/Express + Socket.io (backend) + Supabase/PostgreSQL + PostGIS + Redis
**Rapor tarihi:** 2026-04-23
**Kapsam:** Mimari, veri modeli, gerçek zamanlı katman, kimlik doğrulama, eşleştirme, güvenlik, performans, akış

---

## 1. Mimari Genel Bakış

Sistem, aşağıdaki üç katmandan oluşan **tipik bir çağdaş ride-hailing mimarisidir**:

```
┌─────────────────────┐        HTTPS / WSS        ┌───────────────────────────┐
│  Flutter Mobile     │  ◀───────────────────▶   │  Node.js + Express API    │
│  (customer/driver)  │     REST  +  Socket.io    │  + Socket.io Gateway      │
└─────────────────────┘                           └───────────┬───────────────┘
                                                              │
                                 ┌────────────────────────────┼────────────────────────┐
                                 ▼                            ▼                        ▼
                         ┌───────────────┐           ┌───────────────────┐      ┌─────────────┐
                         │ Supabase /    │           │ Redis (ioredis)   │      │ Google APIs │
                         │ Postgres +    │           │  - session cache  │      │ Maps/Dir.   │
                         │ PostGIS 4326  │           │  - driver loc 5dk │      │ Geocoding   │
                         │  RPC + RLS    │           │  - match kuyruk   │      │             │
                         └───────────────┘           │  - active ride    │      └─────────────┘
                                                     └───────────────────┘
```

**Dizin düzeni (monorepo tarzı, üç paket):**

| Paket | Yol | Açıklama |
|---|---|---|
| Backend | `backend/` | Node 20 + TypeScript 5, `express`, `socket.io`, `ioredis`, `@supabase/supabase-js`, `jsonwebtoken`, `bcrypt`, `zod`, `helmet`, `winston` |
| Mobile | `mobile/` | Flutter 3.x, `flutter_riverpod`, `go_router`, `dio`, `socket_io_client`, `google_maps_flutter`, `geolocator`, `flutter_secure_storage`, `lottie` |
| Veritabanı | `supabase/migrations/` | Postgres + PostGIS (EPSG:4326), RLS, 4 RPC, 5 trigger |

**Ek dosyalar:**
- `backend/scripts/add_session_version.sql` — oturum geçersizleştirme için sonradan eklenen tek-cümle migration
- `backend/.env` — çalışma zamanı sırlar (Redis TLS, JWT secret'ları, Google API key, Supabase key'ler)

---

## 2. Backend (Node.js / Express + Socket.io)

### 2.1 Giriş noktaları

| Dosya | Sorumluluk |
|---|---|
| `backend/src/server.ts` | `http.createServer(app)` + `initSocketManager(server)` + `server.listen(HOST, PORT)`. `SIGTERM`/`SIGINT` üzerine graceful shutdown: `io.close()` → `closeRedisConnections()` |
| `backend/src/app.ts` | Express app yapılandırması: `app.set('trust proxy', 1)`, `helmet`, **CORS whitelist** (`env.CORS_ORIGINS` virgülle bölünür), **genel rate-limit** (`/health` hariç), JSON gövde `10 MB`, API prefix `/api/v1/{auth,users,drivers,rides,reviews}`, 404 + errorHandler |

### 2.2 Config katmanı

| Dosya | Özet |
|---|---|
| `config/env.ts` | **Zod ile doğrulanan env şeması** — eksik/yanlış tipte değişken varsa sunucu başlamaz. `REDIS_TLS` stringden boolean'a parse edilir; `Upstash` gibi yönetilen servisler için TLS şart. |
| `config/supabase.ts` | İki istemci üretir: RLS için **anon** (`supabase`) ve bypass için **service role** (`supabaseAdmin`, `persistSession: false`). Backend business-logic tarafı neredeyse tamamen `supabaseAdmin` kullanır. |
| `config/redis.ts` | `ioredis` için `retryStrategy`, `enableOfflineQueue`, koşullu `tls: {}`. **İki ayrı bağlantı** tanımlı: komutlar için `redis`, Pub/Sub için `redisSub`. _Not: kod tabanında `publish`/`subscribe` çağrısı henüz yok; yatay ölçekte Socket.io redis adapter için altyapı hazır._ |

### 2.3 Kimlik doğrulama modülü (`modules/auth/`)

**Akış:** Access token (kısa ömürlü) + Refresh token (uzun ömürlü, rotasyonlu) + **`session_version`** (oturum geçersizleştirme için bütünlük sayacı).

| Bileşen | Detay |
|---|---|
| `auth.routes.ts` | Üç ayrı limiter: `loginLimiter` (1 dk / 10 başarısız — `skipSuccessfulRequests`), `refreshLimiter` (1 dk / 30), `registerLimiter` (1 saat / 10). Tüm route'lar `validate()` + Zod şemalardan geçer. |
| `auth.service.ts::registerCustomer` / `registerDriver` | Bcrypt 12 round; sürücü kaydında `users` + `drivers` satırları **tek transaction** mantığında ardışık oluşturulur (başarısızlıkta temizlik). İlk token çifti `session_version=1` ile üretilir. |
| `auth.service.ts::login` | Parola doğrular → **`session_version` artırımı** (bu, önceki cihazlardaki tüm access token'ları anında geçersiz kılar) → yeni refresh token DB'ye yazılır → `invalidateSessionVersionCache()` → `disconnectStaleSocketsForUser()` eski cihaz socket'lerini kopartır. |
| `auth.service.ts::refreshTokens` | Refresh JWT doğrulanır + DB'deki `refresh_token` ile eşleşmesi kontrol edilir → **rotation**: yeni çift üretilir, DB güncellenir. Şüpheli kullanımda (token eşleşmezse) DB refresh alanı `null`'a çekilir. |
| `auth.service.ts::logout` | JWT'deki `session_version` DB ile eşleşiyorsa bir sonraki değere yükseltir; sonrasında cache invalidation + tüm socket'leri `auth:session_ended` ile kapatır. |
| `utils/jwt.ts` | `TokenPayload` = `{ userId, role, sessionVersion }`. Access ve refresh ayrı secret'larla imzalanır. |

### 2.4 Middleware katmanı

| Dosya | Davranış |
|---|---|
| `middleware/auth.middleware.ts` | JWT doğrula → `session_version`'ı Redis `auth:sv:{userId}` (TTL **60 s**) üzerinden okur, miss olursa DB'den alıp cache'ler. Eşleşmezse **401 + `code: SESSION_REPLACED`** — istemci bu koda karşı yereli temizler. `authMiddlewareLogout` ise `session_version` kontrolü yapmaz (logout anında eski token'la da çıkış mümkün). |
| `middleware/role.middleware.ts` | `roleMiddleware(['driver'])` gibi rol whitelistinden geçemezse 403. |
| `middleware/validate.middleware.ts` | `validate(schema, 'body' \| 'query' \| 'params')` — Zod hata detayıyla 400 döner. |
| `middleware/error.middleware.ts` | `AppError` sınıfı + `notFoundHandler` + merkezi `errorHandler` (dev'de stack trace). |

### 2.5 Ride modülü

```
modules/ride/
├── ride.routes.ts        # Public: GET /tariff, POST /estimate | Korumalı: CRUD
├── ride.controller.ts    # Req/Res sınır katmanı
├── ride.service.ts       # İş mantığı + Supabase çağrıları
└── pricing.service.ts    # Kırıkkale tarifesi: açılış 14 ₺, km başı 9 ₺, min 20 ₺
```

**Kritik özellikler:**

- **`createRide`** — Yeni yolculuk öncesinde müşterinin başka aktif yolculuğu var mı kontrol eder (tekillik kuralı). Pickup/dropoff'u `SRID=4326;POINT(lng lat)` WKT formatında yazar.
- **`updateRideStatus`** (atomic accept) — Statü geçişlerini **koşullu `UPDATE`** ile yapar:
  - `searching → accepted` için `.eq('status','searching').is('driver_id', null)` filtresi uygulanır; yarışı kaybeden sürücü satırı bulamaz → 409 döner. Bu sayede iki sürücü aynı yolculuğu aynı anda kabul edemez.
- **`getActiveRide`** — `rides` tablosundaki `pickup_location`/`dropoff_location` PostGIS `GEOGRAPHY` sütunları Supabase REST'i üzerinden **EWKB hex** olarak gelir. Backend'in `utils/geo.ts::decodeEwkbPoint` yardımcısı bunu little-endian / big-endian / SRID-flag farklarını tolere ederek `{lat, lng}`'e çevirir. Ek olarak müşteri için **atanmış sürücünün** profil + araç + Redis'teki anlık konumunu iliştirir.

### 2.6 Eşleştirme (Matching) servisi

`services/matching.service.ts` — **Sistemin kalbi**.

| Sabit | Değer | Anlam |
|---|---|---|
| `MAX_DRIVERS_PER_RIDE` | 5 | Bir yolculuk için en fazla 5 sürücüye sırayla sorulur |
| `DRIVER_REQUEST_TIMEOUT_MS` | 30000 | Her sürücünün cevap için 30 sn'si var |
| `SEARCH_RADIUS_METERS` | 5000 | PostGIS `ST_DWithin` yarıçapı |
| Redis anahtarları | `ride:matching:{rideId}` (kuyruk, 300 s) • `ride:rejected:{rideId}` (reddedenler, 300 s) • `ride:pending:{rideId}` (o an bekleyen sürücü, timeout+5 s) | — |

**Akış:**
1. `startMatching` — `findNearbyDrivers` (PostGIS) → kuyruk JSON olarak Redis'e yazılır → `sendRequestToNextDriver` çağrılır.
2. `sendRequestToNextDriver` **while loop** üzerine kuruludur (önceki sürüm özyinelemeli idi — derin çağrı yığını riski vardı). Her iterasyonda:
   - Kuyruktan bir sürücü al → `notification.service` ile `ride:new_request` gönder → `ride:pending:{rideId}` anahtarını yaz → `setTimeout(handleDriverTimeout, 30s)`.
   - `handleDriverRejection` veya timeout durumunda sıradakine geçilir.
3. Kuyruk biterse `handleNoDriversAvailable` → müşteriye `ride:no_driver_found` + yolculuk `cancelled`'e çekilir.
4. `clearMatchingQueue(rideId, notifyPendingDriver)` — müşteri çağrıyı iptal ederse bekleyen sürücüye `ride:request_cancelled` gönderir, TTL'li anahtarları siler.

### 2.7 Konum servisi

`services/location.service.ts`:

- **`findNearbyDrivers`** — Supabase RPC `find_nearby_drivers(lat, lng, radius_meters, max_results)` çağırır. RPC içinde `is_online=true AND is_available=true` WHERE koşulu var; yani sadece müsait sürücüler döner. Reddeden sürücüler JavaScript tarafında filtrelenir.
- **`updateDriverLocation`** — iki hedefli yazım: Redis `driver:location:{id}` (5 dk TTL, anlık sorgular için) + RPC `update_driver_location` (DB'deki `current_location` günceller + `driver_locations_history` tablosuna geçmiş kaydı düşer).
- **`getActiveDriversInArea`** — Yakın sürücüleri PostGIS ile bul, her biri için Redis'ten en güncel konumu al, `nearby:drivers` payload'ı için `{driverId, lat, lng, bearing}` üret.

### 2.8 Socket.io katmanı

```
sockets/
├── socket.manager.ts         # init + connection/disconnect bookkeeping + helpers
├── middleware/socket.auth.ts # handshake JWT + session_version
└── handlers/
    ├── driver.handler.ts     # driver:go_online | go_offline | location:update
    ├── ride.handler.ts       # ride:request | accept | reject | arrived | start | complete | cancel
    └── tracking.handler.ts   # ride:snapshot (reconnect) + customer:nearby:query
```

**Typed Socket.io:** `types/socket.types.ts` → `ClientToServerEvents` / `ServerToClientEvents` arayüzleri. IDE otomasyonu + derleme zamanı tip güvenliği sağlar.

**`socket.manager.ts`:**
- CORS origin callback'i mobil istemcilerde `origin` gelmeyebileceğini dikkate alır (izin verir).
- `pingTimeout: 60000`, `pingInterval: 25000` — arka plana atılan mobil uygulamalar için makul pencere.
- `disconnectStaleSocketsForUser(userId, activeSessionVersion)` — yeni login'de **yalnızca eski oturum versiyonundaki** socket'ler koparılır; eşzamanlı kurulan yeni socket korunur (yarış koşulu giderilmiş).

**`middleware/socket.auth.ts`:**
- Token iki yerden okunur: `auth.token` veya `Authorization` header (`Bearer ...` prefix temizlenir).
- REST'te olduğu gibi `session_version` Redis cache üzerinden doğrulanır.

**`driver.handler.ts`:**
- `driver:go_online` → DB `is_online=true, is_available=true` + Redis `driver:socket:{id}` + halihazırda açık yolculuk var mı kontrolü → `DRIVER_ACTIVE_RIDE_KEY` cache (TTL 600 s; kabul anında 86400 s'ye çıkar).
- `driver:location:update` (5 sn aralıkla) → `updateDriverLocation` (Redis + RPC paralel) → aktif yolculuk cache'indeki `customerId`'yi okuyup ilgili `ride:{rideId}` odasına `driver:location:broadcast` gönderir. **Önemli:** Cache-first yaklaşım sayesinde her 5 saniyelik update'te DB sorgusu yapılmaz.
- `disconnect` → online sürücüyü offline'a çeker, konum broadcast'ini durdurur.

**`ride.handler.ts`:**
- `ride:accept` kritik yol: `updateRideStatus` atomic olarak döner → `Promise.all([driver info, customer info, driver location, pendingRedisKey delete])` → müşteriye `ride:accepted` + ETA (`estimateArrivalTime`, 30 km/h varsayımlı), ayrıca `clearMatchingQueue(rideId, notifyPendingDriver=false)`.
- `ride:arrived` → `updateRideStatus('arriving')` → **yalnızca `ride:{rideId}` odasına** `ride:driver_arrived` emit (sürücünün ekranında "Sürücü Geldi" yazmasın diye; sürücü kendi UI'sinde farklı metin gösterir).
- `ride:complete` → statüyü `completed`'e çeker, `driver:active_ride` Redis anahtarını temizler, sürücünün `is_available`'ini asenkron olarak `true` yapar.
- `ride:cancel` — müşteri veya sürücü çağırabilir; `searching` durumunda `findSearchingRideIdForCustomer` ile rideId tespit edilir, kuyruk temizlenir, bekleyen sürücüye `ride:request_cancelled` gönderilir.

**`tracking.handler.ts` (reconnect + nearby):**
- **`customer:nearby:query`** — 2.5 sn sunucu-tarafı cooldown; yarıçap 500 m–15 km ile kelepçelenir; `getActiveDriversInArea` sonucu `nearby:drivers` olarak client'a döner.
- **`ride:snapshot`** — Socket bağlandığı anda hem müşteri hem sürücü için `rideService.getActiveRide` çağrılır. Aktif yolculuk varsa: `ride:{rideId}` odasına join + `ride:snapshot` (yolculuk + sürücü/müşteri bilgisi + koordinatlar) + `ride:status_update` emit edilir. Müşteri için ayrıca sürücünün anlık konumu `driver:location:broadcast` olarak push edilir.

### 2.9 Yardımcı modüller

| Dosya | İşlev |
|---|---|
| `utils/distance.ts` | Haversine mesafe (km/m), `estimateArrivalTime` (30 km/h varsayım) |
| `utils/geo.ts` | EWKB POINT hex → `{lat, lng}` decoder (LE/BE + SRID flag toleranslı) |
| `utils/logger.ts` | Winston transport'ları; seviye `env.LOG_LEVEL` ile kontrol edilir |

---

## 3. Veritabanı (Supabase / PostgreSQL / PostGIS)

**Migration:** `supabase/migrations/001_initial_schema.sql`
**Ek:** `backend/scripts/add_session_version.sql` — `users.session_version INT DEFAULT 1`

### 3.1 Tablolar

| Tablo | Önemli sütunlar | Notlar |
|---|---|---|
| `users` | `id uuid PK`, `phone unique`, `password_hash`, `role ('customer' \| 'driver')`, `rating`, `rating_count`, `session_version`, `refresh_token` | Bcrypt hash; refresh token DB'de nullable; role enum |
| `drivers` | `id uuid PK → users.id`, `vehicle_plate`, `vehicle_model`, `vehicle_color`, `is_online bool`, `is_available bool`, `current_location GEOGRAPHY(POINT,4326)`, `total_rides` | 1-1 ilişki; geography SRID 4326 (WGS84) |
| `rides` | `id uuid PK`, `customer_id`, `driver_id FK nullable`, `pickup_location/dropoff_location GEOGRAPHY POINT`, `pickup_address/dropoff_address text`, `distance_km`, `estimated_price/final_price`, `status ride_status enum`, ve `*_at` zaman damgaları | `ride_status`: `searching \| accepted \| arriving \| in_progress \| completed \| cancelled` |
| `reviews` | `ride_id`, `reviewer_id`, `reviewed_id`, `rating 1..5`, `comment` | `update_user_rating` trigger'ı tetikler |
| `driver_locations_history` | `driver_id`, `location GEOGRAPHY`, `recorded_at` | Konum izi; `cleanup_old_location_history` RPC'si ile eski kayıtlar temizlenir |

### 3.2 İndeksler (performans-kritik)

| İndeks | Tip | Amaç |
|---|---|---|
| `idx_drivers_available` | B-tree **partial** `WHERE is_online=true AND is_available=true` | Yakın sürücü sorgusunda only-matching rows |
| `idx_drivers_location` | GIST (`current_location`) | `ST_DWithin` / `ST_Distance` için |
| `idx_rides_status` | B-tree partial, aktif yolculuklar | Her active ride sorgusu için hızlı |
| `idx_rides_pickup` | GIST (`pickup_location`) | Gerekirse spatial ride sorguları |
| `idx_rides_customer` / `idx_rides_driver` | B-tree (`+ requested_at DESC`) | Geçmiş listeleme |
| `idx_driver_loc_history`, `idx_driver_loc_geo` | B-tree + GIST | Geçmiş izi sorguları |

### 3.3 Trigger'lar

- `trigger_*_updated_at` — 3 tablo için otomatik `updated_at` güncelleme.
- `trigger_update_rating` (reviews INSERT) — değerlendirilen kullanıcının `rating` ve `rating_count`'u yeniden ortalamayla günceller.
- `trigger_increment_rides` (rides UPDATE) — statü `completed`'e geçtiğinde `drivers.total_rides++`.

### 3.4 RPC fonksiyonları

| RPC | İşlev |
|---|---|
| `find_nearby_drivers(lat, lng, radius_meters, max_results)` | `ST_DWithin` ile filtre + `ST_Distance` ile sıra + `users`/`drivers` JOIN ile sürücü profili |
| `update_driver_location(p_driver_id, p_lat, p_lng, p_bearing)` | `drivers.current_location` günceller + `driver_locations_history`'ye yeni satır ekler |
| `get_ride_stats(p_user_id)` | Toplam yolculuk, kazanç vb. istatistikler |
| `cleanup_old_location_history()` | Eski konum izi kayıtlarını siler (cron ile çalıştırılabilir) |

### 3.5 Row-Level Security (RLS)

- `users` — kendi satırını güncelleme; okuma geniş (SELECT `true` — bunun daraltılması önerilir, bkz. Bölüm 8).
- `drivers` — herkes okuyabilir; sürücü sadece kendisini güncelleyebilir.
- `rides` — müşteri veya sürücü olarak **kendi yolculuğunu** okuyabilir.
- `reviews` — herkes okuyabilir; reviewer kendi yorumunu yazar.

**Not:** Backend iş mantığı çoğunlukla `supabaseAdmin` (service role) ile çalışır ve RLS'i bypass eder. RLS burada mobil uygulamanın doğrudan Supabase'e bağlandığı durumlara karşı **ek savunma hattıdır**.

---

## 4. Redis kullanımı

| Anahtar | TTL | Amaç |
|---|---|---|
| `auth:sv:{userId}` | 60 s | `session_version` cache — her request'te DB hit'i önler |
| `driver:socket:{driverId}` | 86400 s (online olunca) | Sürücünün aktif socket ID'si; targeted `ride:new_request` için |
| `driver:location:{driverId}` | 300 s | Sürücünün en son `{lat, lng, bearing, updatedAt}` değeri |
| `driver:active_ride:{driverId}` | 600 s / 86400 s | `{rideId, customerId}` — location update'lerinde ride room'a broadcast için |
| `ride:matching:{rideId}` | 300 s | Sıradaki sürücü kuyruğu (JSON array) |
| `ride:rejected:{rideId}` | 300 s | O yolculuğu reddeden sürücü ID seti |
| `ride:pending:{rideId}` | timeout + 5 s | Şu an cevap bekleyen sürücünün ID'si |

**TLS:** `REDIS_TLS=true` (Upstash ve diğer yönetilen servisler için zorunlu). `config/redis.ts`'de koşullu `tls: {}` opsiyonu açılır.

**Pub/Sub:** `redisSub` export'u mevcut ancak kullanılmıyor. Yatay ölçekte Socket.io için `@socket.io/redis-adapter` entegrasyonu ileride gerekecek.

---

## 5. Mobile (Flutter)

### 5.1 Giriş ve yönlendirme

- **`main.dart`** — `initializeDateFormatting('tr_TR')` + `Intl.defaultLocale='tr_TR'` (geçmiş sayfasındaki `LocaleDataException` için). `MaterialApp.router` + `GlobalMaterialLocalizations`/`GlobalWidgetsLocalizations`/`GlobalCupertinoLocalizations` delegate'leri. `sessionKickMessageProvider`'ı dinleyerek "başka cihazdan giriş" SnackBar'ı.
- **`core/router/app_router.dart`** — `GoRouter` + `_GoRouterRefresh` (Riverpod'u listenable'a çevirir). `redirect` mantığı:
  - Giriş yoksa ve splash/auth dışındaysa → `/auth/login`.
  - Giriş varsa ve auth sayfasındaysa → rol'e göre `/driver` veya `/customer`.

### 5.2 State yönetimi (Riverpod)

`providers/providers.dart` — tüm singleton'lar ve state notifier'lar:

| Provider | Tür | İşlev |
|---|---|---|
| `storageServiceProvider` | `Provider` | Secure storage + SharedPreferences facade |
| `apiServiceProvider` | `Provider` | Dio istemcisi; 401/`SESSION_REPLACED` callback'leri ile oturumu temizler |
| `socketServiceProvider` | `Provider` | Socket.io istemcisi; `auth:session_ended` callback'i |
| `currentUserProvider` | `StateNotifierProvider<CurrentUserNotifier, UserModel?>` | `_AsyncMutex` ile eşzamanlı `setUser`/`clearSessionLocally` yarışını önler; `sessionGeneration` sayacı |
| `activeRideProvider` | `StateNotifierProvider<ActiveRideNotifier, RideModel?>` | Aktif yolculuk state'i |
| `assignedDriverProvider` | `StateNotifierProvider<AssignedDriverNotifier, DriverInfoModel?>` | Eşleşen sürücünün profili + anlık konumu |
| `isDriverOnlineProvider` / `pendingRideRequestProvider` | `StateProvider` | Sürücü UI durumu |

**Oturum yarış koşulu koruması:** `_sessionGeneration` her `setUser`'da artar; `clearSessionLocally(onlyIfGenerationIs: gen)` araya yeni giriş girdiyse temizliği atlar.

### 5.3 Servisler

- **`services/api_service.dart`** — Dio, `_authInterceptor`. **Refresh token yarış koşulu koruması:** `Completer`-tabanlı `_refreshTokenOnce()`; eşzamanlı 401'lerde tek refresh çağrısı yapılır, diğerleri aynı future'ı bekler. Refresh başarısızsa `onRefreshFailed` callback'i tetiklenir.
- **`services/socket_service.dart`** — tüm sunucu event'leri için **broadcast StreamController**'lar (`onRideAccepted`, `onDriverLocation`, `onRideSnapshot`, `onNearbyDrivers`, …). `connect(token)` → `enableReconnection` sonsuz deneme (1 << 30), `_lastToken` saklanır. `ensureConnected()` — her `_emit` sırasında bağlantı yoksa otomatik kurar; `auth:session_ended` ilk 3 saniyede yok sayılır (yeni login sırasında eski socket'ten gelen event'ler yanlışlıkla yeni oturumu kapatmasın).
- **`services/storage_service.dart`** — access/refresh token için `FlutterSecureStorage`, user modeli için `SharedPreferences`.
- **`services/directions_service.dart`** — Google Directions API wrapper; alternatif rotalar, encoded polyline decode, distance/duration.
- **`services/ride_match_sound.dart`** — `flutter_ringtone_player` ile kısa bildirim sesi (yolculuk eşleşince).

### 5.4 Ekranlar

```
lib/screens/
├── splash_screen.dart                 # loadSavedUser + /auth/getMe doğrulama
├── auth/
│   ├── login_screen.dart              # Key('login_phone_field'), Key('login_password_field') — Firebase Test Lab
│   ├── register_screen.dart
│   └── driver_register_screen.dart
├── customer/
│   ├── customer_home_screen.dart      # Harita + pickup/dropoff + yakın taksi markerları + ride sheet
│   ├── destination_search_screen.dart # Google Places Autocomplete
│   ├── ride_bottom_sheet.dart         # Rezervasyon paneli (ConstrainedBox + SingleChildScrollView)
│   ├── ride_tracking_sheet.dart       # Aktif yolculuk UI'ı (arıyor/kabul/yolda/geldi/başladı)
│   ├── ride_completion_screen.dart    # Yolculuk özeti + puan
│   └── ride_history_screen.dart       # Geçmiş listesi
├── driver/
│   ├── driver_home_screen.dart        # Online toggle + harita + rota
│   ├── active_ride_panel.dart         # DraggableScrollableSheet + sürücüye özel status metinleri
│   ├── ride_request_dialog.dart       # Gelen çağrı için 30s sayaçlı kabul/ret
│   └── earnings_screen.dart           # Günlük/haftalık kazanç
└── profile/
    └── profile_screen.dart            # Tek birleşik profil ekranı (müşteri+sürücü)
```

**Tema ve bileşenler:** `core/theme/app_theme.dart` (palet: Taksi Sarısı #F2C94C, Gece Mavisi #1B1B2F, Beyaz, Antrasit; Poppins; 24–30dp radius), `core/widgets/` (`breathing_dot`, `glass_card`, `animated_entry`, `status_pill`, `map_fab`, `sheet_reveal`, `draggable_sheet_handle`), `core/utils/map_marker_icons.dart` (programatik sarı üstten görünüm taksi bitmap'i).

### 5.5 Önemli mobil akışlar

**Yolculuk oluşturma (müşteri):**
1. GPS izni → `Geolocator.getCurrentPosition` → pickup + kamera zoom.
2. `DestinationSearchScreen` → seçilen `PlaceDetail` → dropoff.
3. `DirectionsService.getDirectionsAlternatives` → 1-3 rota polyline → `_routeAlternatives`.
4. `RideBottomSheet` üzerinden "Taksi Çağır" → `SocketService.requestRide(...)` → beklenen event: `ride:searching` (rideId update), sonrasında `ride:accepted` veya `ride:no_driver_found`.

**Yolculuk reconnect/restore:**
- Splash sonrası socket bağlanır → backend tarafı `ride:snapshot` emit → `customer_home_screen._applyRideSnapshot` veya `driver_home_screen._applyRideSnapshot` payload'u ayrıştırıp state'i restore eder.
- Ek güvence için `GET /rides/active` REST çağrısı yapılır (socket gecikirse).
- Harita: pickup/dropoff marker'ları çizilir, rota yeniden çizilir, sürücünün anlık konumu marker olarak yerleşir.

**Yakın taksiler (müşteri haritası):**
- `Timer.periodic(8s)` → `SocketService.queryNearbyDrivers(lat, lng)` → sunucu 2.5 s cooldown sonrası `nearby:drivers` döner → sarı taksi marker'ları güncellenir.
- Aktif yolculuk başlayınca Timer durur, markerlar temizlenir.

---

## 6. Uçtan uca yolculuk akışı

```
MÜŞTERİ                        BACKEND (API + Socket + Redis + PG)                        SÜRÜCÜ
   │                                      │                                                   │
   │  POST /rides/estimate                │                                                   │
   │ ───────────────────────────────────▶ │                                                   │
   │  {distance, price}                   │                                                   │
   │ ◀─────────────────────────────────── │                                                   │
   │                                      │                                                   │
   │  socket: ride:request                │                                                   │
   │ ───────────────────────────────────▶ │                                                   │
   │                                      │ createRide(searching)                             │
   │                                      │ startMatching → findNearbyDrivers (PostGIS)       │
   │                                      │ ride:pending:{id} SET                             │
   │                                      │                                                   │
   │  socket: ride:searching (rideId)     │                                                   │
   │ ◀─────────────────────────────────── │                                                   │
   │                                      │ socket: ride:new_request (to first driver)        │
   │                                      │ ───────────────────────────────────────────────▶  │
   │                                      │                                                   │
   │                                      │ socket: ride:accept (atomic UPDATE)               │
   │                                      │ ◀────────────────────────────────────────────────│
   │                                      │ Promise.all(driver,user,location,del-pending)     │
   │  socket: ride:accepted + driverInfo  │                                                   │
   │ ◀─────────────────────────────────── │                                                   │
   │                                      │                                                   │
   │                                      │ socket: driver:location:update (her 5 sn)         │
   │                                      │ ◀────────────────────────────────────────────────│
   │                                      │ Redis + RPC update                                │
   │  socket: driver:location:broadcast   │                                                   │
   │ ◀─────────────────────────────────── │                                                   │
   │                                      │                                                   │
   │                                      │ socket: ride:arrived                              │
   │                                      │ ◀────────────────────────────────────────────────│
   │  socket: ride:driver_arrived         │                                                   │
   │ ◀─────────────────────────────────── │                                                   │
   │                                      │                                                   │
   │                                      │ socket: ride:start                                │
   │                                      │ ◀────────────────────────────────────────────────│
   │  socket: ride:started                │                                                   │
   │ ◀─────────────────────────────────── │                                                   │
   │                                      │                                                   │
   │                                      │ socket: ride:complete + finalPrice                │
   │                                      │ ◀────────────────────────────────────────────────│
   │                                      │ updateRideStatus(completed)                       │
   │                                      │ DEL driver:active_ride:{driverId}                 │
   │                                      │ driver.is_available = true (async)                │
   │  socket: ride:completed              │                                                   │
   │ ◀─────────────────────────────────── │                                                   │
   │  RideCompletionScreen                │                                                   │
```

**Ek akışlar:**
- **Disconnect/reconnect:** Socket bağlanınca `tracking.handler` otomatik `ride:snapshot` push eder → istemci state'i kaldığı yerden restore eder. REST `/rides/active` yedek yol olarak mevcut.
- **İptal:** `ride:cancel` → `clearMatchingQueue` → bekleyen sürücüye `ride:request_cancelled` → `rides.status=cancelled`.
- **Timeout:** Sürücü 30 sn'de cevaplamazsa `handleDriverTimeout` → sıradaki sürücü. Kuyruk biterse `ride:no_driver_found`.

---

## 7. Güvenlik önlemleri — özet

| Katman | Önlem | Konum |
|---|---|---|
| Kimlik | Bcrypt 12 round, JWT access+refresh, refresh rotation, `session_version` invalidation, başka cihaz tespiti | `auth.service.ts`, `auth.middleware.ts`, `socket.auth.ts` |
| API saldırı yüzeyi | `helmet`, CORS whitelist, genel rate-limit + auth özel (login 10/dk, register 10/saat, refresh 30/dk), `trust proxy` | `app.ts`, `auth.routes.ts` |
| Giriş doğrulama | Zod şema validasyonu (body/query/params) | `validate.middleware.ts` + her modülün `*.schema.ts` dosyaları |
| Yetkilendirme | `roleMiddleware`, ride tarafında customer/driver ownership kontrolü | `role.middleware.ts`, `ride.service.ts::updateRideStatus` |
| Yarış koşulları | Atomic `UPDATE .eq('status','searching').is('driver_id', null)`, Completer-gate refresh, `_AsyncMutex` oturum | `ride.service.ts`, `api_service.dart`, `providers.dart` |
| Taşıma | HTTPS/WSS (deployment), Redis TLS (`REDIS_TLS=true`) | `.env`, `redis.ts` |
| Log/Observability | Winston, seviyeli loglar, PII içeren log yok | `utils/logger.ts` |
| Supabase | Row-Level Security (ek katman); service role backend'de izole | `001_initial_schema.sql`, `supabase.ts` |

---

## 8. Performans önlemleri — özet

1. **Redis caching** — session_version (60 s), sürücü konumu (5 dk), sürücünün aktif yolculuğu (600 s). Her sürücü konum update'inde artık DB'ye query atılmıyor.
2. **Paralel fetch** — `ride:accept` ve `getActiveRide` gibi kritik yollarda `Promise.all` ile sürücü + müşteri + konum aynı anda çekiliyor.
3. **Atomic conflict resolution** — yolculuğu ilk kabul eden kazanır (`.eq/.is` filtreli update); yarış kaybedeni 409 yer.
4. **İteratif matching** — önceki özyinelemeli versiyonda (Node call stack) derin zincir riski vardı; `while` ile güvene alındı.
5. **Kısmi/GIST indeksler** — müsait sürücüler partial index ile taranır; spatial sorgu GIST ile optimize.
6. **Rate limiting** — hem API (brute force) hem de socket event'lerinde (nearby query 2.5 s throttle).
7. **Bitmap marker cache** — `MapMarkerIcons` statik BitmapDescriptor'ları tek kez üretip paylaşır.
8. **Refresh token single-flight** — istemcide Completer gate ile eşzamanlı 401'ler tek refresh'e yakınsar.
9. **Directions API cache** — sürücü tarafında `_lastRouteKey` ile aynı hedefe tekrar çağrı yapılmaz.

---

## 9. Risk ve iyileştirme önerileri

### 9.1 Kısa vadede

- **`driver:active_ride` tip tutarlılığı:** `tracking.handler` bunu JSON string olarak yazarken `driver.handler` okurken tekrar JSON.parse varsayıyor. İki tarafı da **JSON olarak serialize et / parse et** (tek format) + defensive guard — tip karışıklığı yarın bir hata çıkarabilir.
- **RLS `users` SELECT policy'si:** Şu an `USING true` (herkes herkesin telefonunu görebilir). Daralt: `auth.uid() IS NOT NULL` + sadece gerekli kolonlar (`id, full_name, avatar_url, rating`).
- **Migration tek parça:** `add_session_version.sql` ana migration'a eklensin; yeni ortama deploy ederken atlanma riski ortadan kalkar.
- **Location history temizliği:** `cleanup_old_location_history()` için pg_cron (veya Supabase scheduled function) tetikleyicisi eklenmeli.
- **Periyodik debug log temizliği:** Zaten yapıldı (`findNearbyDrivers` debug log'u kaldırıldı).

### 9.2 Orta vadede

- **Socket.io Redis adapter:** Şu an `redisSub` tanımlı ama kullanılmıyor. Backend 2+ instance'a çıkarken `@socket.io/redis-adapter` gerekecek.
- **Driver location broadcast'in geohash tabanlı yakın taksi push'u:** Şu an `customer:nearby:query` 8 sn polling; gelecekte coğrafi bölge tabanlı publish/subscribe ile gerçek zamanlı hale getirilebilir.
- **Push notification (FCM/APNs):** Uygulama öldüğünde sürücü yeni çağrıyı göremiyor. `ride:new_request` paralelinde push notification gönderilmeli.
- **Sürücü için zorunlu konum izni (Android 10+ background):** Arka plan konum için `flutter_background_service` + Android foreground service (bildirimli) gerekli; şu an `WidgetsBindingObserver` sadece foreground'da tutuyor.
- **Observability:** Winston → OpenTelemetry / Sentry entegrasyonu; kritik metrikler (matching success rate, avg time-to-match, reject ratio) dashboard'a yansıtılmalı.

### 9.3 Uzun vadede

- **Horizontal scaling:** Backend stateful değil (tüm paylaşılan state Redis'te), ama Socket.io için Redis adapter + yük dengeleyici + sticky session olmadan websocket upgrade çözümü gerekli.
- **PostGIS'e alternatif in-memory mekansal yapı:** 1000+ sürücü ve yüksek QPS'te Redis Geo commands (`GEOADD`, `GEOSEARCH`) matching latency'sini ms'e düşürür.
- **Dinamik fiyatlandırma:** `pricing.service` şu an sabit tarife; yoğunluk çarpanı + talep tahmini eklenebilir.
- **E2E ve yük testleri:** Matching servisinin 100+ eşzamanlı istek altında davranışı simüle edilmeli (k6 + playwright + flutter integration_test).

---

## 10. Sonuç

Proje, MVP seviyesinde **production-ready** bir mimari sunuyor: temiz katmanlar, tipli socket kontratları, atomic race-safe yolculuk kabulü, Redis caching, PostGIS ile doğru spatial sorgular, güvenli oturum yönetimi ve Flutter tarafında Riverpod ile iyi organize edilmiş state.

Tüm kritik akışlar (oluştur → eşleştir → kabul → takip → tamamla) uçtan uca tipli ve izlenebilir. Disconnect/reconnect dayanıklılığı `ride:snapshot` mekanizmasıyla ele alınmış; müşteri haritasındaki müsait taksi görüntüsü canlı feed ile besleniyor.

Geliştirme odakları: arka plan konum (Android foreground service), FCM push, Socket.io redis adapter, RLS daraltması ve observability stack'i. Bunlar tamamlandığında sistem **350+ sürücülü Kırıkkale operasyonunu rahatlıkla taşır** ve çok şehirli ölçeğe çıkmaya hazır hale gelir.
