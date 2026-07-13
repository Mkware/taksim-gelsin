import 'dart:async';

import 'package:dio/dio.dart';
import '../core/constants/app_constants.dart';
import 'storage_service.dart';

/// HTTP API Servisi — Dio ile backend iletişimi
/// Otomatik token ekleme ve refresh token yenileme interceptor'ları içerir
class ApiService {
  late final Dio _dio;
  final StorageService _storage;
  String _serverOrigin;

  /// HTTP ile access token yenilendiğinde socket'in aynı JWT ile yeniden bağlanması için
  final void Function(String accessToken)? onAccessTokenRefreshed;

  /// Refresh token geçersiz / süresi dolmuş (401) — yerel oturumu sonlandır
  final Future<void> Function()? onRefreshFailed;

  /// Başka cihazdan giriş (SESSION_REPLACED) — oturumu kapat + kullanıcıya mesaj
  final Future<void> Function()? onSessionReplaced;

  /// Eşzamanlı 401'lerde tek bir refresh isteği koşmasını sağlayan gate.
  Completer<bool>? _refreshInflight;

  ApiService(this._storage, {
    this.onAccessTokenRefreshed,
    this.onRefreshFailed,
    this.onSessionReplaced,
    String? initialServerOrigin,
  }) : _serverOrigin = initialServerOrigin ?? AppConstants.defaultServerOrigin {
    _dio = Dio(BaseOptions(
      baseUrl: _apiBaseUrl,
      connectTimeout: const Duration(seconds: 15),
      receiveTimeout: const Duration(seconds: 15),
      headers: {'Content-Type': 'application/json'},
    ));

    _dio.interceptors.add(_authInterceptor());
  }

  String get _apiBaseUrl => '$_serverOrigin/api/v1';

  String get serverOrigin => _serverOrigin;

  void setServerOrigin(String origin) {
    final normalized = origin.trim();
    if (normalized.isEmpty || normalized == _serverOrigin) return;
    _serverOrigin = normalized;
    _dio.options.baseUrl = _apiBaseUrl;
  }

  /// Her istekte Authorization header'ına JWT token ekler
  /// 401 hatası gelirse refresh token ile yenileme dener
  Interceptor _authInterceptor() {
    return InterceptorsWrapper(
      onRequest: (options, handler) async {
        final token = await _storage.getAccessToken();
        if (token != null) {
          options.headers['Authorization'] = 'Bearer $token';
        }
        handler.next(options);
      },
      onError: (dioErr, handler) async {
        final status = dioErr.response?.statusCode;
        final reqPath = dioErr.requestOptions.path;
        final data = dioErr.response?.data;
        String? errCode;
        if (data is Map) {
          errCode = data['code'] as String?;
        }

        if (status == 401) {
          // Başka cihazdan giriş — yenileme deneme
          if (errCode == 'SESSION_REPLACED') {
            final cb = onSessionReplaced ?? onRefreshFailed;
            if (cb != null) await cb();
            handler.next(dioErr);
            return;
          }

          // Refresh endpoint zaten başarısız
          if (reqPath.contains('/auth/refresh')) {
            final fail = onRefreshFailed;
            if (fail != null) await fail();
            handler.next(dioErr);
            return;
          }

          final refreshed = await _refreshTokenOnce();
          if (refreshed) {
            final retryOptions = dioErr.requestOptions;
            final newToken = await _storage.getAccessToken();
            retryOptions.headers['Authorization'] = 'Bearer $newToken';

            try {
              final response = await _dio.fetch(retryOptions);
              handler.resolve(response);
              return;
            } catch (e) {
              handler.next(dioErr);
              return;
            }
          }
        }
        handler.next(dioErr);
      },
    );
  }

