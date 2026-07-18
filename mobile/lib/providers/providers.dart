import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../core/constants/app_constants.dart';
import '../models/user_model.dart';
import '../models/platform_config_model.dart';
import '../models/ride_model.dart';
import '../models/ride_matching_progress_model.dart';
import '../models/driver_info_model.dart';
import '../services/storage_service.dart';
import '../services/api_service.dart';
import '../services/socket_service.dart';
import '../services/driver_push_registration.dart';
import '../services/ride_session_sync.dart';

/// setUser / clearSessionLocally sıralaması — await edilmeyen async kick ile yarışı önler
class _AsyncMutex {
  Future<void> _tail = Future.value();

  Future<T> run<T>(Future<T> Function() fn) async {
    final prev = _tail;
    final done = Completer<void>();
    _tail = prev.then((_) => done.future);
    await prev;
    try {
      return await fn();
    } finally {
      if (!done.isCompleted) done.complete();
    }
  }
}

// ============================================================
// SERVİS PROVIDER'LARI
// ============================================================

/// Storage servisi (Singleton — uygulama boyunca tek örnek)
final storageServiceProvider = Provider<StorageService>((ref) {
  return StorageService();
});

final backendOriginProvider =
    StateNotifierProvider<BackendOriginNotifier, String>((ref) {
  return BackendOriginNotifier(ref);
});

class BackendOriginNotifier extends StateNotifier<String> {
  BackendOriginNotifier(this._ref) : super(AppConstants.defaultServerOrigin) {
    _load();
  }

  final Ref _ref;

  Future<void> _load() async {
    final storage = _ref.read(storageServiceProvider);
    final saved = await storage.getBackendOrigin();
    if (saved == null) return;

    final normalizedSaved = _normalize(saved);
    // Eski sürümde depoya yazılmış localhost — tohum uzak sunucuysa bir kez düzelt (fiziksel cihaz).
    const seed = AppConstants.defaultServerOrigin;
    final seedUri = Uri.tryParse(seed);
    final seedIsLocal = seedUri != null &&
        (seedUri.host == '127.0.0.1' || seedUri.host == 'localhost');
    if (!seedIsLocal &&
        (normalizedSaved == 'http://127.0.0.1:3000' ||
            normalizedSaved == 'http://localhost:3000')) {
      await setOrigin(seed, persist: true);
      return;
    }

    await setOrigin(saved, persist: false);
  }

  String _normalize(String raw) {
    var s = raw.trim();
    if (s.isEmpty) return state;
    if (!s.startsWith('http://') && !s.startsWith('https://')) {
      s = 'http://$s';
    }
    if (s.endsWith('/')) {
      s = s.substring(0, s.length - 1);
    }
    return s;
  }

  Future<void> setOrigin(String raw, {bool persist = true}) async {
    final normalized = _normalize(raw);
    if (normalized == state) return;
    state = normalized;
    _ref.read(apiServiceProvider).setServerOrigin(normalized);
    _ref.read(socketServiceProvider).setServerOrigin(normalized);
    if (persist) {
      await _ref.read(storageServiceProvider).saveBackendOrigin(normalized);
    }
  }
}

/// Başka cihazdan giriş bildirimi (SnackBar için metin; gösterildikten sonra null yapın)
final sessionKickMessageProvider = StateProvider<String?>((ref) => null);

/// API servisi (Storage'a bağımlı)
final apiServiceProvider = Provider<ApiService>((ref) {
  ref.read(backendOriginProvider);
  final storage = ref.watch(storageServiceProvider);
  final socket = ref.read(socketServiceProvider);
  final api = ApiService(
    storage,
    onAccessTokenRefreshed: (accessToken) {
      socket.connect(accessToken);
    },
    onRefreshFailed: () async {
      final n = ref.read(currentUserProvider.notifier);
      final gen = n.sessionGeneration;
      await n.clearSessionLocally(onlyIfGenerationIs: gen);
    },
    onSessionReplaced: () async {
      final n = ref.read(currentUserProvider.notifier);
      final gen = n.sessionGeneration;
      final cleared = await n.clearSessionLocally(onlyIfGenerationIs: gen);
      if (cleared) {
        ref.read(sessionKickMessageProvider.notifier).state =
            'Hesabınıza başka bir cihazdan giriş yapıldı.';
      }
    },
  );
  // Socket ↔ API döngüsünü kırmak için auth yenileme burada bağlanır (socket provider api okumaz).
  socket.onConnectAuthFailure = () async {
    try {
      await api.getMe();
    } catch (_) {}
  };
  return api;
});

