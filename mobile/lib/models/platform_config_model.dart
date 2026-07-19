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
    required this.minSupportedAppVersion,
  });

  final double rideAcceptFeePercent;
  final int minDriverOnlineBalanceTcoin;
  final double pickupMaskRadiusM;
  final int matchingRoadMatrixMaxDrivers;
  final int drivingDistanceCacheTtlSec;
  /// Sürücü çağrı yanıt penceresi (sn) — sunucu `platform_settings`.
  final int driverResponseTimeoutSeconds;

  /// Desteklenen en düşük uygulama sürümü ("1.2.3"). '0.0.0' = zorunlu güncelleme kapalı.
  final String minSupportedAppVersion;

  /// [current] ("1.0.2" veya "1.0.2+10") bu yapılandırmanın istediği minimumun
  /// altında mı? Sürümlerden biri çözümlenemezse false (kilitleme yerine açık kal).
  bool requiresUpdate(String current) {
    final min = _parseVersion(minSupportedAppVersion);
    final cur = _parseVersion(current);
    if (min == null || cur == null) return false;
    for (var i = 0; i < 3; i++) {
      if (cur[i] < min[i]) return true;
      if (cur[i] > min[i]) return false;
    }
    return false;
  }

  static List<int>? _parseVersion(String v) {
    final core = v.split('+').first.trim();
    final parts = core.split('.');
    if (parts.length != 3) return null;
    final nums = <int>[];
    for (final p in parts) {
      final n = int.tryParse(p);
      if (n == null) return null;
      nums.add(n);
    }
    return nums;
  }

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
      minSupportedAppVersion:
          json['minSupportedAppVersion'] is String ? json['minSupportedAppVersion'] as String : '0.0.0',
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
      minSupportedAppVersion: '0.0.0',
    );
  }
}
