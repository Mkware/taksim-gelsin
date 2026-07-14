# Taksim Gelsin — Kod Tabanı Analizi ve Yol Haritası

**Tarih:** 12 Temmuz 2026
**Kapsam:** `backend/`, `mobile/`, `supabase/`, `web/` — hiçbir dosya değiştirilmeden yapılan salt-okunur analiz.
**Karar:** Mevcut proje geliştirilmeye devam edilmeli (yeniden yazım ve büyük refactoring reddedildi). Aşağıdaki fazlar sırayla uygulanacak.

---

## Peşin sonuç

Kod tabanı ~33k satır (backend ~12,5k TS, mobile ~20k Dart), 14 migration. Mimari kararların neredeyse tamamı doğru; asıl riskler kodda değil, kodun etrafındaki eksik süreçlerde (git, test, CI, migration takibi). Gereken şey işi durduran bir refactor değil, disiplinli bir sertleştirme programı.

---

## Başlık başlık değerlendirme

### 1. Mimari — İyi (beklenenin üstünde)

- Backend'de net katmanlama: `routes → controller → service`, Zod şemaları, merkezi hata yakalayıcı, tek HTTP sunucusunda REST + Socket.io ayrımı.
- Doğru yerde doğru araç: eşleştirme durumu Redis'te (Lua ile atomik `claimTimeoutSlot`, LPOP kuyruğu), kalıcı veri Supabase'te, operasyonel ayarlar `platform_settings` tablosunda (env yalnızca bootstrap).
- Restart dayanıklılığı düşünülmüş: `OFFER_DEADLINES_ZSET` + sweeper, `stale_searching_recovery` cron'u, graceful shutdown.
- Mobilde rol bazlı tek binary, GoRouter redirect, Dio interceptor'da eşzamanlı 401'leri tek refresh'e indiren `Completer` deseni.
- **Zayıf nokta:** Her şey tek Node process'ine bağlı. Socket.io için Redis adapter yok, `getSocketManager()` singleton, throttle durumu socket-içi bellekte. İkinci instance açıldığı anda oturum kesme ve canlı takip bozulur. Kırıkkale için sorun değil; Türkiye ölçeği için evrim adımı gerekir.

### 2. Kod kalitesi — Orta-iyi, iki uçlu

- Backend tutarlı, yorumlu, tipli ve savunmacı yazılmış.
- Mobil dengesiz: `admin_home_screen.dart` **3.526 satır**, `driver_home_screen.dart` 1.554 satır, tüm provider'lar tek 506 satırlık dosyada (`providers.dart`).
- CLAUDE.md "riverpod_annotation + freezed codegen" diyor ama kodda tek bir `@riverpod` anotasyonu veya üretilmiş `.g.dart`/`.freezed.dart` dosyası yok — bağımlılıklar ölü, modeller elle yazılmış. Dokümantasyon kodun önünde.
- `firebase_auth` pubspec'te var, hiçbir yerde kullanılmıyor (ölü bağımlılık).
- Backend'de `npm run lint` tanımlı ama eslint devDependencies'te yok ve config dosyası yok — **lint komutu fiilen çalışmaz**.
- Desen ihlalleri: `admin.routes.ts` (1.005 satır, 30 route) controller/service katmanını atlayıp route içinde doğrudan DB sorgusu yapıyor; `matching.service.old.ts` ölü kod (CLAUDE.md bilinçli tuttuğunu söylüyor).

### 3. Teknik borç — Yönetilebilir ve büyük ölçüde belgelenmiş

Borçlar biliniyor; `problems.md` giderilen/açık maddeleri tablo halinde tutuyor. Açık kalan gerçek borçlar:

