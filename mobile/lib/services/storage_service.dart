import 'dart:convert';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../core/constants/app_constants.dart';
import '../models/user_model.dart';

/// Yerel depolama servisi
/// JWT token'lar FlutterSecureStorage'da, kullanıcı verisi SharedPreferences'da saklanır
class StorageService {
  final FlutterSecureStorage _secureStorage;
  late SharedPreferences _prefs;
  bool _initialized = false;

  StorageService() : _secureStorage = const FlutterSecureStorage();

  /// Servisi başlat (uygulama açılışında çağrılmalı)
  Future<void> init() async {
    if (_initialized) return;
    _prefs = await SharedPreferences.getInstance();
    _initialized = true;
  }

  // ============================================================
  // TOKEN YÖNETİMİ (Secure Storage)
  // ============================================================

  Future<void> saveTokens({
    required String accessToken,
    required String refreshToken,
  }) async {
    await _secureStorage.write(key: AppConstants.accessTokenKey, value: accessToken);
    await _secureStorage.write(key: AppConstants.refreshTokenKey, value: refreshToken);
  }

  Future<String?> getAccessToken() async {
    return _secureStorage.read(key: AppConstants.accessTokenKey);
  }

  Future<String?> getRefreshToken() async {
    return _secureStorage.read(key: AppConstants.refreshTokenKey);
  }

  Future<void> clearTokens() async {
    await _secureStorage.delete(key: AppConstants.accessTokenKey);
    await _secureStorage.delete(key: AppConstants.refreshTokenKey);
  }

  // ============================================================
  // KULLANICI VERİSİ (SharedPreferences)
  // ============================================================

  Future<void> saveUser(UserModel user) async {
    await _prefs.setString(AppConstants.userDataKey, jsonEncode(user.toJson()));
  }

  UserModel? getUser() {
    final data = _prefs.getString(AppConstants.userDataKey);
    if (data == null) return null;
    return UserModel.fromJson(jsonDecode(data) as Map<String, dynamic>);
  }

  Future<void> clearUser() async {
    await _prefs.remove(AppConstants.userDataKey);
  }

  // ============================================================
  // BACKEND ORIGIN (Admin)
  // ============================================================

  Future<void> saveBackendOrigin(String origin) async {
    await init();
    await _prefs.setString(AppConstants.backendOriginKey, origin);
  }

  Future<String?> getBackendOrigin() async {
    await init();
    final v = _prefs.getString(AppConstants.backendOriginKey);
    if (v == null || v.trim().isEmpty) return null;
    return v.trim();
  }

  // ============================================================
  // VARIŞ ARAMA GEÇMİŞİ (Müşteri)
  // ============================================================

  static const int _maxDestinationHistory = 12;

  /// placeId + gösterim metinleri (yeniden Places Details için)
  Future<void> addDestinationSearchHistoryEntry({
    required String placeId,
    required String mainText,
    required String secondaryText,
  }) async {
    await init();
    final list = getDestinationSearchHistory();
    list.removeWhere((e) => e['placeId'] == placeId);
    list.insert(0, {
      'placeId': placeId,
      'mainText': mainText,
      'secondaryText': secondaryText,
    });
    if (list.length > _maxDestinationHistory) {
      list.removeRange(_maxDestinationHistory, list.length);
    }
    await _prefs.setString(
      AppConstants.destinationSearchHistoryKey,
      jsonEncode(list),
    );
  }

  List<Map<String, dynamic>> getDestinationSearchHistory() {
    if (!_initialized) return [];
    final raw = _prefs.getString(AppConstants.destinationSearchHistoryKey);
    if (raw == null || raw.isEmpty) return [];
    try {
      final decoded = jsonDecode(raw) as List<dynamic>;
      return decoded
          .map((e) => Map<String, dynamic>.from(e as Map))
          .toList();
    } catch (_) {
      return [];
    }
  }

  Future<void> clearDestinationSearchHistory() async {
    await init();
    await _prefs.remove(AppConstants.destinationSearchHistoryKey);
  }

  // ============================================================
  // BİLDİRİM TERCİHLERİ
  // ============================================================

  Future<Map<String, dynamic>> getNotificationPrefs() async {
    await init();
    final raw = _prefs.getString(AppConstants.notificationPrefsKey);
    if (raw == null || raw.isEmpty) {
      return {'ride_updates': true, 'sound': true};
    }
    try {
      return Map<String, dynamic>.from(jsonDecode(raw) as Map);
    } catch (_) {
      return {'ride_updates': true, 'sound': true};
    }
  }

  Future<void> setNotificationPrefs(Map<String, dynamic> prefs) async {
    await init();
    await _prefs.setString(AppConstants.notificationPrefsKey, jsonEncode(prefs));
  }

  // ============================================================
  // TANITIM (İlk açılış)
  // ============================================================

  /// [init] çağrılmadıysa tanıtım gösterilir (güvenli varsayılan).
  bool isOnboardingCompleted() {
    if (!_initialized) return false;
    return _prefs.getBool(AppConstants.onboardingCompletedKey) ?? false;
  }

  Future<void> setOnboardingCompleted({bool completed = true}) async {
    await init();
    await _prefs.setBool(AppConstants.onboardingCompletedKey, completed);
  }

  // ============================================================
  // TOPLU TEMİZLEME (Çıkış)
  // ============================================================

  Future<void> clearAll() async {
    await clearTokens();
    await clearUser();
  }

  /// Kullanıcı oturum açmış mı kontrol et
  Future<bool> isLoggedIn() async {
    final token = await getAccessToken();
    return token != null && token.isNotEmpty;
  }
}
