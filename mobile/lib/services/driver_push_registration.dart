import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart'
    show TargetPlatform, debugPrint, defaultTargetPlatform, kDebugMode, kIsWeb;
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../firebase_options.dart';
import '../providers/providers.dart';

/// FCM token kaydı — sürücü (çağrı) ve yolcu (ör. sürücü binişe geldi) push bildirimleri.
class DriverPushRegistration {
  DriverPushRegistration._();

  static String? _lastToken;
  static StreamSubscription<String>? _tokenRefreshSub;
  static bool _registrationInflight = false;

  /// iOS: APNs jetonu gelmeden `getToken()` hataya düşer.
  /// Dönüş: APNs token hazırsa true, hazır değilse false.
  static Future<bool> _waitForApnsIfIos(FirebaseMessaging messaging) async {
    if (defaultTargetPlatform != TargetPlatform.iOS) return true;
    for (var i = 0; i < 50; i++) {
      final apns = await messaging.getAPNSToken();
      if (apns != null && apns.isNotEmpty) return true;
      await Future<void>.delayed(const Duration(milliseconds: 120));
    }
    if (kDebugMode) {
      debugPrint(
        'FCM: APNs jetonu zaman aşımı (simülatörde sınırlı olabilir; '
        'gerçek cihaz + Xcode Push Notifications + Firebase APNs anahtarı kontrol edin).',
      );
    }
    return false;
  }

  static String _platformLabel() {
    if (kIsWeb) return 'web';
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return 'android';
      case TargetPlatform.iOS:
        return 'ios';
      default:
        return 'web';
    }
  }

  /// Sürücü ana ekranından çağırın; Firebase yoksa sessizce çıkılır.
  static Future<void> ensureRegisteredForDriver(WidgetRef ref) async {
    final user = ref.read(currentUserProvider);
    if (user == null || !user.isDriver || kIsWeb) return;
    await _registerFcmIfNeeded(ref);
  }

  /// Yolcu ana ekranı — sürücü binişe geldi push’u için token gerekir.
  static Future<void> ensureRegisteredForCustomer(WidgetRef ref) async {
    final user = ref.read(currentUserProvider);
    if (user == null || !user.isCustomer || kIsWeb) return;
    await _registerFcmIfNeeded(ref);
  }

  static Future<void> _registerFcmIfNeeded(WidgetRef ref) async {
    if (_registrationInflight) return;
    _registrationInflight = true;
    try {
      try {
        if (Firebase.apps.isEmpty) {
          await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
        }
      } catch (e) {
        if (kDebugMode) {
          debugPrint(
            'FCM: Firebase başlatılamadı (flutterfire configure / google-services gerekir): $e',
          );
        }
        return;
      }

      final messaging = FirebaseMessaging.instance;

      await messaging.setForegroundNotificationPresentationOptions(
        alert: true,
        badge: true,
        sound: true,
      );

      await messaging.requestPermission(
        alert: true,
        badge: true,
        sound: true,
        provisional: false,
      );
      if (kDebugMode) {
        final settings = await messaging.getNotificationSettings();
        debugPrint('FCM: izin durumu = ${settings.authorizationStatus.name}');
      }

      final apnsReady = await _waitForApnsIfIos(messaging);
      if (!apnsReady) {
        // iOS simulator veya APNs henüz hazır değilken hata loglarına düşmeyelim.
        return;
      }
      if (defaultTargetPlatform == TargetPlatform.iOS && kDebugMode) {
        final apns = await messaging.getAPNSToken();
        final masked = (apns == null || apns.length < 16)
            ? apns
            : '${apns.substring(0, 8)}...${apns.substring(apns.length - 8)}';
        debugPrint('FCM: APNs token hazır = $masked');
      }

      final token = await messaging.getToken();
      if (token == null || token.isEmpty) return;
      if (kDebugMode) {
        final masked = token.length < 16
            ? token
            : '${token.substring(0, 8)}...${token.substring(token.length - 8)}';
        debugPrint('FCM: FCM token = $masked');
      }

      final api = ref.read(apiServiceProvider);
      await api.registerPushToken(token: token, platform: _platformLabel());
      if (kDebugMode) debugPrint('FCM: token backend kaydı başarılı.');
      _lastToken = token;

      _tokenRefreshSub ??= FirebaseMessaging.instance.onTokenRefresh.listen(
        (newToken) async {
          try {
            await api.registerPushToken(token: newToken, platform: _platformLabel());
            _lastToken = newToken;
          } catch (_) {}
        },
      );
    } catch (e) {
      if (kDebugMode) debugPrint('FCM kayıt hatası: $e');
    } finally {
      _registrationInflight = false;
    }
  }

  /// Çıkışta sunucudaki token ve yerel FCM kaydını temizler.
  static Future<void> unregister(Ref ref) async {
    try {
      final api = ref.read(apiServiceProvider);
      final t = _lastToken;
      if (t != null) {
        try {
          await api.deletePushToken(token: t);
        } catch (_) {}
      }
      if (Firebase.apps.isNotEmpty) {
        await FirebaseMessaging.instance.deleteToken();
      }
    } catch (_) {}
    _lastToken = null;
    await _tokenRefreshSub?.cancel();
    _tokenRefreshSub = null;
  }
}
