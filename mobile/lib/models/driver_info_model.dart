/// Sürücü bilgisi modeli — yolculuk kabul edildiğinde müşteriye gönderilir
class DriverInfoModel {
  final String id;
  final String fullName;
  final String phone;
  final double rating;
  final String vehiclePlate;
  final String vehicleModel;
  final String vehicleColor;
  final double lat;
  final double lng;

  const DriverInfoModel({
    required this.id,
    required this.fullName,
    required this.phone,
    this.rating = 5.0,
    required this.vehiclePlate,
    required this.vehicleModel,
    required this.vehicleColor,
    this.lat = 0,
    this.lng = 0,
  });

  factory DriverInfoModel.fromJson(Map<String, dynamic> json) {
    return DriverInfoModel(
      id: json['id'] as String? ?? '',
      fullName: json['fullName'] as String? ?? json['full_name'] as String? ?? '',
      phone: json['phone'] as String? ?? '',
      rating: (json['rating'] as num?)?.toDouble() ?? 5.0,
      vehiclePlate: json['vehiclePlate'] as String? ?? json['vehicle_plate'] as String? ?? '',
      vehicleModel: json['vehicleModel'] as String? ?? json['vehicle_model'] as String? ?? '',
      vehicleColor: json['vehicleColor'] as String? ?? json['vehicle_color'] as String? ?? '',
      lat: (json['lat'] as num?)?.toDouble() ?? 0,
      lng: (json['lng'] as num?)?.toDouble() ?? 0,
    );
  }

  DriverInfoModel copyWith({double? lat, double? lng}) {
    return DriverInfoModel(
      id: id,
      fullName: fullName,
      phone: phone,
      rating: rating,
      vehiclePlate: vehiclePlate,
      vehicleModel: vehicleModel,
      vehicleColor: vehicleColor,
      lat: lat ?? this.lat,
      lng: lng ?? this.lng,
    );
  }
}