1. **Sıfır otomatik test + CI yok** (en büyük borç).
2. **Versiyon kontrolü kırık:** repo kökü ve `backend/` git deposu değil; yalnızca `mobile/` içinde bir `.git` var. Klasör adı "yedek kopyası 2". `problems.md` "git geçmişine bakın" diyor ama bu kopyada geçmiş yok.
3. Manuel SQL migration'lar (SQL editöründen elle, `002_` çakışan numaralar) — uygulanmış/uygulanmamış takibi insan hafızasında.
4. Tarife (`pricing.service.ts`) kodda sabit: 50 TL açılış / 50 TL-km / 150 TL taban / 3 TL-dk bekleme. Diğer ayarlar `platform_settings`'e taşınmışken tarife taşınmamış — tarife değişikliği deploy gerektirir, çok-şehirli modeli bloke eder.
5. Mobil dev ekranlar (madde 2'deki dosyalar).

### 4. Güvenlik — Temel sağlam, üç ciddi açık

**İyi olanlar:** bcrypt(12), access/refresh ayrımı + rotation, `session_version` ile tek-cihaz oturumu, Helmet/CORS/rate limit, Zod input doğrulama, üretim env'inde zorunlu sıkılaştırmalar (env.ts refine'ları), RLS sertleştirmesi (008), cüzdanda idempotency.

**Ciddi açıklar:**

1. **SMS OTP yok.** Kayıtta telefon sahipliği doğrulanmıyor. Admin yetkisi `ADMIN_PHONES` listesindeki telefona bakıyor — admin henüz kayıt olmamışsa, numarasını bilen biri o numarayla kayıt olup **admin paneline erişebilir**. Üretim öncesi kapatılmalı. **Ertelendi (14 Tem 2026):** sağlayıcılar kurumsal marka/şirket kaydı istiyor, şu an elde yok.
2. ~~HTTPS yok~~ — 13 Tem 2026'da çözüldü (`api.taksimgelsin.com`, domain + TLS kuruldu).
3. ~~Refresh token DB'de düz metin~~ — 14 Tem 2026'da çözüldü: `users.refresh_token` artık SHA-256 hash olarak saklanıyor (`hashRefreshToken()`, `backend/src/utils/jwt.ts`). Not: bu değişiklik deploy edildiğinde mevcut oturumlardaki eski düz-metin token'lar DB'deki hash ile eşleşmeyeceği için geçersiz olur — tüm kullanıcılar bir kere daha giriş yapmak zorunda kalır (kabul edilebilir, henüz üretimde gerçek kullanıcı yok).

**Küçükler:** pickup PIN `Math.random` (kriptografik değil), 10 MB JSON body limiti gereksiz büyük. ~~Rate limiter `/api/v1/admin/*`'ı tamamen atlıyor~~ — düzeltildi: global limiter admin'i atlasa da `admin.routes.ts` kendi `adminApiLimiter`'ını (120 istek/dk, auth+requireAdmin sonrası) zaten uyguluyormuş, bu analiz yanlış işaretlenmişti (14 Tem 2026'da doğrulandı, kod değişikliği gerekmedi).

### 5. Performans — Bu ölçek için yeterli

- PostGIS `ST_DWithin` + GIST indeksi, kısmi indeksler, 5 dk Redis cache'li sürücü istatistikleri, TTL cache'li Distance Matrix, `MAX_DRIVERS` sınırı.
- Konum güncellemeleri sunucu tarafı throttle'lı; ancak her güncelleme `driver_locations_history`'ye satır yazıyor — `cleanup_old_location_history()` fonksiyonu var ama **pg_cron'a bağlanması manuel ve unutulmaya açık**; unutulursa tablo sınırsız büyür.
- `loadDriverStats` sürücü başına 2 sorgu (N+1), aday ≤5 ve cache'li — şimdilik önemsiz.

### 6. Ölçeklenebilirlik — Kırıkkale: evet; Türkiye: planlı evrim

Üç kapı, üçü de mevcut mimariyi çöpe atmadan açılabilir:

