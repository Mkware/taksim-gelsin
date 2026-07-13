# Taksim Gelsin — Kurumsal web sitesi

Statik kurumsal site (Astro + Tailwind). cPanel `public_html` üzerine yüklenmek üzere tasarlanmıştır.

## Komutlar

```bash
cd web
npm install
npm run dev      # http://localhost:4321
npm run build    # çıktı: dist/
npm run preview  # build sonrası önizleme
```

## Yayın öncesi

1. `src/config/site.ts` — e-posta, telefon, mağaza linkleri
2. `astro.config.mjs` — `site` URL’si (veya `PUBLIC_SITE_URL=https://alanadiniz.com npm run build`)
3. `public/robots.txt` — sitemap URL’si

## cPanel yükleme

1. Yerelde `npm run build`
2. `dist/` içindeki **tüm dosyaları** (klasörün kendisini değil) hosting `public_html/` içine yükleyin
3. cPanel → SSL/TLS → Let’s Encrypt ile HTTPS açın
4. `.htaccess` dosyası `public/` altından `dist/` ile birlikte kopyalanır

## Sayfalar

| URL | Açıklama |
|-----|----------|
| `/` | Ana sayfa |
| `/kvkk` | KVKK aydınlatma |
| `/gizlilik` | Gizlilik politikası |
| `/kullanim-kosullari` | Kullanım koşulları |
| `/iletisim` | İletişim |
| `/surucu` | Sürücü bilgisi |
