# Taksim Gelsin — Üretim Hazırlığı Değerlendirmesi

**Belge tarihi:** 10 Mayıs 2026  
**Kapsam:** `backend/`, `mobile/`, `supabase/` (CLAUDE.md mimarisine göre)

Bu belge, sistemin canlı ortama alınabilirliğini teknik açıdan özetler. Sonuç **koşullu**: aşağıdaki “Kritik / Yüksek” maddeler kapatılmadan tam üretim hazır sayılmamalıdır.

---

## 1. Executive summary

| Alan | Durum | Not |
|------|--------|-----|
| Mimari (REST + Socket.io + Supabase + Redis) | Uygun | Üç parça net ayrılmış |
| Ortam doğrulama (Zod) | Güçlü | Eksik env ile süreç başlamaz |
| Güvenlik temeli (Helmet, CORS, rate limit, JWT) | İyi | Ek sertleştirme önerilir |
| İş mantığı (eşleştirme, cüzdan, oturum) | Orta risk | Redis tek nokta; eşleştirme timeout’ları process’e bağlı |
| Test / CI | Zayıf | Otomatik test ve pipeline yok |
| Sırlar ve yapılandırma | İyileştirildi | `.env.example` placeholder; mobil `dart-define`; üretim env şeması sıkı |

**Özet karar:** Ortam doğru doldurulup migration + gözlemlenebilirlik tamamlandığında canlıya alınabilir; aşağıdaki operasyon listesi ve kalan riskler geçerlidir.

### Son kod / yapılandırma hazırlığı (özet)

- `backend/.env.example`: gerçek anahtar yok; `ADMIN_LOG_OUT_PATH` / `ADMIN_LOG_ERROR_PATH` eklendi.
- `backend/src/config/env.ts`: `NODE_ENV=production` iken **kart simülasyonu kapalı**, **ADMIN_PHONES dolu**, **JWT iki gizli farklı** olmalı (aksi halde süreç başlamaz).
- `GET /health/ready`: Redis `PING` + Supabase hafif sorgu (load balancer readiness).
- Admin log endpoint: yalnızca env ile verilen dosya yollarından okur.
- Mobil: `SERVER_ORIGIN` ve `GOOGLE_MAPS_API_KEY` → `String.fromEnvironment` (derleme sırasında); ayrıntı `docs/MOBILE_URETIM_DERLEMESI.md`.

---

## 2. Mimari özeti

