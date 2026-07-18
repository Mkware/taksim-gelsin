/// Müşterinin favori sürücüsü — GET /users/me/favorite-drivers yanıtı.
class FavoriteDriverModel {
  final String driverId;
  final String fullName;
  final double rating;
  final String vehiclePlate;
  final String vehicleModel;
  final String vehicleColor;
  final bool isOnline;
  final int? etaSeconds;

  const FavoriteDriverModel({
    required this.driverId,
    required this.fullName,
    required this.rating,
    required this.vehiclePlate,
    required this.vehicleModel,
    required this.vehicleColor,
    required this.isOnline,
    this.etaSeconds,
  });

  factory FavoriteDriverModel.fromJson(Map<String, dynamic> json) {
    final eta = json['eta_seconds'];
    return FavoriteDriverModel(
      driverId: json['driver_id'] as String? ?? '',
      fullName: json['full_name'] as String? ?? '',
      rating: (json['rating'] as num?)?.toDouble() ?? 5.0,
      vehiclePlate: json['vehicle_plate'] as String? ?? '',
      vehicleModel: json['vehicle_model'] as String? ?? '',
      vehicleColor: json['vehicle_color'] as String? ?? '',
      isOnline: json['is_online'] as bool? ?? false,
      etaSeconds: eta is num ? eta.toInt() : null,
    );
  }
}
