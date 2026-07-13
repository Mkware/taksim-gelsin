# Yerel Redis kurulumu (Production VPS)

Bu rehber, Taksim Gelsin backend’inin **Upstash (uzak Redis)** yerine **aynı VPS üzerinde yerel Redis** kullanması için adım adım kurulumu anlatır.

## Özet

| Konu | Açıklama |
|------|----------|
| Süre | Yaklaşık **15–30 dakika** (SSH erişimi varsa) |
| Mobil uygulama | **Değişiklik yok** — App Store build / review tekrar gerekmez |
| Kod değişikliği | **Gerekmez** — backend zaten `REDIS_*` ortam değişkenlerini okur |
| Kesinti | `pm2 restart` sırasında birkaç saniye API/socket kopabilir |

Redis bu projede **kalıcı veritabanı değildir**; sürücü konumu, eşleştirme kuyruğu, oturum cache (`auth:sv:*`) gibi **geçici cache** amaçlıdır. Asıl veri Supabase (PostgreSQL) içindedir. Sunucu yeniden başlarsa Redis cache sıfırlanır; uygulama bunu tolere edecek şekilde yazılmıştır.

---

## Ne değişir, ne değişmez?

### Değişmez
- Mobil uygulama API adresi (`SERVER_ORIGIN`, örn. `http://SUNUCU_IP:3000`)
- Supabase, JWT, FCM ayarları
- App Store / Play Store paketleri

### Değişir (yalnızca sunucu)
- `backend/.env` içindeki `REDIS_HOST`, `REDIS_PASSWORD`, `REDIS_TLS`
- VPS’te yeni bir `redis-server` servisi çalışır

---

## Ön koşullar

- Production backend’in çalıştığı **Linux VPS**’e SSH erişimi (root veya `sudo`)
- Backend **PM2** ile çalışıyor olmalı (loglarda `taksim-backend` görünüyorsa uyumludur)
- Backend dizini örnek: `/root/backend` — sizde farklıysa komutlarda yolu değiştirin

---

## Bölüm 1 — Redis sunucusunu kurma (Ubuntu / Debian)

### 1.1 Paketi kur

```bash
sudo apt update
sudo apt install -y redis-server
```

### 1.2 Sadece localhost’tan dinlesin (güvenlik)

Redis’i internete açmayın. Backend aynı makinede olduğu için `127.0.0.1` yeterlidir.

```bash
sudo sed -i 's/^supervised no/supervised systemd/' /etc/redis/redis.conf
```

`redis.conf` dosyasını düzenleyin:

```bash
sudo nano /etc/redis/redis.conf
```

Şu satırları bulun ve şöyle ayarlayın (yoksa ekleyin):

```conf
bind 127.0.0.1 ::1
protected-mode yes
port 6379
```

**Önemli:** `bind 0.0.0.0` veya tüm arayüzlere açık bind **kullanmayın** (güvenlik riski).

İsteğe bağlı — bellek sınırı (küçük VPS için önerilir, örn. 256 MB):

```conf
maxmemory 256mb
maxmemory-policy allkeys-lru
```

Kaydedip çıkın (`Ctrl+O`, `Enter`, `Ctrl+X`).

### 1.3 Servisi başlat ve otomatik açılış

```bash
sudo systemctl enable redis-server
sudo systemctl restart redis-server
sudo systemctl status redis-server
```

`active (running)` görmelisiniz.

### 1.4 Yerel test

```bash
redis-cli ping
```

Beklenen yanıt: `PONG`

```bash
redis-cli INFO server | head -5
```

---

## Bölüm 2 — (İsteğe bağlı) Redis şifresi

Tek makinede, sadece `127.0.0.1` bind ile şifresiz kurulum çoğu senaryo için yeterlidir. Ek güvenlik istiyorsanız:

```bash
# Rastgele şifre üret (örnek)
openssl rand -base64 32
```

`redis.conf` içine ekleyin:

```conf
requirepass BURAYA_URETTIGINIZ_SIFRE
```

```bash
sudo systemctl restart redis-server
redis-cli -a 'qxWd8bmjsXTVJ/+tl5yy0cmtfGlBcjzyL5FQTPF9kgM=' ping
```

Şifreyi backend `.env` içinde `REDIS_PASSWORD=` alanına yazacaksınız (Bölüm 3).

---

## Bölüm 3 — Backend `.env` güncelleme

Sunucuda backend dizinine gidin:

```bash
cd /root/backend   # sizin yol farklıysa düzeltin
cp .env .env.backup.upstash-$(date +%Y%m%d)   # geri dönüş için yedek
nano .env
```

### Upstash’ten yerel Redis’e geçiş — örnek değerler

**Eski (Upstash — kaldırın veya yorum satırı yapın):**

```env
# REDIS_HOST=xxxx.upstash.io
# REDIS_PORT=6379
# REDIS_PASSWORD=...
# REDIS_TLS=true
```

**Yeni (yerel):**

```env
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
REDIS_TLS=false
```

Şifre koyduysanız:

```env
REDIS_PASSWORD=urettiginiz_sifre
```

`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` satırları backend tarafından **okunmaz**; isterseniz silebilir veya yorumda bırakabilirsiniz.

Kaydedin. **`.env` dosyasını asla git’e commit etmeyin.**

