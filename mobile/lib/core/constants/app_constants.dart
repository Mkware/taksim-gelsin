/// Uygulama genelinde kullanılan sabitler
///
/// **Üretim derlemesi:** anahtar ve API kökü repoda tutulmaz; derleme sırasında verilir:
/// `flutter build apk --dart-define=SERVER_ORIGIN=https://api.ornek.com --dart-define=GOOGLE_MAPS_API_KEY=...`
class AppConstants {
  AppConstants._();

  /// İlk kurulum tohumu; kalıcı değer `SharedPreferences` (`backendOriginKey`) + admin ekranından gelir.
  /// Yerel Node için: `flutter run --dart-define=SERVER_ORIGIN=http://127.0.0.1:3000`
  /// (Fiziksel cihazda 127.0.0.1 telefonun kendisidir; bağlantı reddedilir.)
  static const String defaultServerOrigin = String.fromEnvironment(
    'SERVER_ORIGIN',
    defaultValue: 'https://api.taksimgelsin.com',
  );

  static const String _serverOrigin = defaultServerOrigin;
  static const String apiBaseUrl = '$_serverOrigin/api/v1';
  static const String socketUrl = _serverOrigin;

  /// Google Maps REST (Places Autocomplete, Directions, Details).
  /// Harita kutucuğu AndroidManifest / AppDelegate anahtarını kullanır; bu sabit yalnızca Dio ile yapılan HTTP çağrıları içindir.
  /// Üretimde farklı kısıtlı anahtar için: `--dart-define=GOOGLE_MAPS_API_KEY=...`
  static const String googleMapsApiKey = String.fromEnvironment(
    'GOOGLE_MAPS_API_KEY',
    defaultValue: 'AIzaSyDHz4lHY7yO0rbZ6MiT7WS1T3FR59pFCR0',
  );


  // Kırıkkale merkez koordinatları
  static const double defaultLat = 39.8468;
  static const double defaultLng = 33.5150;
  static const double defaultZoom = 14.0;

  // Tarife — Kırıkkale ili (taksimetre): açılış 50 TL, min 150 TL, km 50 TL, bekleme 3 TL/dk
  static const double baseFare = 50.0;
  static const double perKmRate = 50.0;
  static const double minimumFare = 150.0;
  /// Hareket yokken bekleme (TL / dakika). Tahmini ücrete dahil değil.
  static const double waitingRatePerMinute = 3.0;

  // Sürücü arama
  static const int driverSearchTimeoutSeconds = 180; // 3 dakika
  /// Gelen yolculuk talebine yanıt süresi (geri sayım / otomatik red) — yedek değer;
  /// canlı değer `GET /config/public` → `driverResponseTimeoutSeconds` (admin).
  static const int driverResponseTimeoutSeconds = 10;
  static const double searchRadiusMeters = 5000;

  /// Yolcu alım noktasını haritadan seçerken mevcut GPS konumundan en fazla bu kadar uzakta olabilir (m).
  static const double pickupEditRadiusMeters = 500;

  // Konum güncelleme
  static const int locationUpdateIntervalMs = 5000; // 5 saniye
  static const double locationDistanceFilter = 10.0; // metre

  // Storage keys
  static const String accessTokenKey = 'access_token';
  static const String refreshTokenKey = 'refresh_token';
  static const String userDataKey = 'user_data';
  static const String backendOriginKey = 'backend_origin_v1';
  /// Müşteri varış arama geçmişi (JSON dizi)
  static const String destinationSearchHistoryKey = 'destination_search_history_v1';

  /// Bildirim tercihleri (JSON nesne)
  static const String notificationPrefsKey = 'notification_prefs_v1';

  /// İlk açılış tanıtım slaytları tamamlandı mı
  static const String onboardingCompletedKey = 'onboarding_completed_v1';

  // —— Sürücü T Coin / operasyon (cüzdan “yükleme talebi” için)
  /// Boş bırakılırsa yükleme akışında yalnızca bilgilendirme gösterilir; doldurun: +905551112233
  static const String driverWalletSupportPhone = '05417122076';
  /// Sunucudaki `RIDE_ACCEPT_FEE_TCOIN` ile aynı tutmaya çalışın (varsayılan 20). UI bilgilendirmesi içindir.
  static const double rideAcceptFeePercentHint = 7;

  /// `MIN_DRIVER_ONLINE_BALANCE_TCOIN` ile sunucu ayarı aynı olmalı (çevrimiçi olmak için min bakiye).
  static const int minDriverOnlineTcoin = 20;
}