  /// Eşzamanlı 401 isteklerinde yalnızca tek refresh çalıştırır, diğerleri
  /// aynı sonucu bekler. Yarış koşulunda çifte refresh → token rotation iptali
  /// sorunu bu sayede oluşmaz.
  Future<bool> _refreshTokenOnce() {
    final inflight = _refreshInflight;
    if (inflight != null) {
      return inflight.future;
    }
    final completer = Completer<bool>();
    _refreshInflight = completer;

    _refreshToken().then((ok) {
      if (!completer.isCompleted) completer.complete(ok);
    }).catchError((_) {
      if (!completer.isCompleted) completer.complete(false);
    }).whenComplete(() {
      _refreshInflight = null;
    });

    return completer.future;
  }

  /// Refresh token ile yeni access token al
  Future<bool> _refreshToken() async {
    try {
      final refreshToken = await _storage.getRefreshToken();
      if (refreshToken == null) {
        final fail = onRefreshFailed;
        if (fail != null) await fail();
        return false;
      }

      // Interceptor'sız yeni Dio ile refresh isteği gönder (sonsuz döngü önlemi)
      final refreshDio = Dio(BaseOptions(
        baseUrl: _apiBaseUrl,
        connectTimeout: const Duration(seconds: 15),
        receiveTimeout: const Duration(seconds: 15),
      ));
      final response = await refreshDio.post('/auth/refresh', data: {
        'refresh_token': refreshToken,
      });

      if (response.statusCode == 200 && response.data['success'] == true) {
        final tokens = response.data['data']['tokens'];
        await _storage.saveTokens(
          accessToken: tokens['access_token'],
          refreshToken: tokens['refresh_token'],
        );
        onAccessTokenRefreshed?.call(tokens['access_token'] as String);
        return true;
      }
      if (response.statusCode == 401) {
        final fail = onRefreshFailed;
        if (fail != null) await fail();
      }
      return false;
    } catch (e) {
      if (e is DioException && e.response?.statusCode == 401) {
        final fail = onRefreshFailed;
        if (fail != null) await fail();
      }
      return false;
    }
  }

  // ============================================================
  // AUTH ENDPOINT'LERİ
  // ============================================================

  Future<Response> register({
    required String phone,
    required String fullName,
    required String password,
  }) {
    return _dio.post('/auth/register', data: {
      'phone': phone,
      'full_name': fullName,
      'password': password,
    });
  }

  Future<Response> registerDriver({
    required String phone,
    required String fullName,
    required String password,
    required String vehiclePlate,
    required String vehicleModel,
    required String vehicleColor,
  }) {
    return _dio.post('/auth/register/driver', data: {
      'phone': phone,
      'full_name': fullName,
      'password': password,
      'vehicle_plate': vehiclePlate,
      'vehicle_model': vehicleModel,
      'vehicle_color': vehicleColor,
    });
  }

  Future<Response> login({
    required String phone,
    required String password,
  }) {
    return _dio.post('/auth/login', data: {
      'phone': phone,
      'password': password,
    });
  }

  Future<Response> logout() => _dio.post('/auth/logout');

  Future<Response> getMe() => _dio.get('/auth/me');

  // ============================================================
  // RIDE ENDPOINT'LERİ
  // ============================================================

  Future<Response> createRide({
    required Map<String, double> pickup,
    required Map<String, double> dropoff,
    required String pickupAddress,
    required String dropoffAddress,
  }) {
    return _dio.post('/rides', data: {
      'pickup': pickup,
      'dropoff': dropoff,
      'pickup_address': pickupAddress,
      'dropoff_address': dropoffAddress,
    });
  }

  Future<Response> estimatePrice({
    required Map<String, double> pickup,
    required Map<String, double> dropoff,
  }) {
    return _dio.post('/rides/estimate', data: {
      'pickup': pickup,
      'dropoff': dropoff,
    });
  }

  Future<Response> getActiveRide() => _dio.get('/rides/active');

  Future<Response> getRide(String rideId) => _dio.get('/rides/$rideId');

  Future<Response> listRides({int page = 1, int limit = 10}) {
    return _dio.get('/rides', queryParameters: {'page': page, 'limit': limit});
  }

