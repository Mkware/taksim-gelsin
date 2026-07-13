import 'package:flutter/services.dart';
import 'package:flutter_ringtone_player/flutter_ringtone_player.dart';

/// Yolculuk eşleştiğinde kısa bildirim sesi + titreşim.
class RideMatchSound {
  RideMatchSound._();

  /// Push ile aynı WAV (FCM/APNs bundle’ı ayrı; burada Flutter asset üzerinden çalınır).
  static const String _matchAsset = 'assets/sounds/taksim_gelsin.wav';

  /// Sürücüye gelen çağrı — özel marka sesi.
  static Future<void> playMatchAlert() async {
    try {
      await HapticFeedback.mediumImpact();
      await FlutterRingtonePlayer().play(fromAsset: _matchAsset, asAlarm: false);
    } catch (_) {
      try {
        await SystemSound.play(SystemSoundType.alert);
      } catch (_) {}
    }
  }

  /// Müşteri (sürücü kabul vb.) — işletim sistemi varsayılan bildirim sesi.
  static Future<void> playDefaultNotificationAlert() async {
    try {
      await HapticFeedback.mediumImpact();
      await FlutterRingtonePlayer().playNotification();
    } catch (_) {
      try {
        await SystemSound.play(SystemSoundType.alert);
      } catch (_) {}
    }
  }
}