/// Socket servisi (Singleton)
final socketServiceProvider = Provider<SocketService>((ref) {
  ref.read(backendOriginProvider);
  final service = SocketService();
  service.accessTokenProvider = () async {
    final storage = ref.read(storageServiceProvider);
    return storage.getAccessToken();
  };
  service.onAuthSessionEnded = (reason) async {
    // Önce socket'i kes (yeniden bağlanmayı durdur), sonra depoyu temizle
    service.disconnect();
    final n = ref.read(currentUserProvider.notifier);
    final gen = n.sessionGeneration;
    final cleared = await n.clearSessionLocally(onlyIfGenerationIs: gen);
    if (cleared && reason == 'other_device_login') {
      ref.read(sessionKickMessageProvider.notifier).state =
          'Hesabınıza başka bir cihazdan giriş yapıldı.';
    }
    // reason == 'logout': kendi çıkış akışı zaten temizliyor; ek mesaj yok
  };
  ref.onDispose(() => service.dispose());
  return service;
});

// ============================================================
// AUTH STATE
// ============================================================

/// Mevcut oturum açmış kullanıcı
final currentUserProvider = StateNotifierProvider<CurrentUserNotifier, UserModel?>((ref) {
  return CurrentUserNotifier(ref);
});

class CurrentUserNotifier extends StateNotifier<UserModel?> {
  final Ref _ref;
  final _AsyncMutex _sessionMutex = _AsyncMutex();

  /// Tekrar giriş / kick temizliği yarışını ayırt etmek için (setUser her başarılı girişte artırır)
  int _sessionGeneration = 0;

  CurrentUserNotifier(this._ref) : super(null);

  /// Kick/401 temizliğinin hâlâ geçerli olup olmadığını anlamak için (olay anındaki nesil)
  int get sessionGeneration => _sessionGeneration;

  /// Kayıtlı kullanıcıyı yükle (uygulama başlangıcı)
  Future<void> loadSavedUser() async {
    final storage = _ref.read(storageServiceProvider);
    await storage.init();
    state = storage.getUser();
    if (state != null && _sessionGeneration == 0) {
      _sessionGeneration = 1;
    }
    if (state != null) {
      _ref.read(rideSessionSyncProvider).attach();
    } else {
      _ref.read(rideSessionSyncProvider).detach();
    }
  }

  /// Giriş sonrası kullanıcıyı kaydet
  Future<void> setUser(UserModel user, String accessToken, String refreshToken) async {
    await _sessionMutex.run(() async {
      _sessionGeneration++;
      final storage = _ref.read(storageServiceProvider);
      await storage.saveTokens(accessToken: accessToken, refreshToken: refreshToken);
      await storage.saveUser(user);
      state = user;
    });

    // Socket mutex dışında — depo ile token tutarlı
    final socket = _ref.read(socketServiceProvider);
    _ref.read(rideSessionSyncProvider).attach();
    socket.connect(accessToken);
  }

  /// Kullanıcı bilgilerini güncelle
  void updateUser(UserModel user) {
    state = user;
  }

  /// GET /auth/me — puan, değerlendirme sayısı, tamamlanan yolculuk vb.
  Future<void> refreshProfileFromApi() async {
    try {
      final api = _ref.read(apiServiceProvider);
      final res = await api.getMe();
      if (res.statusCode != 200 || res.data['success'] != true) return;
      final data = res.data['data'];
      if (data is! Map) return;
      final u = data['user'];
      if (u is! Map) return;
      final userMap = Map<String, dynamic>.from(u);
      final driver = data['driver'];
      if (driver is Map && userMap['role'] == 'driver') {
        final b = driver['balance'];
        if (b != null) userMap['balance_tcoin'] = b;
        final code = driver['driver_code'];
        if (code != null) userMap['driver_code'] = code;
        _ref.read(isDriverOnlineProvider.notifier).state =
            driver['is_online'] == true;
      }
      final parsed = UserModel.fromJson(userMap);
      if (state != null && state!.id != parsed.id) return;
      final storage = _ref.read(storageServiceProvider);
      await storage.saveUser(parsed);
      state = parsed;
    } catch (_) {}
  }

  /// Çıkış yap
  Future<void> logout() async {
    try {
      await DriverPushRegistration.unregister(_ref);
    } catch (_) {}

    try {
      final api = _ref.read(apiServiceProvider);
      await api.logout();
    } catch (_) {
      // API hatası olsa bile yerel temizleme yap
    }

    await clearSessionLocally();
  }

