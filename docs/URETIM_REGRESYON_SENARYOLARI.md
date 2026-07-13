# Üretim ve regresyon — senaryo kataloğu

Bu belge, canlıda veya staging’de **manuel / uçtan uca** doğrulanması gereken durumları listeler. Repo içinde otomatik E2E test paketi tanımlı değildir; “tüm test senaryoları çalışır mı?” sorusunun cevabı: **yalnızca bu listeyi bilinçli olarak çalıştırırsanız** davranış doğrulanmış olur.

---

## A. Eşleştirme ve sürücü yanıtı (kritik yarışlar)

| # | Senaryo | Beklenen davranış (özet) | Risk / not |
|---|---------|---------------------------|------------|
| A1 | Sürücü, yanıt süresinin **son milisaniyesinde** `ride:accept` gönderir; Redis `ride:pending` hâlâ kendisi | Kabul başarılı; DB `searching`→`accepted`; T-Coin kesilir; müşteri `ride:accepted` alır | Timeout ile yarış: kabul önce gelirse kazanır |
| A2 | Süre dolduktan **hemen sonra** sürücü kabul etmeye çalışır; `pending` artık yok veya başka sürücü | `ride:accept_failed` + `ride:request_cancelled` (TIMEOUT) | Normal |
| A3 | Timeout callback ile kabul **aynı anda** (yüksek gecikme) | Dağıtık lock + `handleSmartAcceptance` sırası ile tek “kazanan”; diğer taraf hata veya iade | İzle: çift offer, çift kesinti |
| A4 | Sürücü A reddeder; sıraya sürücü B gider | B’ye teklif; A’nın kilidi temizlenir | |
| A5 | Kuyrukta kimse kalmadı / uygun sürücü yok | `handleNoDriversAvailable`: ride iptal veya kapanma akışı; müşteri `ride:no_driver_found` | DB zaten `accepted` ise yanlış iptal bildirimi gitmemeli (kod tarafında koruma var) |
| A6 | Eşleştirme sırasında müşteri **searching** iken iptal | `clearSmartMatchingQueue` + bekleyen sürücüye iptal; Redis temiz | |
| A7 | Sürücü B’ye teklif giderken müşteri iptal | Bekleyen sürücüye `ride:request_cancelled` | |
| A8 | **Sunucu restart** searching ride varken | `stale_searching_recovery.service`: başlangıç + her 5 dk, `STALE_SEARCHING_MINUTES` (varsayılan 15) aşan `searching` yolculuklar iptal + Redis temiz + müşteri `ride:cancelled` | Eşik değerini yoğunluğa göre ayarlayın |

---

## B. Müşteri iptal ↔ sürücü kabul (aynı an)

| # | Senaryo | Beklenen | Cüzdan |
|---|---------|----------|--------|
| B1 | Müşteri `ride:cancel` / REST iptal ile `searching`→`cancelled` **tam o sırada** sürücü `ride:accept` | Biri atomic update’te kazanır; diğeri 409 veya pending uyuşmazlığı | Kazanan kabul ise kesinti; kaybeden kabul ise `refundRideAcceptFee` (retry’li) |
| B2 | Müşteri iptal **önce** commit; sürücü sonra kabul | `pending` silinmiş → TIMEOUT benzeri başarısız kabul | Kesinti olmamalı |
| B3 | Sürücü kabul **önce** DB `accepted`; müşteri hemen ardından iptal (REST veya socket) | `accepted`→`cancelled` geçerli; müşteri iptali → **T-Coin iade** (`accepted` kuralı) | İade RPC başarısız kalırsa bakiye riski — log + manuel kontrol |
| B4 | Sürücü `arriving` iken müşteri iptal | İptal + **iade** | |
| B5 | Sürücü `in_progress` iken müşteri iptal | İptal + **iade YOK** (komisyondan kaçış önlemi) | Sürücü T-Coin’de kalır |
| B6 | İki cihazdan aynı müşteri hesabıyla çift iptal | İkincisi idempotent / hata mesajı; UI senkron | |

---

## C. Sürücü tarafı iptal ve durum geçişleri

| # | Senaryo | Beklenen |
|---|---------|----------|
| C1 | `accepted` iken sürücü iptal | İptal geçerli; müşteri bilgilendirilir |
| C2 | `arriving` iken sürücü iptal | İptal |
| C3 | `in_progress` iken sürücü iptal | İptal (iş kuralına göre ücret/iade ayrı tanımlanmış olmalı — müşteri iptaliyle simetri kontrol edin) |
| C4 | Sürücü `ride:arrived` → `arriving` | Müşteri `ride:driver_arrived` |
| C5 | Kod doğrulanmadan `ride:start` | Red / hata |
| C6 | `ride:complete` ile `finalPrice` sınır dışı (negatif, >100000, NaN) | İşlem reddedilmeli (socket tarafında doğrulama) |
| C7 | `ride:complete` ile makul `finalPrice` | `completed`; `final_price` yazılır |

---