1. **Yatay ölçek:** `@socket.io/redis-adapter` + çok-instance güvenli oturum kesme/teklif sweeper (matching zaten Redis-atomik).
2. **Kalıcı iş kuyruğu:** `setTimeout` yerine BullMQ/delayed-job (problems.md'de planlı).
3. **Çok-şehirlilik:** şemada `city` kavramı hiç yok — en erken atılması gereken veri modeli adımı. Tarife ve arama yarıçapı şehir başına parametreleşmeli, eşleştirme şehir/bölge ile partition'lanmalı.

### 7. Bakım kolaylığı — Backend iyi, mobil zor, süreç kırık

Modül deseni ve Türkçe yorum disiplini backend'i okunur kılıyor; CLAUDE.md ve docs/ gerçekten yardımcı. Mobilde 3.5k satırlık ekranlar değişikliği riskli kılıyor. Asıl engel süreç: git yok, CI yok, test yok, migration takibi elle.

### 8. Test edilebilirlik — En zayıf alan

- Backend: 0 test, runner bile yok. Mobil: tek placeholder widget testi.
- Servisler `supabaseAdmin`/`redis`'i modül seviyesinde import ediyor (DI yok), `env.ts` import anında `process.exit` yapabiliyor — birim test için hafif DI veya entegrasyon-ağırlıklı strateji (testcontainers ile Redis + Postgres) gerekir.
- En kritik akışlar: `accept_ride_with_fee` yarışları, refund idempotency, ride durum makinesi, session_version akışı. Kritik mantığın çoğu SQL fonksiyonlarında toplandığı için pgTAP/SQL senaryolarıyla bile yüksek değerli test yazılabilir.

### 9. Firebase kullanımı — Doğru boyutta, minimal

Yalnızca FCM (doğru karar — kimlik/DB/storage Supabase + backend'te). Backend'te FCM opsiyonel, yoksa Socket.io fallback; token kaydı `device_push_tokens` RLS'li. Pürüzler: kullanılmayan `firebase_auth` bağımlılığı; FCM yokken sürücüler arka planda uyandırılamaz (üretimde FCM fiilen zorunlu).

### 10. Veritabanı tasarımı — İyi, yer yer çok iyi

- Şema normal, indeksler bilinçli (kısmi + GIST), `GEOGRAPHY(POINT,4326)` doğru tip.
- `007_wallet_ledger_atomic_accept.sql` projenin en kaliteli parçası: append-only ledger, `CHECK (balance >= 0)`, müşteri başına tek aktif yolculuk partial unique index, tek transaction'da koşullu kabul + kesinti + ledger, idempotent refund. Çift harcama/iade yarışları DB seviyesinde kapalı.
- Eksikler: `city/region` yok, migration sürüm takibi yok, `driver_request_log` migration'ı atlanırsa sessizce varsayılana düşülüyor, trigger tabanlı rating güncellemesi yüksek hacimde kilitlenme adayı (şimdilik önemsiz).

### 11. API tasarımı — Tutarlı ve yeterli

`/api/v1` öneki, modüler route'lar, tutarlı `{success, data|error}` zarfı, Zod doğrulama, UUID/enum/limit kontrolleri uygulanmış. Socket olay isimleri (`ride:*`, `driver:*`) tutarlı. Eksikler kozmetik: OpenAPI/Swagger yok, `admin.routes.ts` desen dışı, hata kodları (`SESSION_REPLACED` gibi) sistematik değil.

---

## Karar ve gerekçe

**Seçenek 1 — Mevcut proje geliştirilmeye devam edilmeli.**

- **Yeniden yazım (3) yanlış olur:** Mimari kararlar (Redis'te eşleştirme, atomik cüzdan RPC'leri, session_version, platform_settings, rol bazlı tek binary) bugün sıfırdan başlansa yine verilecek kararlar. Koda gömülü, yaşanarak öğrenilmiş düzeltmeler (timeout-kabul yarışı, çift refresh, LPOP kuyruğu, restart sonrası teklif kurtarma) sıfırdan yeniden keşfedilmek zorunda kalır. 6+ ay kayıp, daha az test edilmiş bir sistemle dönüş.
- **Büyük refactoring (2) de yanlış olur:** Borçların çoğu yapısal değil süreçsel (git/test/CI/migration). Bunlar kod yeniden şekillendirilerek değil, altyapı kurularak çözülür. Tek büyük yapısal borç (mobil dev ekranlar) ekran-ekran, iş durdurmadan ödenebilir. Güvenlik ağı (test) olmadan büyük refactor yapılmaz; testler yazılınca büyük refactor'a gerek kalmadığı görülecek.

---

## Yol haritası (uygulama sırası — her adım bir sonrakinin güvenlik ağı)

### Faz 0 — Zemin (hemen, ~1 hafta)

- [ ] 1. Repo kökünü git'e al (backend + supabase + mobile tek monorepo; `mobile/.git` durumu netleştirilip birleştirilmeli), GitHub'a push.
- [ ] 2. Bozuk `lint` script'ini onar (eslint kur + config) ve `flutter analyze` ile birlikte GitHub Actions CI'ına bağla (`tsc --noEmit` + lint + `flutter test`).
- [ ] 3. Ölü bağımlılıkları temizle (`firebase_auth`), CLAUDE.md'yi gerçek durumla eşitle (codegen iddiası).

### Faz 1 — Üretim önü güvenlik (2–3 hafta)

- [x] 4. Domain + HTTPS (Nginx/Caddy reverse proxy), mobilde `SERVER_ORIGIN` https'e geçiş. — 13 Tem 2026'da tamamlandı (`api.taksimgelsin.com`, bkz. sunucu-domain-tls memory).
- [ ] 5. SMS OTP ile telefon doğrulama — **ertelendi**: sağlayıcılar (Netgsm/İleti Merkezi vb.) kurumsal marka/şirket kaydı istiyor, şu an elde yok. Admin telefonlarının kayıtsız-numara açığı bilinen risk olarak kalıyor; marka kaydı tamamlanınca yeniden ele alınacak.
- [x] 6. Refresh token'ları hash'leyerek sakla; admin route'larına ayrı rate limit. — 14 Tem 2026: refresh token hash'leme yapıldı; admin rate limit zaten mevcutmuş (analiz hatası düzeltildi). Faz 1'in kalan tek maddesi SMS OTP (ertelendi).

### Faz 2 — Test güvenlik ağı (sürekli, ilk hedef 4–6 hafta)

- [x] 7a. Backend'e vitest + testcontainers (Postgres+PostGIS) kuruldu (14 Tem 2026) — `backend/tests/`, CI'ya `npm test` eklendi. İlk testler: `accept_ride_with_fee` yarışları (eşzamanlı iki sürücü), yetersiz bakiyede tam rollback, `refund_ride_accept_fee` idempotency. Bu süreçte gerçek bir migration hatası bulundu ve düzeltildi: `007_wallet_ledger_atomic_accept.sql`, `deduct_driver_balance`'ı `VOID`'dan `BOOLEAN`'a `CREATE OR REPLACE` ile değiştirmeye çalışıyordu (Postgres buna izin vermiyor, önce `DROP` şart) — **canlı Supabase projesinde bu fonksiyonun gerçekten `BOOLEAN` döndürüp döndürmediği doğrulanmalı**, sıfırdan bir ortamda migration'lar sırayla uygulansa bu adımda patlardı.
- [ ] 7b. Kalan kritik testler: ride status geçişleri (searching → accepted → arriving → in_progress → completed), session_version akışı (çoklu cihaz oturum kesme).
- [ ] 7c. Redis testcontainer kurulumu (`@testcontainers/redis` zaten devDependency olarak eklendi, henüz kullanan test yok) — `smart_matching.service.ts`'nin Lua atomik claim mantığı için.
- [ ] 8. Kritik Socket akışları için entegrasyon testi (istek → teklif → timeout → sıradaki sürücü).

### Faz 3 — Yapısal borç ödeme (özellik geliştirmeyle paralel)

- [ ] 9. Migration'ları takip edilebilir yap (Supabase CLI veya en az bir `schema_migrations` tablosu).
- [ ] 10. Mobilde "dokunduğun ekranı böl" kuralı: `admin_home_screen.dart`'tan başlayarak feature-klasörlü yapıya kademeli geçiş; provider'ları dosyalara ayır.
- [ ] 11. `admin.routes.ts`'i controller/service desenine çek; `matching.service.old.ts`'i sil (git geçmişi artık referans olur).
- [ ] 12. Tarifeyi `platform_settings`'e taşı.

### Faz 4 — Türkiye ölçeği hazırlığı (büyümeden önce)

- [ ] 13. Şemaya `city` boyutu ekle; tarife/yarıçap/ayarlar şehir başına.
- [ ] 14. `@socket.io/redis-adapter` + çok-instance güvenli oturum kesme; `setTimeout`'ları BullMQ'ya taşı.
- [ ] 15. Merkezi log/izleme (en az Sentry + yapılandırılmış log toplama).

### Ayrıca (fazlara dağıtılabilir küçük işler)

- [ ] `cleanup_old_location_history()` için pg_cron zamanlaması kur (unutulursa tablo sınırsız büyür).
- [ ] Pickup PIN'i `crypto.randomInt` ile üret.
- [ ] JSON body limitini 10 MB'dan makul bir değere indir (örn. 1 MB).
- [ ] OpenAPI/Swagger dokümantasyonu (öncelik düşük).
