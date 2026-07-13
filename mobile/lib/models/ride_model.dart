/// Yolculuk durumları
enum RideStatus {
  searching,
  accepted,
  arriving,
  inProgress,
  completed,
  cancelled;

  static RideStatus fromString(String value) {
    switch (value) {
      case 'searching':
        return RideStatus.searching;
      case 'accepted':
        return RideStatus.accepted;
      case 'arriving':
        return RideStatus.arriving;
      case 'in_progress':
        return RideStatus.inProgress;
      case 'completed':
        return RideStatus.completed;
      case 'cancelled':
        return RideStatus.cancelled;
      default:
        return RideStatus.searching;
    }
  }

  String toApiString() {
    switch (this) {
      case RideStatus.inProgress:
        return 'in_progress';
      default:
        return name;
    }
  }

  /// Kullanıcıya gösterilecek Türkçe metin
  String get displayText {
    switch (this) {
      case RideStatus.searching:
        return 'Sürücü Aranıyor';
      case RideStatus.accepted:
        return 'Sürücü Kabul Etti';
      case RideStatus.arriving:
        return 'Sürücü Geldi';
      case RideStatus.inProgress:
        return 'Yolculuk Devam Ediyor';
      case RideStatus.completed:
        return 'Yolculuk Tamamlandı';
      case RideStatus.cancelled:
        return 'İptal Edildi';
    }
  }

  /// İstemci sunucudan önde olduğunda (ör. binişteyim) eski snapshot'ın durumu geri almasın diye sıra.
  int get activeFlowProgressRank {
    switch (this) {
      case RideStatus.searching:
        return 0;
      case RideStatus.accepted:
        return 1;
      case RideStatus.arriving:
        return 2;
      case RideStatus.inProgress:
        return 3;
      case RideStatus.completed:
      case RideStatus.cancelled:
        return 100;
    }
  }
}

/// Koordinat modeli
class LatLng {
  final double lat;
  final double lng;

  const LatLng({required this.lat, required this.lng});

  factory LatLng.fromJson(Map<String, dynamic> json) {
    return LatLng(
      lat: (json['lat'] as num).toDouble(),
      lng: (json['lng'] as num).toDouble(),
    );
  }

  Map<String, dynamic> toJson() => {'lat': lat, 'lng': lng};
}

/// Yolculuk modeli
class RideModel {
  final String id;
  final String customerId;
  final String? customerName;
  final String? customerPhone;
  final double? customerRating;
  final String? driverId;
  final String pickupAddress;
  final String dropoffAddress;
  final double? distanceKm;
  final double estimatedPrice;
  final double? finalPrice;
  final RideStatus status;
  final String? requestedAt;
  final String? acceptedAt;
  final String? startedAt;
  final String? completedAt;
  final String? cancelledAt;
  final String? cancelReason;
  final double? pickupLat;
  final double? pickupLng;
  final double? dropoffLat;
  final double? dropoffLng;
  /// Müşteri: sürücüye söylenecek 4 haneli kod (sunucudan)
  final String? pickupVerificationCode;
  /// Sürücü: yolcu kodunu doğruladı mı
  final bool pickupCodeVerified;

  const RideModel({
    required this.id,
    required this.customerId,
    this.customerName,
    this.customerPhone,
    this.customerRating,
    this.driverId,
    required this.pickupAddress,
    required this.dropoffAddress,
    this.distanceKm,
    required this.estimatedPrice,
    this.finalPrice,
    required this.status,
    this.requestedAt,
    this.acceptedAt,
    this.startedAt,
    this.completedAt,
    this.cancelledAt,
    this.cancelReason,
    this.pickupLat,
    this.pickupLng,
    this.dropoffLat,
    this.dropoffLng,
    this.pickupVerificationCode,
    this.pickupCodeVerified = false,
  });

