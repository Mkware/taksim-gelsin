import '../core/constants/app_constants.dart';

/// Sunucu `GET /config/public` yanıtı — admin paneli ile güncellenir.
class PlatformConfigData {
  const PlatformConfigData({
    required this.rideAcceptFeePercent,
    required this.minDriverOnlineBalanceTcoin,
    required this.pickupMaskRadiusM,
    required this.matchingRoadMatrixMaxDrivers,
    required this.drivingDistanceCacheTtlSec,
    required this.driverResponseTimeoutSeconds,
  });

  final double rideAcceptFeePercent;
  final int minDriverOnlineBalanceTcoin;
  final double pickupMaskRadiusM;
  final int matchingRoadMatrixMaxDrivers;
  final int drivingDistanceCacheTtlSec;
  /// Sürücü çağrı yanıt penceresi (sn) — sunucu `platform_settings`.
  final int driverResponseTimeoutSeconds;

  static int _i(dynamic v) {
    if (v is int) return v;
    if (v is num) return v.round();
    return AppConstants.minDriverOnlineTcoin;
  }

  static int _intOr(dynamic v, int fallback) {
    if (v is int) return v;
    if (v is num) return v.round();
    return fallback;
  }

  static double _d(dynamic v, double fallback) {
    if (v is num) return v.toDouble();
    return fallback;
  }

  factory PlatformConfigData.fromJson(Map<String, dynamic> json) {
    return PlatformConfigData(
      rideAcceptFeePercent: _d(
        json['rideAcceptFeePercent'],
        AppConstants.rideAcceptFeePercentHint,
      ),
      minDriverOnlineBalanceTcoin: _i(json['minDriverOnlineBalanceTcoin']),
      pickupMaskRadiusM: _d(json['pickupMaskRadiusM'], 300),
      matchingRoadMatrixMaxDrivers: _i(json['matchingRoadMatrixMaxDrivers']),
      drivingDistanceCacheTtlSec: _i(json['drivingDistanceCacheTtlSec']),
      driverResponseTimeoutSeconds: _intOr(
        json['driverResponseTimeoutSeconds'],
        AppConstants.driverResponseTimeoutSeconds,
      ),
    );
  }

  factory PlatformConfigData.fallback() {
    return PlatformConfigData(
      rideAcceptFeePercent: AppConstants.rideAcceptFeePercentHint,
      minDriverOnlineBalanceTcoin: AppConstants.minDriverOnlineTcoin,
      pickupMaskRadiusM: 300,
      matchingRoadMatrixMaxDrivers: 10,
      drivingDistanceCacheTtlSec: 600,
      driverResponseTimeoutSeconds: AppConstants.driverResponseTimeoutSeconds,
    );
  }
}