---

## Bölüm 4 — Backend’i yeniden başlatma

```bash
cd /root/backend
npm run build          # sunucuda dist kullanıyorsanız; zaten güncel dist varsa atlayabilirsiniz
pm2 restart taksim-backend
pm2 logs taksim-backend --lines 50
```

Logda şunları arayın:

```
✅ Redis hazır (ana istemci)
✅ Redis Pub/Sub hazır
```

Hata görürseniz Bölüm 6’ya bakın.

---

## Bölüm 5 — Doğrulama

### 5.1 Health endpoint

Sunucu üzerinden (PORT `.env`’deki değer, genelde `3000`):

```bash
curl -s http://127.0.0.1:3000/health/ready | jq .
```

Beklenen (özet):

```json
{
  "success": true,
  "data": {
    "status": "ready",
    "redis": "ok",
    "database": "ok"
  }
}
```

`redis: "fail"` veya `503` → Bölüm 6.

### 5.2 Redis’te anahtar oluşuyor mu?

Uygulamada bir sürücü çevrimiçi olduktan veya bir istek geldikten sonra:

```bash
redis-cli KEYS 'driver:*' | head
redis-cli KEYS 'ride:*' | head
redis-cli KEYS 'auth:sv:*' | head
```

Boş liste ilk başta normal olabilir; trafik sonrası anahtarlar görünmeli.

### 5.3 Fonksiyonel smoke test (önerilir)

1. Sürücü uygulaması → çevrimiçi ol  
2. Yolcu → taksi çağır  
3. Sürücü → kabul et  
4. Yolcu tarafında sürücü bilgisi ve sürücü tarafında harita/panel makul sürede gelsin  
5. PM2 loglarında `Command timed out` **olmasın**

---

## Bölüm 6 — Sorun giderme

### `Command timed out` devam ediyor

- `.env` içinde `REDIS_TLS=false` ve `REDIS_HOST=127.0.0.1` olduğundan emin olun  
- `pm2 restart` sonrası logda `Redis hazır` var mı  
- `redis-cli ping` sunucuda hızlı mı  

### `ECONNREFUSED` / Redis bağlanamıyor

```bash
sudo systemctl status redis-server
ss -lntp | grep 6379
```

6379 dinlemiyorsa: `sudo systemctl restart redis-server`

### `NOAUTH Authentication required`

`redis.conf`’ta `requirepass` var ama `.env`’de `REDIS_PASSWORD` boş — şifreyi eşleştirin ve `pm2 restart`.

### `WRONGPASS`

`.env` şifresi ile `redis.conf` `requirepass` aynı değil.

### Health `redis: ok` ama eşleştirme garip

Redis sıfırlandıysa devam eden `searching` yolculuklar admin panelden veya stale recovery cron ile düzelir (birkaç dakika). Kritik test için yeni bir çağrı açın.

### Geri dönüş (Upstash)

```bash
cd /root/backend
cp .env.backup.upstash-YYYYMMDD .env
pm2 restart taksim-backend
```

Upstash panelinden **Redis Connect** (REST değil) bilgilerini kullanın: host, port, password, `REDIS_TLS=true`.

---

## Bölüm 7 — Geliştirme makinesi (bilgisayarınız)

Local backend geliştirirken iki seçenek:

**A) Bilgisayarda Redis**

```bash
# macOS (Homebrew)
brew install redis
brew services start redis

# backend/.env
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_TLS=false
```

**B) Upstash’i sadece dev’de tutmak**

Production yerel, geliştirme Upstash olabilir; `.env` dosyaları ortama göre ayrı tutulur.

---

## Bölüm 8 — Bakım notları

| Konu | Not |
|------|-----|
| Yedekleme | Cache olduğu için Redis dump genelde gerekmez |
| Güncelleme | `sudo apt upgrade redis-server` |
| RAM | Yoğun trafikte `maxmemory` + `allkeys-lru` kullanın |
| Firewall | 6379 portunu dış dünyaya **açmayın** |
| Upstash | Geçişten sonra Upstash projesini durdurabilirsiniz (maliyet/limit) |

---

## Hızlı komut özeti (kopyala-yapıştır)

```bash
# Redis kur
sudo apt update && sudo apt install -y redis-server
sudo systemctl enable redis-server && sudo systemctl restart redis-server
redis-cli ping

# .env yedek + düzenle (manuel nano)
cd /root/backend && cp .env .env.backup.upstash-$(date +%Y%m%d)
# REDIS_HOST=127.0.0.1 REDIS_TLS=false REDIS_PASSWORD= boş

pm2 restart taksim-backend
curl -s http://127.0.0.1:3000/health/ready
pm2 logs taksim-backend --lines 30
```

---

## İlgili dosyalar (repo)

| Dosya | Açıklama |
|-------|----------|
| `backend/.env.example` | Örnek `REDIS_*` değişkenleri |
| `backend/src/config/redis.ts` | ioredis bağlantı ayarları (`commandTimeout: 5000` vb.) |
| `backend/src/app.ts` | `GET /health/ready` — Redis ping |
| `CLAUDE.md` | Redis’in eşleştirme ve cache rolü |

---

*Son güncelleme: Mayıs 2026 — Taksim Gelsin backend (Node + ioredis + PM2)*
