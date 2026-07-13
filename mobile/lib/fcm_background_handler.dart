import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

import 'firebase_options.dart';

/// Arka planda / uygulama kapalıyken gelen FCM (data+notification) — ayrı izolatta çalışır.
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  try {
    if (Firebase.apps.isEmpty) {
      await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
    }
  } catch (e, st) {
    if (kDebugMode) {
      debugPrint('FCM arka plan Firebase init: $e\n$st');
    }
  }
  if (kDebugMode) {
    debugPrint('FCM arka plan mesaj: ${message.messageId} data=${message.data}');
  }
}