  /// Sunucu oturumu geçersiz (refresh 401) — API çağrısı olmadan yereli temizle
  ///
  /// [onlyIfGenerationIs]: Olay anındaki [sessionGeneration] ile aynıysa temizlik yapılır.
  /// Araya yeni bir giriş ([setUser]) girdiyse nesil değişir ve bu temizlik atlanır (socket korunur).
  /// Çıkışta parametre verilmez — her zaman tam temizlik.
  /// Dönüş: gerçekten temizlik yapıldıysa true.
  Future<bool> clearSessionLocally({int? onlyIfGenerationIs}) async {
    var cleared = false;
    await _sessionMutex.run(() async {
      if (onlyIfGenerationIs != null && _sessionGeneration != onlyIfGenerationIs) {
        return;
      }

      final storage = _ref.read(storageServiceProvider);
      await storage.clearAll();

      final socket = _ref.read(socketServiceProvider);
      socket.disconnect();
      _ref.read(rideSessionSyncProvider).detach();

      // Sürücü UI durumu (çevrimiçi / bekleyen istek) oturumla birlikte sıfırlanmalı
      _ref.read(isDriverOnlineProvider.notifier).state = false;
      _ref.read(pendingRideRequestProvider.notifier).state = null;
      _ref.read(activeRideProvider.notifier).clear();
      _ref.read(assignedDriverProvider.notifier).clear();

      state = null;
      _sessionGeneration = 0;
      cleared = true;
    });
    return cleared;
  }
}

/// Oturum açmış mı kontrol
final isLoggedInProvider = Provider<bool>((ref) {
  return ref.watch(currentUserProvider) != null;
});

/// Kullanıcı rolü
final userRoleProvider = Provider<String?>((ref) {
  return ref.watch(currentUserProvider)?.role;
});

// ============================================================
// RIDE STATE
// ============================================================

/// Aktif yolculuk durumu
final activeRideProvider = StateNotifierProvider<ActiveRideNotifier, RideModel?>((ref) {
  return ActiveRideNotifier();
});

class ActiveRideNotifier extends StateNotifier<RideModel?> {
  ActiveRideNotifier() : super(null);

  void setRide(RideModel ride) {
    final cur = state;
    if (cur != null && cur.id == ride.id) {
      final incomingTerminal = ride.status == RideStatus.completed ||
          ride.status == RideStatus.cancelled;
      if (!incomingTerminal) {
        final pinIncoming = ride.pickupVerificationCode?.trim();
        final pinPrev = cur.pickupVerificationCode?.trim();
        final pin = (pinIncoming != null && pinIncoming.isNotEmpty)
            ? pinIncoming
            : pinPrev;
        final verified = cur.pickupCodeVerified || ride.pickupCodeVerified;

        final curTerminal = cur.status == RideStatus.completed ||
            cur.status == RideStatus.cancelled;
        final curRank = cur.status.activeFlowProgressRank;
        final newRank = ride.status.activeFlowProgressRank;
        if (!curTerminal && curRank < 100 && curRank > newRank) {
          state = ride.copyWith(
            status: cur.status,
            pickupCodeVerified: verified,
            pickupVerificationCode: pin,
          );
          return;
        }
        state = ride.copyWith(
          pickupVerificationCode: pin,
          pickupCodeVerified: verified,
        );
        return;
      }
    }
    state = ride;
  }

  void updateStatus(RideStatus status) {
    if (state != null) {
      state = state!.copyWith(status: status);
    }
  }

  void setDriverId(String driverId) {
    if (state != null) {
      state = state!.copyWith(driverId: driverId);
    }
  }

  void updateRideId(String rideId) {
    if (state != null) {
      state = state!.copyWith(id: rideId);
    }
  }

  void setPickupCodeVerified(bool value) {
    if (state != null) {
      state = state!.copyWith(pickupCodeVerified: value);
    }
  }

  /// ride:accepted / REST — socket snapshot PIN taşımazsa bile kodu yazmak için
  void applyPickupVerificationCode(String code) {
    if (state == null) return;
    final t = code.trim();
    if (t.isEmpty) return;
    state = state!.copyWith(pickupVerificationCode: t);
  }

  void clear() => state = null;
}

/// Müşteri arama sırasında sunucudan gelen eşleştirme ilerlemesi
final rideMatchingProgressProvider =
    StateNotifierProvider<RideMatchingProgressNotifier, RideMatchingProgressModel?>(
  (ref) => RideMatchingProgressNotifier(),
);

class RideMatchingProgressNotifier extends StateNotifier<RideMatchingProgressModel?> {
  RideMatchingProgressNotifier() : super(null);

  void apply(RideMatchingProgressModel progress) {
    final prev = state;
    if (prev != null && prev.rideId == progress.rideId) {
      state = prev.mergeFrom(progress);
    } else {
      state = progress;
    }
  }

  void clear() => state = null;
}

/// Yolculuğa atanmış sürücü bilgisi
final assignedDriverProvider = StateNotifierProvider<AssignedDriverNotifier, DriverInfoModel?>((ref) {
  return AssignedDriverNotifier();
});

