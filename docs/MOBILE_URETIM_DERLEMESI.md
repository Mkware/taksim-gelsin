# Flutter — üretim derlemesi

Sırlar ve API kökü **kaynak kodda sabitlenmez**; `dart-define` ile derleme anında verilir.

## Gerekli tanımlar

| Anahtar | Açıklama |
|---------|----------|
| `SERVER_ORIGIN` | Backend kök URL (şema + host + port), örn. `https://api.sizin-domain.com` |
| `GOOGLE_MAPS_API_KEY` | Google Cloud Console’da kısıtlanmış Maps / Places anahtarı |

## Örnek komutlar

```bash
cd mobile

# APK (release)
flutter build apk --release \
  --dart-define=SERVER_ORIGIN=https://API_ADRESINIZ \
  --dart-define=GOOGLE_MAPS_API_KEY=ANAHTARINIZ

# iOS App Store
flutter build ipa --release \
  --dart-define=SERVER_ORIGIN=https://API_ADRESINIZ \
  --dart-define=GOOGLE_MAPS_API_KEY=ANAHTARINIZ
```

Geliştirme sırasında aynı değerlerle çalıştırmak için:

```bash
flutter run --dart-define=SERVER_ORIGIN=http://192.168.1.10:3000 \
  --dart-define=GOOGLE_MAPS_API_KEY=gelistirme_anahtari
```

## Notlar

- `SERVER_ORIGIN` yazımına dikkat edin (typo ile derleme sessizce varsayılan localhost kullanır).
- Uygulama bir kez çalışıp backend adresini kaydettiyse, cihazdaki `backendOriginKey` önceliklidir; yine de release APK’da doğru tohum verilmesi önerilir.
- `GoogleService-Info.plist` / `google-services.json` Firebase için ayrı yapılandırma gerektirir; bu belge yalnızca HTTP + Maps sabitlerini kapsar.
