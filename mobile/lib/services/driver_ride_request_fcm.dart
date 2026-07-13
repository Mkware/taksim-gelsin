import 'dart:async';

import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/router/app_router.dart';
import '../providers/providers.dart';

/// FCM `ride_new_request` → sürücü kabul dialog verisi (socket yokken tamamlayıcı).
class DriverRideRequestFcm {
  DriverRideRequestFcm._();

  static StreamSubscription<RemoteMessage>? _foregroundSub;
  static StreamSubscription<RemoteMessage>? _openedSub;
  static bool _installed = false;

  /// Sürücü ana ekranı mount olunca bir kez kurulur.
  static void install(WidgetRef ref) {
    if (_installed) return;
    _installed = true;

    _foregroundSub?.cancel();
    _foregroundSub = FirebaseMessaging.onMessage.listen((msg) {
      _handleMessage(ref, msg);
    });

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
    _foregroundSub?.cancel();
    _foregroundSub = null;
    _openedSub?.cancel();
    _openedSub = null;
    _installed = false;
  }

  static void _handleMessage(WidgetRef ref, RemoteMessage message) {
    final data = message.data;
    if (data['type'] != 'ride_new_request') return;

    final user = ref.read(currentUserProvider);
    if (user == null || !user.isDriver) return;

    final target = data['targetDriverId'] ?? '';
    if (target.isNotEmpty && target != user.id) return;

    final payload = rideRequestMapFromFcm(data);
    if ((payload['rideId'] as String? ?? '').isEmpty) return;

    if (kDebugMode) {
      debugPrint('FCM ride_new_request → dialog kuyruğu ride=${payload['rideId']}');
    }

    try {
      ref.read(appRouterProvider).go('/driver');
    } catch (e) {
      if (kDebugMode) debugPrint('FCM navigate /driver: $e');
    }

    ref.read(driverPendingFcmRideRequestProvider.notifier).state = payload;
  }

  /// FCM data (tüm değerler string) → [RideRequestDialog] / socket ile uyumlu map.
  static Map<String, dynamic> rideRequestMapFromFcm(Map<String, dynamic> data) {
    double? parseD(dynamic v) {
      if (v == null) return null;
      return double.tryParse(v.toString());
    }

    int? parseI(dynamic v) {
      if (v == null) return null;
      return int.tryParse(v.toString());
    }

    final pickupLat = parseD(data['pickupLat']);
    final pickupLng = parseD(data['pickupLng']);
    final dropoffLat = parseD(data['dropoffLat']);
    final dropoffLng = parseD(data['dropoffLng']);
    final price = parseD(data['estimatedPrice']) ?? 0;

    return {
      'rideId': data['rideId']?.toString() ?? '',
      'targetDriverId': data['targetDriverId']?.toString() ?? '',
      'pickupAddress': data['pickupAddress']?.toString() ?? '',
      'dropoffAddress': data['dropoffAddress']?.toString() ?? '',
      'price': price,
      'estimatedPrice': price,
      'distanceKm': parseD(data['distanceKm']) ?? 0,
      if (parseI(data['responseDeadlineMs']) != null)
        'responseDeadlineMs': parseI(data['responseDeadlineMs']),
      if (parseI(data['responseTimeoutSeconds']) != null)
        'responseTimeoutSeconds': parseI(data['responseTimeoutSeconds']),
      if (parseD(data['acceptFeeTcoin']) != null)
        'acceptFeeTcoin': parseD(data['acceptFeeTcoin']),
      if (parseD(data['balanceTcoin']) != null)
        'balanceTcoin': parseD(data['balanceTcoin']),
      'customerInfo': {
        'fullName': data['customerName']?.toString() ?? 'Müşteri',
        'rating': parseD(data['customerRating']) ?? 5,
      },
      if (pickupLat != null && pickupLng != null)
        'pickup': {'lat': pickupLat, 'lng': pickupLng},
      if (dropoffLat != null && dropoffLng != null)
        'dropoff': {'lat': dropoffLat, 'lng': dropoffLng},
      'pickupMasked': data['pickupMasked'] == '1' || data['pickupMasked'] == true,
      if (parseD(data['pickupUncertaintyM']) != null)
        'pickupUncertaintyM': parseD(data['pickupUncertaintyM']),
    };
  }
}