  Future<Response> cancelRide(String rideId, {String? reason}) {
    return _dio.post('/rides/$rideId/cancel', data: {'reason': reason ?? 'Kullanıcı tarafından iptal edildi.'});
  }

  Future<Response> getTariff() => _dio.get('/rides/tariff');

  /// FCM / APNs token — çağrı push bildirimi (sürücü).
  Future<Response> registerPushToken({
    required String token,
    required String platform,
  }) {
    return _dio.post('/users/me/push-token', data: {
      'token': token,
      'platform': platform,
    });
  }

  Future<Response> deletePushToken({required String token}) {
    return _dio.delete('/users/me/push-token', data: {'token': token});
  }

  // ============================================================
  // DRIVER ENDPOINT'LERİ
  // ============================================================

  Future<Response> getNearbyDrivers(double lat, double lng, {int radius = 5000}) {
    return _dio.get('/drivers/nearby', queryParameters: {'lat': lat, 'lng': lng, 'radius': radius});
  }

  Future<Response> updateDriverStatus(bool isOnline) {
    return _dio.patch('/drivers/status', data: {'is_online': isOnline});
  }

  /// Kart yükleme simülasyonu — gerçek ödeme yok; bakiyeye T Coin eklenir (sunucu `WALLET_CARD_SIMULATION_ENABLED`).
  Future<Response> simulateDriverWalletCardTopup({required double amount}) {
    final rounded = (amount * 100).round() / 100;
    return _dio.post('/drivers/wallet/simulate-card-topup', data: {'amount': rounded});
  }

  // ============================================================
  // REVIEW ENDPOINT'LERİ
  // ============================================================

  Future<Response> submitReview({
    required String rideId,
    required String reviewedId,
    required int rating,
    String? comment,
  }) {
    return _dio.post('/reviews', data: {
      'ride_id': rideId,
      'reviewed_id': reviewedId,
      'rating': rating,
      'comment': comment,
    });
  }

  // ============================================================
  // PLATFORM (kimliksiz okuma — T Coin eşikleri vb.)
  // ============================================================

  Future<Response> getConfigPublic() => _dio.get('/config/public');

  // ============================================================
  // ADMIN ENDPOINT'LERİ
  // ============================================================

  Future<Response> getAdminOverview() => _dio.get('/admin/overview');

  Future<Response> getAdminPricingSettings() => _dio.get('/admin/settings/pricing');

  Future<Response> updateAdminPricingSettings({
    required num entryDaily,
    required num entryWeekly,
    required num entryMonthly,
    required num commissionPercent,
    required num commissionFlat,
    required num minCommission,
  }) {
    return _dio.put('/admin/settings/pricing', data: {
      'entryDaily': entryDaily,
      'entryWeekly': entryWeekly,
      'entryMonthly': entryMonthly,
      'commissionPercent': commissionPercent,
      'commissionFlat': commissionFlat,
      'minCommission': minCommission,
    });
  }

  Future<Response> getAdminDrivers() => _dio.get('/admin/drivers');

  Future<Response> createAdminDriver(Map<String, dynamic> body) =>
      _dio.post('/admin/drivers', data: body);

  Future<Response> updateAdminDriver(String id, Map<String, dynamic> body) =>
      _dio.patch('/admin/drivers/$id', data: body);

  Future<Response> deleteAdminDriver(String id) => _dio.delete('/admin/drivers/$id');

  Future<Response> setAdminDriverAccess({
    required String driverId,
    required bool enabled,
  }) {
    return _dio.patch('/admin/drivers/$driverId/access', data: {
      'enabled': enabled,
    });
  }

  /// Sürücüye T Coin ekler (`add_driver_balance` RPC).
  Future<Response> addAdminDriverBalance({
    required String driverId,
    required double amount,
  }) {
    final rounded = (amount * 100).round() / 100;
    return _dio.post('/admin/drivers/$driverId/balance', data: {'amount': rounded});
  }

