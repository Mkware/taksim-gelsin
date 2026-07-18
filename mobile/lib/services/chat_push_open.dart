import 'dart:async';

import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/router/app_router.dart';
import '../providers/providers.dart';

/// FCM `new_message` bildirimine tıklanınca ilgili yolculuğun sohbetini açar.
/// Rol ekranına yönlendirir ve [pendingChatOpenRideIdProvider]'ı set eder —
/// aktif yolculuk paneli (sürücü/müşteri) bunu dinleyip sheet'i gösterir.
class ChatPushOpen {
  ChatPushOpen._();

  static StreamSubscription<RemoteMessage>? _openedSub;
  static bool _installed = false;

  /// Ana ekran (müşteri veya sürücü) mount olunca bir kez kurulur.
  static void install(WidgetRef ref) {
    if (_installed) return;
    _installed = true;

    _openedSub?.cancel();
    _openedSub = FirebaseMessaging.onMessageOpenedApp.listen((msg) {
      _handleMessage(ref, msg);
    });

    unawaited(
      FirebaseMessaging.instance.getInitialMessage().then((msg) {
        if (msg != null) _handleMessage(ref, msg);
      }),
    );
  }

  static void dispose() {
    _openedSub?.cancel();
    _openedSub = null;
    _installed = false;
  }

  static void _handleMessage(WidgetRef ref, RemoteMessage message) {
    if (message.data['type'] != 'new_message') return;
    final rideId = message.data['rideId']?.toString() ?? '';
    if (rideId.isEmpty) return;

    final user = ref.read(currentUserProvider);
    if (user == null) return;

    if (kDebugMode) {
      debugPrint('FCM new_message → sohbet açılacak ride=$rideId');
    }

    try {
      ref.read(appRouterProvider).go(user.isDriver ? '/driver' : '/customer');
    } catch (e) {
      if (kDebugMode) debugPrint('FCM new_message navigate: $e');
    }

    ref.read(pendingChatOpenRideIdProvider.notifier).state = rideId;
  }
}
