import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/driver_info_model.dart';
import '../models/ride_model.dart';
import '../providers/providers.dart';

/// Oturum açıkken aktif yolculuğu socket + REST ile provider'lara yükler.
/// Splash'ta soket bağlanıp `ride:snapshot` gönderildiğinde müşteri ekranı henüz
/// mount olmamış olabilir; dinleyiciler burada kayıtlıdır.
class RideSessionSync {
  RideSessionSync(this._ref);

  final Ref _ref;

  StreamSubscription? _snapshotSub;
  StreamSubscription? _connectedSub;
  bool _apiRestoreInFlight = false;
  String? _customerDriverRestoreRideId;

  void attach() {
    detach();
    final socket = _ref.read(socketServiceProvider);

    _connectedSub = socket.onConnected.listen((_) {
      unawaited(_restoreFromApi());
    });

    _snapshotSub = socket.onRideSnapshot.listen((data) {
      final user = _ref.read(currentUserProvider);
      if (user == null) return;
      if (user.isDriver) {
        applyDriverRideSnapshot(data);
      } else {
        applyCustomerRideSnapshot(data);
      }
    });

    if (socket.isConnected) {
      unawaited(_restoreFromApi());
    }
  }

  void detach() {
    _snapshotSub?.cancel();
    _connectedSub?.cancel();
    _snapshotSub = null;
    _connectedSub = null;
    _customerDriverRestoreRideId = null;
    _apiRestoreInFlight = false;
  }

  Future<void> _restoreFromApi() async {
    final user = _ref.read(currentUserProvider);
    if (user == null) return;
    if (user.isDriver) {
      await restoreDriverActiveRideFromApi();
    } else {
      await restoreCustomerActiveRideFromApi();
    }
  }

  /// Müşteri: sürücü atanmış aktif yolculukta `assignedDriver` dolu mu?
  static bool customerSessionComplete(RideModel? ride, DriverInfoModel? driver) {
    if (ride == null || !ride.isActive) return true;
    if (ride.id.startsWith('temp_')) return false;
    if (ride.status == RideStatus.searching) return true;
    final driverId = ride.driverId?.trim() ?? '';
    if (driverId.isEmpty) return false;
    if (driver == null || driver.id.isEmpty) return false;
    if (driver.id != driverId) return false;
    // Konum yayınından oluşturulan geçici sürücü kaydı (yalnızca id + lat/lng)
    if (driver.fullName.trim().isEmpty && driver.vehiclePlate.trim().isEmpty) {
      return false;
    }
    return true;
  }

  /// Sürücü: aktif yolculuk state'te ve geçerli id ile mi?
  static bool driverSessionComplete(RideModel? ride) {
    if (ride == null || !ride.isActive) return true;
    return !ride.id.startsWith('temp_');
  }

  /// Snapshot → provider (harita UI müşteri ekranında ayrı senkronize edilir).
  void applyCustomerRideSnapshot(Map<String, dynamic> data) {
    final rideMap = Map<String, dynamic>.from((data['ride'] as Map?) ?? {});
    if (rideMap.isEmpty) return;

    Map? driverMap = data['driver'] as Map?;
    driverMap ??= rideMap['driver'] as Map?;
    rideMap.remove('driver');

    final ride = RideModel.fromJson(rideMap);
    if (!ride.isActive) return;

    _ref.read(activeRideProvider.notifier).setRide(ride);

    if (driverMap != null) {
      final driver = DriverInfoModel.fromJson(Map<String, dynamic>.from(driverMap));
      _ref.read(assignedDriverProvider.notifier).setDriver(driver);
      _customerDriverRestoreRideId = null;
    } else {
      final driverId = ride.driverId?.trim() ?? '';
      final assigned = _ref.read(assignedDriverProvider);
      if (driverId.isNotEmpty &&
          (assigned == null || assigned.id != driverId) &&
          _customerDriverRestoreRideId != ride.id) {
        _customerDriverRestoreRideId = ride.id;
        unawaited(restoreCustomerActiveRideFromApi());
      }
    }
  }

  void applyDriverRideSnapshot(Map<String, dynamic> data) {
    final rideMap = Map<String, dynamic>.from((data['ride'] as Map?) ?? {});
    if (rideMap.isEmpty) return;

    final cust = data['customer'] as Map?;
    if (cust != null) {
      rideMap['customer'] = Map<String, dynamic>.from(cust);
    }
    rideMap.remove('driver');

    final ride = RideModel.fromJson(rideMap);
    if (!ride.isActive) return;

    _ref.read(activeRideProvider.notifier).setRide(ride);
    _ref.read(pendingRideRequestProvider.notifier).state = null;
  }

  Future<void> restoreCustomerActiveRideFromApi() async {
    if (_apiRestoreInFlight) return;
    final existing = _ref.read(activeRideProvider);
    final assigned = _ref.read(assignedDriverProvider);
    if (customerSessionComplete(existing, assigned)) return;

    _apiRestoreInFlight = true;
    try {
      final api = _ref.read(apiServiceProvider);
      final res = await api.getActiveRide();
      final body = res.data;
      if (body is! Map) return;
      final payload = body['data'] ?? body['ride'];
      if (payload == null || payload is! Map) return;

      final data = Map<String, dynamic>.from(payload);
      final rideId = data['id']?.toString() ?? '';
      if (rideId.isEmpty) return;

      final driverRaw = data.remove('driver');
      data.remove('customer');
      final snapshot = <String, dynamic>{'ride': data};
      if (driverRaw is Map) {
        snapshot['driver'] = driverRaw;
      }
      applyCustomerRideSnapshot(snapshot);
    } catch (_) {
      // socket snapshot / reconnect yine dener
    } finally {
      _apiRestoreInFlight = false;
    }
  }

  Future<void> restoreDriverActiveRideFromApi() async {
    if (_apiRestoreInFlight) return;
    if (driverSessionComplete(_ref.read(activeRideProvider))) return;

    _apiRestoreInFlight = true;
    try {
      final api = _ref.read(apiServiceProvider);
      final res = await api.getActiveRide();
      final body = res.data;
      if (body is! Map) return;
      final data = body['data'];
      if (data is! Map) return;
      applyDriverRideSnapshot({'ride': data});
    } catch (_) {
      // sessiz
    } finally {
      _apiRestoreInFlight = false;
    }
  }
}

final rideSessionSyncProvider = Provider<RideSessionSync>((ref) {
  final sync = RideSessionSync(ref);
  ref.onDispose(() => sync.detach());
  return sync;
});