  factory RideModel.fromJson(Map<String, dynamic> json) {
    // Hem snake_case (REST) hem camelCase (socket snapshot) alan isimlerini destekler.
    String? asString(dynamic v) => v is String ? v : (v?.toString());
    double? asDouble(dynamic v) => v is num ? v.toDouble() : null;

    String? normalizePickupPin(dynamic v) {
      if (v == null) return null;
      final s = (v is String ? v : v.toString()).trim();
      if (s.isEmpty) return null;
      return s;
    }

    final Map? customerEmbed =
        (json['customerInfo'] as Map?) ?? (json['customer'] as Map?);

    return RideModel(
      id: (json['id'] ?? '') as String,
      customerId: asString(json['customer_id'] ?? json['customerId']) ?? '',
      customerName: asString(
        json['customer_name'] ??
            json['customerName'] ??
            json['customerInfo']?['fullName'] ??
            customerEmbed?['fullName'] ??
            customerEmbed?['full_name'],
      ),
      customerPhone: asString(
        json['customer_phone'] ??
            json['customerPhone'] ??
            json['customerInfo']?['phone'] ??
            customerEmbed?['phone'],
      ),
      customerRating: asDouble(
        json['customer_rating'] ??
            json['customerRating'] ??
            json['customerInfo']?['rating'] ??
            customerEmbed?['rating'],
      ),
      driverId: asString(json['driver_id'] ?? json['driverId']),
      pickupAddress: asString(json['pickup_address'] ?? json['pickupAddress']) ?? '',
      dropoffAddress: asString(json['dropoff_address'] ?? json['dropoffAddress']) ?? '',
      distanceKm: asDouble(json['distance_km'] ?? json['distanceKm']),
      estimatedPrice: asDouble(json['estimated_price'] ?? json['estimatedPrice']) ?? 0,
      finalPrice: asDouble(json['final_price'] ?? json['finalPrice']),
      status: RideStatus.fromString(
        (json['status'] as String?) ?? 'searching',
      ),
      requestedAt: asString(json['requested_at'] ?? json['requestedAt']),
      acceptedAt: asString(json['accepted_at'] ?? json['acceptedAt']),
      startedAt: asString(json['started_at'] ?? json['startedAt']),
      completedAt: asString(json['completed_at'] ?? json['completedAt']),
      cancelledAt: asString(json['cancelled_at'] ?? json['cancelledAt']),
      cancelReason: asString(json['cancel_reason'] ?? json['cancelReason']),
      pickupLat: asDouble(json['pickup_lat'] ?? json['pickupLat']),
      pickupLng: asDouble(json['pickup_lng'] ?? json['pickupLng']),
      dropoffLat: asDouble(json['dropoff_lat'] ?? json['dropoffLat']),
      dropoffLng: asDouble(json['dropoff_lng'] ?? json['dropoffLng']),
      pickupVerificationCode: normalizePickupPin(
        json['pickup_verification_code'] ??
            json['pickupVerificationCode'] ??
            json['verification_code'] ??
            json['verificationCode'] ??
            json['pickup_code'],
      ),
      pickupCodeVerified: json['pickup_code_verified'] == true ||
          json['pickupCodeVerified'] == true,
    );
  }

  /// Biniş noktası koordinatları (opsiyonel)
  LatLng? get pickupCoord =>
      (pickupLat != null && pickupLng != null) ? LatLng(lat: pickupLat!, lng: pickupLng!) : null;

  /// İniş noktası koordinatları (opsiyonel)
  LatLng? get dropoffCoord =>
      (dropoffLat != null && dropoffLng != null) ? LatLng(lat: dropoffLat!, lng: dropoffLng!) : null;

  bool get isActive =>
      status == RideStatus.searching ||
      status == RideStatus.accepted ||
      status == RideStatus.arriving ||
      status == RideStatus.inProgress;

  /// Gösterilecek ücret (final varsa onu, yoksa tahmini)
  double get displayPrice => finalPrice ?? estimatedPrice;

  /// Kesin taksimetre tutarı girildiyse true (yolcuda yaklaşık etiketi göstermemek için).
  bool get hasConfirmedFare => finalPrice != null;

  /// Müşteri arayüzü: kesin ücret yoksa yaklaşık işareti (≈) ile tahmini tutar.
  String get customerFareLabel =>
      hasConfirmedFare
          ? '${finalPrice!.toStringAsFixed(0)} ₺'
          : '≈ ${displayPrice.toStringAsFixed(0)} ₺';

  RideModel copyWith({
    String? id,
    RideStatus? status,
    String? driverId,
    String? customerName,
    String? customerPhone,
    double? customerRating,
    double? finalPrice,
    String? startedAt,
    String? completedAt,
    double? distanceKm,
    double? pickupLat,
    double? pickupLng,
    double? dropoffLat,
    double? dropoffLng,
    String? pickupVerificationCode,
    bool? pickupCodeVerified,
  }) {
    return RideModel(
      id: id ?? this.id,
      customerId: customerId,
      customerName: customerName ?? this.customerName,
      customerPhone: customerPhone ?? this.customerPhone,
      customerRating: customerRating ?? this.customerRating,
      driverId: driverId ?? this.driverId,
      pickupAddress: pickupAddress,
      dropoffAddress: dropoffAddress,
      distanceKm: distanceKm ?? this.distanceKm,
      estimatedPrice: estimatedPrice,
      finalPrice: finalPrice ?? this.finalPrice,
      status: status ?? this.status,
      requestedAt: requestedAt,
      acceptedAt: acceptedAt,
      startedAt: startedAt ?? this.startedAt,
      completedAt: completedAt ?? this.completedAt,
      cancelledAt: cancelledAt,
      cancelReason: cancelReason,
      pickupLat: pickupLat ?? this.pickupLat,
      pickupLng: pickupLng ?? this.pickupLng,
      dropoffLat: dropoffLat ?? this.dropoffLat,
      dropoffLng: dropoffLng ?? this.dropoffLng,
      pickupVerificationCode:
          pickupVerificationCode ?? this.pickupVerificationCode,
      pickupCodeVerified: pickupCodeVerified ?? this.pickupCodeVerified,
    );
  }
}