class AssignedDriverNotifier extends StateNotifier<DriverInfoModel?> {
  AssignedDriverNotifier() : super(null);

  void setDriver(DriverInfoModel driver) => state = driver;

  void updateLocation(double lat, double lng) {
    if (state != null) {
      state = state!.copyWith(lat: lat, lng: lng);
    }
  }

  void clear() => state = null;
}

// ============================================================
// DRIVER STATE (Sürücü tarafı)
// ============================================================

/// Sürücünün çevrimiçi durumu
final isDriverOnlineProvider = StateProvider<bool>((ref) => false);

/// Sürücüye gelen yolculuk isteği
final pendingRideRequestProvider = StateProvider<Map<String, dynamic>?>((ref) => null);

/// FCM `ride_new_request` — [DriverHomeScreen] dinleyip dialog açar
final driverPendingFcmRideRequestProvider =
    StateProvider<Map<String, dynamic>?>((ref) => null);

// ============================================================
// SOHBET (aktif yolculuk mesajlaşması)
// ============================================================

/// Sohbet paneli açık mı — açıkken gelen mesajlar okunmamış sayılmaz.
final rideChatSheetOpenProvider = StateProvider<bool>((ref) => false);

/// FCM `new_message` bildirimine tıklanınca açılacak sohbetin rideId'si —
/// aktif yolculuk paneli (sürücü/müşteri) dinleyip sheet'i açar.
final pendingChatOpenRideIdProvider = StateProvider<String?>((ref) => null);

/// Okunmamış sohbet mesajı sayısı — mesaj ikonundaki rozet.
final chatUnreadCountProvider =
    StateNotifierProvider<ChatUnreadNotifier, int>((ref) {
  final notifier = ChatUnreadNotifier(ref);
  // Yolculuk bitince/temizlenince rozet de sıfırlanır.
  ref.listen<RideModel?>(activeRideProvider, (prev, next) {
    if (next == null) notifier.clear();
  });
  return notifier;
});

class ChatUnreadNotifier extends StateNotifier<int> {
  ChatUnreadNotifier(this._ref) : super(0) {
    _sub = _ref.read(socketServiceProvider).onNewMessage.listen((data) {
      if (data['senderId'] == _ref.read(currentUserProvider)?.id) return;
      if (_ref.read(rideChatSheetOpenProvider)) return;
      state = state + 1;
    });
  }

  final Ref _ref;
  StreamSubscription<Map<String, dynamic>>? _sub;

  void clear() => state = 0;

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }
}

// ============================================================
// UI STATE
// ============================================================

/// Yükleniyor göstergesi
final isLoadingProvider = StateProvider<bool>((ref) => false);

// ============================================================
// SUNUCU PLATFORM AYARLARI (public JSON — splash sonrası güncellenir)
// ============================================================

class PlatformConfigNotifier extends StateNotifier<PlatformConfigData> {
  /// Varsayılanlarla başlar; yükleme splash veya ekranların çağırdığı [refresh] ile yapılır
  /// (oluşturucuda otomatik istek = çift çağrı ve daha uzun splash süresi olurdu).
  PlatformConfigNotifier(this.ref) : super(PlatformConfigData.fallback());

  final Ref ref;

  Future<void> refresh() async {
    try {
      final res = await ref.read(apiServiceProvider).getConfigPublic();
      final body = res.data;
      if (res.statusCode == 200 && body is Map && body['success'] == true) {
        final d = body['data'];
        if (d is Map) {
          state = PlatformConfigData.fromJson(Map<String, dynamic>.from(d));
        }
      }
    } catch (_) {}
  }
}

final platformConfigProvider =
    StateNotifierProvider<PlatformConfigNotifier, PlatformConfigData>((ref) {
  return PlatformConfigNotifier(ref);
});

// ============================================================
// DİL (MaterialApp locale)
// ============================================================

final appLocaleProvider = StateNotifierProvider<AppLocaleNotifier, Locale>((ref) {
  return AppLocaleNotifier();
});

class AppLocaleNotifier extends StateNotifier<Locale> {
  AppLocaleNotifier() : super(const Locale('tr', 'TR')) {
    _load();
  }

  static const _prefsKey = 'app_locale_code';

  Future<void> _load() async {
    final p = await SharedPreferences.getInstance();
    final c = p.getString(_prefsKey);
    if (c == 'en') {
      state = const Locale('en', 'US');
    }
  }

  Future<void> setLocale(Locale locale) async {
    state = locale;
    final p = await SharedPreferences.getInstance();
    await p.setString(_prefsKey, locale.languageCode == 'en' ? 'en' : 'tr');
  }
}
