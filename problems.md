# Güvenlik ve dayanıklılık notları (güncel)

Bu dosya geçmiş tespitleri ve **güncel kod durumunu** özetler. Detaylı kök neden analizi için git geçmişine bakın.

## 1. REST — çoğu madde kodda giderildi

| Konu | Durum |
|------|--------|
| `PUT /users/me` — `full_name` / `avatar_url` | Uzunluk + `avatar_url` yalnızca `https://` veya boş |
| `PATCH /admin/drivers/:id/access` — `enabled` | `typeof === 'boolean'` zorunlu |
| `GET /reviews/ride/:rideId` | UUID + yalnızca yolculuktaki müşteri/sürücü |
| `POST /reviews` | UUID, tam sayı puan (string `"5"` kabul), yorum max 500, **`reviewed_id` = karşı taraf** |
| `GET /drivers/nearby` — `radius` | Üst sınır 10 km |
| `GET /reviews/user/:userId` — `limit` | En fazla 50 |
| `PUT /admin/settings/pricing` | Zod ile sınırlı sayılar |
| `GET /rides?status=` | İzin verilen enum; aksi 400 |
| `GET /rides/:id`, `POST .../cancel` | UUID v4 doğrulaması |
| `GET /rides` sayfalama | `limit` en fazla 100 (controller + servis) |

## 2. Yolculuk durum makinesi

| Konu | Durum |
|------|--------|
| `ride:complete` — `finalPrice` | Sunucuda aralık doğrulaması (önceki sürümde eklendi) |
| Müşteri `in_progress` → `cancelled` | **Engellendi** — iptal yalnızca atanan sürücü |
| Cüzdan iade başarısız | `WALLET_RECONCILE_NEEDED` JSON log satırı + `logRefundAfterAcceptFailure` |
| `handleNoDriversAvailable` yarışı | Kabul sonrası yalnızca sessiz Redis temizliği (önceki düzeltme) |

## 3. Redis eşleştirme

| Konu | Durum |
|------|--------|
| Timeout vs kabul yarışı | Lua ile atomik `claimTimeoutSlot` |
| Kuyruk GET/shift/SET yarışı | **Redis LIST + LPOP** (atomik sıra); eski JSON string tek seferlik migrate |
| Process restart → `setTimeout` kaybı | Hâlâ risk; `stale_searching_recovery` kısmen korur. İleride: BullMQ / delayed job |

## 4. Socket / konum

| Konu | Durum |
|------|--------|
| `driver:active_ride` JSON vs düz UUID | `driver:location:update` içinde **normalize** edilerek DB sorgusu düzelir |

## 5. Bilinçli olarak açık kalan / düşük öncelik

- **Redis + DB aynı anda down**: auth katmanı güvenli fail (401) — erişilebilirlik trade-off.
- **Otomatik test runner**: backend’de hâlâ yok; kritik akışlar için entegrasyon testi önerilir.
- **`verifyPickupCode`**: RPC’ye taşınabilir (düşük öncelik).
- **`driver_request_log` tablosu**: migration atlanırsa istatistik varsayılanları; migration checklist’te tutulmalı.

---

**Özet:** REST yüzeyi ve değerlendirme/yolculuk kuralları üretim için çok daha sıkı; eşleştirme kuyruğu ve cüzdan hata izlenebilirliği iyileştirildi. Kalan ana borç: **kalıcı job kuyruğu** (restart sonrası matching zamanlayıcı) ve **otomatik testler**.