## D. Cüzdan ve T-Coin

| # | Senaryo | Beklenen |
|---|---------|----------|
| D1 | Kabul ücreti kadar bakiye **yok** | `INSUFFICIENT_BALANCE`; DB değişmez |
| D2 | Kesinti başarılı, DB accept **409** (yarış) | `refundRideAcceptFee` 5 denemeli backoff | Tümü başarısızsa `KRİTİK` log + manuel iade prosedürü |
| D3 | `WALLET_CARD_SIMULATION_ENABLED` canlıda **true** (yanlışlıkla) | `NODE_ENV=production` ile süreç **başlamaz** (env şeması) | |
| D4 | Admin manuel bakiye ekleme | RPC veya fallback; sürücü bakiyesi güncellenir |

---

## E. Socket, yeniden bağlanma ve konum

| # | Senaryo | Beklenen |
|---|---------|----------|
| E1 | Müşteri searching sırasında uygulama öldürülür, açılır | `ride:snapshot` / aktif ride; eşleştirme sırası UI’da sınırlı olabilir |
| E2 | Sürücü aktif yolculukta socket kopar, tekrar bağlanır | `driver:active_ride` düz string; ilk `driver:location:update` müşteriye yayın | |
| E3 | Sürücü **durakta uzun süre** konum göndermez; socket açık | Hayalet temizlik **çalışmamalı** (heartbeat yok ama socket var) | |
| E4 | Sürücü uygulama öldürülmüş, DB hâlâ online | Zamanla heartbeat+socket yok → hayalet temizlik (politikanıza göre doğru mu kontrol edin) | |
| E5 | Başka cihazdan aynı kullanıcı login | Eski socket’ler düşer (`session_version`) | |

---

## F. REST ve güvenlik (regresyon)

| # | Alan | Senaryo |
|---|------|---------|
| F1 | Auth | Süresi dolmuş access; refresh; refresh başarısız |
| F2 | `GET /rides?status=gecersiz` | 400, 500 değil |
| F3 | `GET /reviews/ride/:id` | Yalnızca ride’a dahil olan kullanıcı |
| F4 | `POST /reviews` | rating tam sayı; comment max; UUID format |
| F5 | `PUT /admin/settings/pricing` | Negatif / Infinity reddedilir |
| F6 | `PATCH /admin/drivers/:id/access` | `enabled` yalnızca boolean JSON |
| F7 | Rate limit | Çok istek → 429 benzeri mesaj |

---

## G. Altyapı ve dış servisler

| # | Senaryo | Beklenen / not |
|---|---------|----------------|
| G1 | Redis tamamen down | Auth cache + matching etkilenir; kullanıcılar 401 veya işlem hatası görebilir |
| G2 | Supabase kısa kesinti | İstekler 500; kabul/iade zinciri riski |
| G3 | `FCM_SERVICE_ACCOUNT_JSON` boş | Arka planda sürücü yalnızca socket ile uyarılır |
| G4 | Google Distance Matrix kota / hata | Matcher Haversine fallback (kodda var) |
| G5 | `GET /health` vs `GET /health/ready` | Liveness her zaman 200; readiness Redis/DB başarısızsa 503 |

---

## H. Mobil uygulama (derleme ve runtime)

| # | Senaryo | Not |
|---|---------|-----|
| H1 | Release APK **dart-define olmadan** | Varsayılan localhost + boş Maps anahtarı → harita/ API yanlış | `docs/MOBILE_URETIM_DERLEMESI.md` |
| H2 | Admin ekranından backend origin değiştirme | Kalıcı origin; socket yeniden JWT | |
| H3 | iOS arka plan / FCM | Çağrı bildirimi ve tekrar gönderim |

---

## I. Admin ve operasyon

| # | Senaryo |
|---|---------|
| I1 | `ADMIN_LOG_*` boş → log API boş + mesaj |
| I2 | `ADMIN_LOG_*` dolu → son N satır |
| I3 | Platform ayarları değişince (timeout süresi) uç uçta teklif süresi |
| I4 | Sürücü silme; Redis anahtarları temizliği |

---

## J. Veri ve migration

| # | Senaryo |
|---|---------|
| J1 | Yeni ortamda tüm `supabase/migrations` sırası |
| J2 | `driver_request_log` / RPC yoksa matcher istatistik varsayılanları (log uyarısı) |

---

## Özet: “Hepsi çalışır mı?”

- **Otomatik olarak hayır** — CI’da koşan bir E2E paketi yok.
- **Davranışsal olarak** yukarıdaki tablolar, üretim öncesi ve her major release’te **checklist** olarak kullanılmalıdır.
- Özellikle **A8 (restart)**, **B1–B5 (yarış)**, **D2 (iade hatası)** ve **G1–G2** senaryoları en sık “canlıda garip” hissi verenlerdir.

İstersen bir sonraki adımda bu listenin bir kısmını **Playwright / k6** veya **manuel test şablonu** (Google Sheet) formatına dönüştürebilirim.
