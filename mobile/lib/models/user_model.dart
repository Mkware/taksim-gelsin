/// Kullanıcı modeli
class UserModel {
  final String id;
  final String phone;
  final String fullName;
  final String? avatarUrl;
  final String role; // 'customer' | 'driver'
  final bool isAdmin;
  final double rating;
  final int ratingCount;
  /// Sunucudan: tamamlanan yolculuk sayısı
  final int completedRides;
  /// Sürücü eşleşme performansı (0..1). Sürücü değilse/null olabilir.
  final double? acceptanceRate;
  final double? rejectionRate;
  final int? rejectedPer100;
  final String? createdAt;
  /// Sürücü T Coin bakiyesi (`drivers.balance`). Müşteri hesabında anlamı yok.
  final double? balanceTcoin;

  const UserModel({
    required this.id,
    required this.phone,
    required this.fullName,
    this.avatarUrl,
    required this.role,
    this.isAdmin = false,
    this.rating = 5.0,
    this.ratingCount = 0,
    this.completedRides = 0,
    this.acceptanceRate,
    this.rejectionRate,
    this.rejectedPer100,
    this.createdAt,
    this.balanceTcoin,
  });

  factory UserModel.fromJson(Map<String, dynamic> json) {
    String _asString(dynamic v, {String fallback = ''}) {
      if (v == null) return fallback;
      if (v is String) return v;
      return v.toString();
    }

    int _asInt(dynamic v, {int fallback = 0}) {
      if (v == null) return fallback;
      if (v is int) return v;
      if (v is num) return v.toInt();
      return int.tryParse(v.toString()) ?? fallback;
    }

    double _asDouble(dynamic v, {double fallback = 0}) {
      if (v == null) return fallback;
      if (v is double) return v;
      if (v is num) return v.toDouble();
      return double.tryParse(v.toString()) ?? fallback;
    }

    double? _asDoubleOpt(dynamic v) {
      if (v == null) return null;
      if (v is double) return v;
      if (v is num) return v.toDouble();
      return double.tryParse(v.toString());
    }

    return UserModel(
      id: _asString(json['id']),
      phone: _asString(json['phone']),
      fullName: _asString(json['full_name'] ?? json['fullName']),
      avatarUrl: json['avatar_url'] as String?,
      role: _asString(json['role']),
      isAdmin: (json['is_admin'] ?? json['isAdmin']) == true,
      rating: _asDouble(json['rating'], fallback: 5.0),
      ratingCount: _asInt(json['rating_count'] ?? json['ratingCount']),
      completedRides:
          _asInt(json['completed_rides'] ?? json['completedRides']),
      acceptanceRate: json['acceptance_rate'] != null
          ? _asDouble(json['acceptance_rate'] ?? json['acceptanceRate'])
          : null,
      rejectionRate: json['rejection_rate'] != null
          ? _asDouble(json['rejection_rate'] ?? json['rejectionRate'])
          : null,
      rejectedPer100: json['rejected_per_100'] != null
          ? _asInt(json['rejected_per_100'] ?? json['rejectedPer100'])
          : null,
      createdAt: (json['created_at'] ?? json['createdAt']) as String?,
      balanceTcoin: _asDoubleOpt(json['balance_tcoin'] ?? json['balanceTcoin']),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'phone': phone,
      'full_name': fullName,
      'avatar_url': avatarUrl,
      'role': role,
      'is_admin': isAdmin,
      'rating': rating,
      'rating_count': ratingCount,
      'completed_rides': completedRides,
      'acceptance_rate': acceptanceRate,
      'rejection_rate': rejectionRate,
      'rejected_per_100': rejectedPer100,
      'created_at': createdAt,
      'balance_tcoin': balanceTcoin,
    };
  }

  bool get isDriver => role == 'driver';
  bool get isCustomer => role == 'customer';

  UserModel copyWith({
    String? fullName,
    String? avatarUrl,
    double? rating,
    int? ratingCount,
    int? completedRides,
    double? acceptanceRate,
    double? rejectionRate,
    int? rejectedPer100,
    double? balanceTcoin,
  }) {
    return UserModel(
      id: id,
      phone: phone,
      fullName: fullName ?? this.fullName,
      avatarUrl: avatarUrl ?? this.avatarUrl,
      role: role,
      isAdmin: isAdmin,
      rating: rating ?? this.rating,
      ratingCount: ratingCount ?? this.ratingCount,
      completedRides: completedRides ?? this.completedRides,
      acceptanceRate: acceptanceRate ?? this.acceptanceRate,
      rejectionRate: rejectionRate ?? this.rejectionRate,
      rejectedPer100: rejectedPer100 ?? this.rejectedPer100,
      createdAt: createdAt,
      balanceTcoin: balanceTcoin ?? this.balanceTcoin,
    );
  }
}
