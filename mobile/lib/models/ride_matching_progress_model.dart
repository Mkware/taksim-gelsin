/// Sunucu `ride:matching_progress` — müşteri arama ekranı.
class RideMatchingProgressModel {
  const RideMatchingProgressModel({
    required this.rideId,
    required this.driversQueued,
    required this.driversAsked,
    required this.driversRemainingInQueue,
    required this.maxWaitSeconds,
    required this.driverResponseTimeoutSeconds,
    required this.searchStartedAt,
    required this.totalWaitSeconds,
    this.currentOfferSecondsLeft,
  });

  final String rideId;
  final int driversQueued;
  final int driversAsked;
  final int driversRemainingInQueue;
  /// Sunucunun son bildirdiği kalan toplam bekleme (sn).
  final int maxWaitSeconds;
  final int? currentOfferSecondsLeft;
  final int driverResponseTimeoutSeconds;
  /// İlk eşleştirme paketi — bar dolumu buna göre ilerler.
  final DateTime searchStartedAt;
  /// Bar için sabit üst süre (ilk paketteki maxWait).
  final int totalWaitSeconds;

  factory RideMatchingProgressModel.fromJson(Map<String, dynamic> json) {
    int i(dynamic v) {
      if (v is int) return v;
      if (v is num) return v.round();
      return 0;
    }

    final maxWait = i(json['maxWaitSeconds']);
    return RideMatchingProgressModel(
      rideId: json['rideId'] as String? ?? '',
      driversQueued: i(json['driversQueued']),
      driversAsked: i(json['driversAsked']),
      driversRemainingInQueue: i(json['driversRemainingInQueue']),
      maxWaitSeconds: maxWait,
      currentOfferSecondsLeft: json['currentOfferSecondsLeft'] != null
          ? i(json['currentOfferSecondsLeft'])
          : null,
      driverResponseTimeoutSeconds: i(json['driverResponseTimeoutSeconds']),
      searchStartedAt: DateTime.now(),
      totalWaitSeconds: maxWait > 0 ? maxWait : 1,
    );
  }

  RideMatchingProgressModel mergeFrom(RideMatchingProgressModel incoming) {
    return RideMatchingProgressModel(
      rideId: incoming.rideId,
      driversQueued: incoming.driversQueued,
      driversAsked: incoming.driversAsked,
      driversRemainingInQueue: incoming.driversRemainingInQueue,
      maxWaitSeconds: incoming.maxWaitSeconds,
      currentOfferSecondsLeft: incoming.currentOfferSecondsLeft,
      driverResponseTimeoutSeconds: incoming.driverResponseTimeoutSeconds,
      searchStartedAt: searchStartedAt,
      totalWaitSeconds: totalWaitSeconds,
    );
  }

  int elapsedSinceSearchStart() {
    return DateTime.now().difference(searchStartedAt).inSeconds;
  }

  /// Kalan toplam bekleme (geri sayım).
  int displayMaxWaitSeconds() {
    return (totalWaitSeconds - elapsedSinceSearchStart()).clamp(0, totalWaitSeconds);
  }

  /// Toplam bekleme penceresinde geçen süre oranı (0→1, yeşil bar dolumu).
  double waitProgressFraction() {
    if (totalWaitSeconds <= 0) return 0;
    return (elapsedSinceSearchStart() / totalWaitSeconds).clamp(0.0, 1.0);
  }
}