  Future<Response> getAdminRides({
    int limit = 50,
    String? status,
    String? q,
  }) {
    final params = <String, dynamic>{'limit': limit};
    if (status != null && status.isNotEmpty && status != 'all') {
      params['status'] = status;
    }
    if (q != null && q.trim().isNotEmpty) params['q'] = q.trim();
    return _dio.get('/admin/rides', queryParameters: params);
  }

  Future<Response> getAdminRide(String id) => _dio.get('/admin/rides/$id');

  Future<Response> getAdminCustomers({
    int limit = 50,
    String? q,
    String? suspended,
  }) {
    final params = <String, dynamic>{'limit': limit};
    if (q != null && q.trim().isNotEmpty) params['q'] = q.trim();
    if (suspended != null && suspended.isNotEmpty && suspended != 'all') {
      params['suspended'] = suspended;
    }
    return _dio.get('/admin/customers', queryParameters: params);
  }

  Future<Response> getAdminCustomer(String id) => _dio.get('/admin/customers/$id');

  Future<Response> updateAdminCustomer(String id, Map<String, dynamic> body) =>
      _dio.patch('/admin/customers/$id', data: body);

  Future<Response> revokeAdminCustomerSessions(String id) =>
      _dio.post('/admin/customers/$id/revoke-sessions');

  Future<Response> resetAdminCustomerPassword(String id, String password) =>
      _dio.post('/admin/customers/$id/reset-password', data: {'password': password});

  Future<Response> deleteAdminCustomer(String id) => _dio.delete('/admin/customers/$id');

  Future<Response> getAdminOpsLive() => _dio.get('/admin/ops/live');

  Future<Response> getAdminOpsHealth() => _dio.get('/admin/ops/health');

  Future<Response> getAdminOpsMatching() => _dio.get('/admin/ops/matching');

  Future<Response> postAdminOpsMatchingClear(String rideId) =>
      _dio.post('/admin/ops/matching/$rideId/clear');

  Future<Response> postAdminOpsStaleSearchingRecover() =>
      _dio.post('/admin/ops/stale-searching/recover');

  Future<Response> cancelAdminRide(String id, {String? reason}) =>
      _dio.post('/admin/rides/$id/cancel', data: {
        if (reason != null && reason.trim().isNotEmpty) 'reason': reason.trim(),
      });

  /// Değerlendirmeler — [rating] null veya 1–5; backend özet sayıları da döner.
  Future<Response> getAdminReviews({
    int? rating,
    int page = 1,
    int limit = 40,
  }) {
    final q = <String, dynamic>{'page': page, 'limit': limit};
    if (rating != null) q['rating'] = rating;
    return _dio.get('/admin/reviews', queryParameters: q);
  }

  Future<Response> getAdminLogs({int lines = 200}) =>
      _dio.get('/admin/logs', queryParameters: {'lines': lines});

  Future<Response> getAdminPlatformSettings() => _dio.get('/admin/settings/platform');

  Future<Response> updateAdminPlatformSettings(Map<String, dynamic> body) =>
      _dio.put('/admin/settings/platform', data: body);

  /// Yönetici duyurusu — [audience]: all | customers | drivers | user
  Future<Response> postAdminBroadcastPush({
    required String title,
    required String body,
    String audience = 'all',
    String? userId,
    String? phone,
  }) {
    final data = <String, dynamic>{
      'title': title,
      'body': body,
      'audience': audience,
    };
    if (userId != null && userId.isNotEmpty) data['userId'] = userId;
    if (phone != null && phone.isNotEmpty) data['phone'] = phone;
    return _dio.post<Map<String, dynamic>>(
      '/admin/push/broadcast',
      data: data,
      options: Options(
        receiveTimeout: const Duration(minutes: 3),
        sendTimeout: const Duration(seconds: 30),
      ),
    );
  }
}