- **Backend:** Node 20+ (14 Tem 2026'da 18+'dan yükseltildi — vitest 4.x test tooling gereksinimi; üretim çalışma zamanı kodu Node 20'ye özgü bir şey kullanmıyor), TypeScript, Express, Socket.io; JWT + `session_version`; smart matching Redis üzerinde.
- **Veri:** Supabase (PostgreSQL + PostGIS); migration’lar `supabase/migrations/` altında, **Supabase SQL editörü ile manuel** uygulanıyor (CLI yok).
- **Mobil:** Tek Flutter binary; Riverpod + GoRouter; backend origin runtime’da değiştirilebilir (admin ekranı).
- **Kritik dış bağımlılıklar:** Redis (eşleştirme, konum cache, session cache), Supabase, isteğe bağlı Google Distance Matrix, FCM (boşsa yalnızca socket).

---

## 3. Güçlü yönler (üretime yaklaştıran)

1. **`env.ts` (Zod):** Zorunlu anahtarlar ve tip kontrolü; hatalı yapılandırmada süreç çıkıyor.
2. **HTTP güvenliği:** Helmet, CORS whitelist, global rate limit (`trust proxy` ile uyumlu).
3. **Graceful shutdown:** SIGTERM/SIGINT’te cron durdurma, Socket kapatma, Redis kapatma.
4. **Oturum modeli:** `session_version`, stale socket kesme; dokümantasyonda (CLAUDE.md) iyi anlatılmış.
5. **Platform ayarları:** Operasyonel parametreler DB’de; env yalnızca bootstrap — doğru ayrım.
6. **Son iyileştirmeler (kod tabanında yapılmış):** REST doğrulamaları (reviews, admin pricing, rides status, UUID param’lar, nearby radius), `ride:complete` için `finalPrice` aralığı, `driver:active_ride` Redis format tutarlılığı, smart matching için dağıtık lock ve `handleNoDriversAccepted` yarış düzeltmesi, hayalet sürücü temizliğinde socket+heartbeat birlikte kriteri, müşteri iptalinde T-Coin iade kuralları (`accepted`/`arriving` iade, `in_progress` iade yok — kötüye kullanım önlemi).

---

## 4. Kritik ve yüksek öncelikli riskler

### 4.1 Sırlar ve örnek dosyalar

- Repodaki `backend/.env.example` artık yalnızca placeholder içerir. Daha önce örnek dosyada **gerçek** anahtarlar paylaşıldıysa, canlı Supabase ve Redis için **rotate** (yenileme) yapılmış olmalıdır.
- Gerçek `.env` yalnızca sunucuda veya secret manager’da tutulmalıdır.

### 4.2 Mobil istemci — derleme zamanı sırları (**düşük risk, süreç**)

- Release derlemesinde `--dart-define=SERVER_ORIGIN=...` ve `--dart-define=GOOGLE_MAPS_API_KEY=...` kullanın (`docs/MOBILE_URETIM_DERLEMESI.md`).
- Backend tarafında **HTTPS + sabit domain** ve `CORS_ORIGINS` ile uyum önerilir.

### 4.3 Redis tek nokta arızası (**YÜKSEK**)

- Hem oturum önbelleği hem eşleştirme Redis’e bağlı. Redis kısa süreli down olduğunda auth ve matching etkilenir. Üretimde: yüksek kullanılabilirlik Redis, bağlantı yeniden deneme politikası ve runbook gerekir.

### 4.4 Eşleştirme ve process restart (**YÜKSEK / ORTA**)

- `setTimeout` tabanlı sürücü yanıt süreleri process içinde; **sunucu restart/deploy** sonrası `searching` yolculuklar için timeout yeniden kurulmaz (kodda da not var). Üretimde: BullMQ / delayed job / Redis TTL + periyodik “stuck ride” taraması gibi dayanıklı bir model düşünülmeli.

### 4.5 Cüzdan: deduct → accept → refund zinciri (**YÜKSEK**)

- Yarış durumunda iade RPC’si başarısız kalırsa bakiye tutarsızlığı riski devam eder. Üretimde: idempotent refund, dead-letter kuyruğu veya `wallet_transactions` benzeri denetlenebilir kayıt şart.

### 4.6 Admin log endpoint’i

- `ADMIN_LOG_OUT_PATH` ve `ADMIN_LOG_ERROR_PATH` ile yapılandırılır; boşsa endpoint boş dizi ve açıklama döner. Uzun vadede merkezi log (Loki, CloudWatch vb.) önerilir.

### 4.7 Sağlık kontrolü

- `/health` — süreç ayakta.
- `/health/ready` — Redis + Supabase (readiness); rate limit ve admin route’larından muaf tutulur.

### 4.8 Test ve kalite kapısı (**ORTA**)

- Backend `package.json` içinde **test script’i yok**; repo kökünde CI workflow yok. Regresyon riski yüksek; en azından kritik modüller (auth, `updateRideStatus`, wallet refund) için birim testi ve release öncesi manuel senaryo listesi önerilir.

### 4.9 Supabase RLS ve service role (**YÜKSEK — mimari doğrulama**)

- Backend `supabaseAdmin` (service role) kullanıyor; güvenlik büyük ölçüde uygulama katmanında. Üretim öncesi: tablolar için **Row Level Security** politikalarının gözden geçirilmesi, mümkünse hassas okumaların RPC/edge ile sınırlandırılması önerilir (bu belge kod incelemesiyle tam doğrulanmadı; ayrı güvenlik turu gerekir).

---

## 5. Operasyonel kontrol listesi (canlı öncesi)

- [ ] Daha önce sızdırılmış anahtarlar varsa Supabase/Redis **rotate**; gerçek `.env` yalnızca sunucuda  
- [ ] `NODE_ENV=production`, `LOG_LEVEL=warn` veya `error`  
- [ ] `WALLET_CARD_SIMULATION_ENABLED=false` (üretimde env doğrulaması zorunlu kılar)  
- [ ] `ADMIN_PHONES` dolu ve doğru E.164 (üretimde zorunlu)  
- [ ] `JWT_ACCESS_SECRET` ≠ `JWT_REFRESH_SECRET` (üretimde zorunlu)  
- [ ] Load balancer `GET /health/ready` ile readiness  
- [ ] İsteğe bağlı: `ADMIN_LOG_OUT_PATH` / `ADMIN_LOG_ERROR_PATH` (admin log ekranı için)  
- [ ] `CORS_ORIGINS` yalnızca gerçek web/admin origin’leri  
- [ ] `FCM_SERVICE_ACCOUNT_JSON` dolu (sürücü arka plan bildirimi için)  
- [ ] Supabase migration’larının canlı projede sırayla uygulandığının doğrulanması  
- [ ] Redis persistence / cluster stratejisi ve yedekleme  
- [ ] HTTPS reverse proxy (nginx/Caddy), TLS sertifikası, HTTP→HTTPS yönlendirme  
- [ ] PM2/systemd unit, `restart: on-failure`, log rotation  
- [ ] Monitoring: CPU, bellek, Redis latency, Supabase hata oranı, 5xx oranı  
- [ ] Mobil: Google Maps key kısıtlaması (Android package / iOS bundle ID) ve kota uyarıları  
- [ ] Store yayını: gizlilik politikası, KVKK metinleri, sürüm numarası

---

## 6. Sonuç

Kod tabanında üretim odaklı sıkılaştırma (örnek env, üretim env kuralları, readiness, admin log yolları, mobil `dart-define`) uygulanmıştır. Canlı öncesi yine de **migration**, **TLS/CORS**, **anahtar rotate** (geçmiş sızıntı varsa), **Redis yüksek erişilebilirlik**, **test/CI** ve **RLS güvenlik turu** operasyon ekibi tarafından tamamlanmalıdır. Staging’de yük testi ve uçtan uca yolculuk senaryoları ile son onay önerilir.

---

*Bu belge kod tabanının o anki durumuna dayanır; değişiklik sonrası güncellenmelidir.*
