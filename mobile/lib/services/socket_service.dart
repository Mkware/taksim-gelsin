import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;
import '../core/constants/app_constants.dart';
import '../models/ride_model.dart';

/// Socket.io İstemci Servisi
/// Backend ile gerçek zamanlı iletişim — konum takibi, yolculuk durumu vb.
class SocketService {
  io.Socket? _socket;
  bool _isConnected = false;
  String _serverOrigin = AppConstants.socketUrl;
  /// Son başarılı el sıkışmada kullanılan JWT (Bearer’sız); reconnect / ensureConnected yedekleri
  String? _lastToken;

  /// Her Socket.IO el sıkışmasında (ilk bağlantı + otomatik reconnect) depodan güncel access token.
  /// Olmazsa [connect] ile verilen [_lastToken] kullanılır.
  Future<String?> Function()? accessTokenProvider;

  /// Bağlantı / reconnect auth hatası: örn. REST [getMe] ile 401 → refresh → [onAccessTokenRefreshed] zinciri.
  Future<void> Function()? onConnectAuthFailure;

  Timer? _authFailureRecoveryTimer;
  DateTime? _lastAuthFailureKick;
  DateTime? _lastTransportErrorLog;

  /// Yeni bağlantı kurulduktan sonra kısa süre: eski sokete giden `auth:session_ended`
  /// (aynı cihazda yeniden giriş) yanlışlıkla yeni oturumu silmesin diye yok sayılır.
  DateTime? _ignoreSessionEndedBefore;

  /// Sunucu oturumu kestiğinde (başka cihaz girişi / çıkış) — yerel oturumu kapatmak için
  void Function(String reason)? onAuthSessionEnded;

  /// Soket bağlandığında (veya yeniden bağlandığında) tetiklenir — örn. sürücü tekrar `go_online` emitlemek için
  final _connectedController = StreamController<void>.broadcast();
  Stream<void> get onConnected => _connectedController.stream;

  /// Sunucudan `driver:online_confirmed` geldiğinde tetiklenir
  final _driverOnlineConfirmedController =
      StreamController<Map<String, dynamic>>.broadcast();
  Stream<Map<String, dynamic>> get onDriverOnlineConfirmed =>
      _driverOnlineConfirmedController.stream;

  // Event stream controller'ları — UI bu stream'leri dinler
  final _rideAcceptedController = StreamController<Map<String, dynamic>>.broadcast();
  final _driverLocationController = StreamController<Map<String, dynamic>>.broadcast();
  final _rideStatusController = StreamController<Map<String, dynamic>>.broadcast();
  final _newRideRequestController = StreamController<Map<String, dynamic>>.broadcast();
  final _noDriverFoundController = StreamController<String>.broadcast();
  final _rideCompletedController = StreamController<Map<String, dynamic>>.broadcast();
  final _rideCancelledController = StreamController<Map<String, dynamic>>.broadcast();
  final _driverArrivedController = StreamController<Map<String, dynamic>>.broadcast();
  final _rideStartedController = StreamController<String>.broadcast();
  final _rideSearchingController = StreamController<Map<String, dynamic>>.broadcast();
  final _rideMatchingProgressController =
      StreamController<Map<String, dynamic>>.broadcast();
  final _rideRequestCancelledController = StreamController<Map<String, dynamic>>.broadcast();
  final _rideSnapshotController = StreamController<Map<String, dynamic>>.broadcast();
  final _pickupCodeResultController =
      StreamController<Map<String, dynamic>>.broadcast();
  final _rideStartRejectedController =
      StreamController<Map<String, dynamic>>.broadcast();
  final _rideRevealLocationController =
      StreamController<Map<String, dynamic>>.broadcast();
  final _rideAcceptFailedController =
      StreamController<Map<String, dynamic>>.broadcast();
  final _driverOnlineBlockedController =
      StreamController<Map<String, dynamic>>.broadcast();
  final _driverForcedOfflineController =
      StreamController<Map<String, dynamic>>.broadcast();
  final _rideCompleteFailedController =
      StreamController<Map<String, dynamic>>.broadcast();

  // Public stream'ler
  Stream<Map<String, dynamic>> get onRideAccepted => _rideAcceptedController.stream;
  Stream<Map<String, dynamic>> get onDriverLocation => _driverLocationController.stream;
  Stream<Map<String, dynamic>> get onRideStatus => _rideStatusController.stream;
  Stream<Map<String, dynamic>> get onNewRideRequest => _newRideRequestController.stream;
  Stream<String> get onNoDriverFound => _noDriverFoundController.stream;
  Stream<Map<String, dynamic>> get onRideCompleted => _rideCompletedController.stream;
  Stream<Map<String, dynamic>> get onRideCancelled => _rideCancelledController.stream;
  Stream<Map<String, dynamic>> get onDriverArrived => _driverArrivedController.stream;
  Stream<String> get onRideStarted => _rideStartedController.stream;
  Stream<Map<String, dynamic>> get onRideSearching => _rideSearchingController.stream;
  Stream<Map<String, dynamic>> get onRideMatchingProgress =>
      _rideMatchingProgressController.stream;
  Stream<Map<String, dynamic>> get onRideRequestCancelled => _rideRequestCancelledController.stream;
  /// Aktif yolculuk snapshot'ı (bağlanınca / reconnect olunca sunucu push eder)
  Stream<Map<String, dynamic>> get onRideSnapshot => _rideSnapshotController.stream;
  Stream<Map<String, dynamic>> get onPickupCodeResult =>
      _pickupCodeResultController.stream;
  Stream<Map<String, dynamic>> get onRideStartRejected =>
      _rideStartRejectedController.stream;
  Stream<Map<String, dynamic>> get onRideRevealLocation =>
      _rideRevealLocationController.stream;
  Stream<Map<String, dynamic>> get onRideAcceptFailed =>
      _rideAcceptFailedController.stream;
  /// Çevrimiçi olma yetersiz bakiye vb. ile reddedildi
  Stream<Map<String, dynamic>> get onDriverOnlineBlocked =>
      _driverOnlineBlockedController.stream;
  /// Sunucu bakiye bitti diye çevrimdışı çekti
  Stream<Map<String, dynamic>> get onDriverForcedOffline =>
      _driverForcedOfflineController.stream;
  /// Yolculuk tamamlama başarısız (yetki/fiyat)
  Stream<Map<String, dynamic>> get onRideCompleteFailed =>
      _rideCompleteFailedController.stream;

  bool get isConnected => _isConnected;

  String get serverOrigin => _serverOrigin;

  void setServerOrigin(String origin) {
    final normalized = origin.trim();
    if (normalized.isEmpty || normalized == _serverOrigin) return;
    _serverOrigin = normalized;
    if (_isConnected && _lastToken != null && _lastToken!.isNotEmpty) {
      final token = _lastToken!;
      disconnect();
      connect(token);
    }
  }

  /// JWT token ile Socket.io bağlantısı kur
  void connect(String token) {
    if (_socket != null) disconnect();

    // Aynı cihazda tekrar girişte eski socket'e giden auth:session_ended'i yok say
    _ignoreSessionEndedBefore = DateTime.now().add(const Duration(seconds: 3));

    final normalized = _stripBearerPrefix(token);
    _lastToken = normalized;

    _socket = io.io(
      _serverOrigin,
      io.OptionBuilder()
          .setTransports(['websocket', 'polling'])
          .enableForceNew()
          .enableAutoConnect()
          .enableReconnection()
          .setReconnectionAttempts(1 << 30) // sonsuz dene
          .setReconnectionDelay(1200)
          .setReconnectionDelayMax(8000)
          // Her engine açılışında güncel JWT (süresi dolmuş sabit auth ile reconnect çökmesini önler)
          .setAuthFn((void Function(Map<dynamic, dynamic> data) submitAuth) {
            () async {
              try {
                final jwt = await _resolveJwtForHandshake();
                if (jwt == null || jwt.isEmpty) {
                  submitAuth({'token': ''});
                  return;
                }
                _lastToken = jwt;
                _syncManagerExtraHeaders(jwt);
                submitAuth({'token': 'Bearer $jwt'});
              } catch (e) {
                debugPrint('Socket authFn hatası: $e');
                final fallback = _lastToken;
                if (fallback != null && fallback.isNotEmpty) {
                  _syncManagerExtraHeaders(fallback);
                  submitAuth({'token': 'Bearer $fallback'});
                } else {
                  submitAuth({'token': ''});
                }
              }
            }();
          })
          .setExtraHeaders({'Authorization': 'Bearer $normalized'})
          .build(),
    );

    _socket!.onConnect((_) {
      _isConnected = true;
      debugPrint('🔌 Socket bağlandı: ${_socket!.id}');
      if (!_connectedController.isClosed) {
        _connectedController.add(null);
      }
    });

    _socket!.onDisconnect((_) {
      _isConnected = false;
      debugPrint('🔌 Socket koptu');
    });

    _socket!.onReconnect((_) {
      _isConnected = true;
      debugPrint('🔌 Socket yeniden bağlandı');
      if (!_connectedController.isClosed) {
        _connectedController.add(null);
      }
    });

    // Başka cihazdan giriş veya sunucu çıkışı — istemci oturumu kapatmalı
    _socket!.on('auth:session_ended', (data) {
      debugPrint('📥 auth:session_ended: $data');
      final until = _ignoreSessionEndedBefore;
      if (until != null && DateTime.now().isBefore(until)) {
        debugPrint('auth:session_ended yok sayıldı (yeni bağlantı sonrası koruma)');
        return;
      }
      var reason = 'other_device_login';
      if (data is Map) {
        final r = data['reason'];
        if (r != null) reason = r.toString();
      }
      onAuthSessionEnded?.call(reason);
    });

    _socket!.onConnectError((error) {
      _isConnected = false;
      _logSocketConnectError(error, isReconnect: false);
      _scheduleAuthFailureRecovery(error);
    });

    _socket!.onReconnectError((error) {
      _logSocketConnectError(error, isReconnect: true);
      _scheduleAuthFailureRecovery(error);
    });

    // ============================================================
    // SERVER → CLIENT EVENT DİNLEYİCİLERİ
    // ============================================================

    // Sürücü yolculuğu kabul etti
    _socket!.on('ride:accepted', (data) {
      debugPrint('📥 ride:accepted: $data');
      _rideAcceptedController.add(Map<String, dynamic>.from(data as Map));
    });

    // Sürücü konum güncellemesi (canlı takip)
    _socket!.on('driver:location:broadcast', (data) {
      _driverLocationController.add(Map<String, dynamic>.from(data as Map));
    });

    // Yolculuk durum güncellemesi
    _socket!.on('ride:status_update', (data) {
      debugPrint('📥 ride:status_update: $data');
      _rideStatusController.add(Map<String, dynamic>.from(data as Map));
    });

    // Yeni yolculuk isteği (sürücüye)
    _socket!.on('ride:new_request', (data) {
      debugPrint('📥 ride:new_request: $data');
      _newRideRequestController.add(Map<String, dynamic>.from(data as Map));
    });

    // Sürücü bulunamadı
    _socket!.on('ride:no_driver_found', (data) {
      debugPrint('📥 ride:no_driver_found: $data');
      final rideId = (data as Map)['rideId'] as String;
      _noDriverFoundController.add(rideId);
    });

    // Sürücü biniş noktasına vardı
    _socket!.on('ride:driver_arrived', (data) {
      debugPrint('📥 ride:driver_arrived: $data');
      final map = data is Map
          ? Map<String, dynamic>.from(data)
          : <String, dynamic>{'rideId': ''};
      _driverArrivedController.add(map);
    });

    // Yolculuk başladı
    _socket!.on('ride:started', (data) {
      debugPrint('📥 ride:started: $data');
      final rideId = (data as Map)['rideId'] as String;
      _rideStartedController.add(rideId);
    });

    // Yolculuk tamamlandı
    _socket!.on('ride:completed', (data) {
      debugPrint('📥 ride:completed: $data');
      _rideCompletedController.add(Map<String, dynamic>.from(data as Map));
    });

    // Yolculuk iptal edildi
    _socket!.on('ride:cancelled', (data) {
      debugPrint('📥 ride:cancelled: $data');
      _rideCancelledController.add(Map<String, dynamic>.from(data as Map));
    });

    // Sunucu gerçek yolculuk id (searching — müşteri temp id'yi günceller)
    _socket!.on('ride:searching', (data) {
      debugPrint('📥 ride:searching: $data');
      _rideSearchingController.add(Map<String, dynamic>.from(data as Map));
    });

    _socket!.on('ride:matching_progress', (data) {
      debugPrint('📥 ride:matching_progress: $data');
      if (data is Map) {
        _rideMatchingProgressController.add(Map<String, dynamic>.from(data));
      }
    });

    // Müşteri ararken iptal — sürücüdeki bekleyen istek kalktı
    _socket!.on('ride:request_cancelled', (data) {
      debugPrint('📥 ride:request_cancelled: $data');
      _rideRequestCancelledController.add(Map<String, dynamic>.from(data as Map));
    });

    // Bağlantı / reconnect sonrası aktif yolculuk snapshot'ı
    _socket!.on('ride:snapshot', (data) {
      debugPrint('📥 ride:snapshot: $data');
      if (data is Map) {
        _rideSnapshotController.add(Map<String, dynamic>.from(data));
      }
    });

    _socket!.on('ride:pickup_code_result', (data) {
      debugPrint('📥 ride:pickup_code_result: $data');
      if (data is Map) {
        _pickupCodeResultController.add(Map<String, dynamic>.from(data));
      }
    });

    _socket!.on('ride:start_rejected', (data) {
      debugPrint('📥 ride:start_rejected: $data');
      if (data is Map) {
        _rideStartRejectedController.add(Map<String, dynamic>.from(data));
      }
    });

    _socket!.on('ride:reveal_location', (data) {
      debugPrint('📥 ride:reveal_location: $data');
      if (data is Map) {
        _rideRevealLocationController.add(Map<String, dynamic>.from(data));
      }
    });

    _socket!.on('ride:accept_failed', (data) {
      debugPrint('📥 ride:accept_failed: $data');
      if (data is Map) {
        _rideAcceptFailedController.add(Map<String, dynamic>.from(data));
      }
    });

    _socket!.on('driver:online_blocked', (data) {
      debugPrint('📥 driver:online_blocked: $data');
      if (data is Map) {
        _driverOnlineBlockedController.add(Map<String, dynamic>.from(data));
      }
    });

    _socket!.on('driver:forced_offline', (data) {
      debugPrint('📥 driver:forced_offline: $data');
      if (data is Map) {
        _driverForcedOfflineController.add(Map<String, dynamic>.from(data));
      }
    });

    _socket!.on('driver:online_confirmed', (data) {
      debugPrint('📥 driver:online_confirmed: $data');
      if (data is Map) {
        _driverOnlineConfirmedController.add(Map<String, dynamic>.from(data));
      } else {
        _driverOnlineConfirmedController.add(const <String, dynamic>{});
      }
    });

    _socket!.on('ride:complete_failed', (data) {
      debugPrint('📥 ride:complete_failed: $data');
      if (data is Map) {
        _rideCompleteFailedController.add(Map<String, dynamic>.from(data));
      }
    });

  }

  Future<String?> _resolveJwtForHandshake() async {
    try {
      final fromReader = await accessTokenProvider?.call();
      if (fromReader != null && fromReader.trim().isNotEmpty) {
        return _stripBearerPrefix(fromReader);
      }
    } catch (e) {
      debugPrint('Socket accessTokenProvider hatası: $e');
    }
    final cached = _lastToken;
    if (cached != null && cached.isNotEmpty) return cached;
    return null;
  }

  /// Polling / websocket motoru bir sonraki HTTP isteğinde güncel Authorization göndersin diye
  void _syncManagerExtraHeaders(String bearerBodyJwt) {
    final s = _socket;
    if (s == null) return;
    final opts = s.io.options;
    if (opts is! Map) return;
    opts['extraHeaders'] = <String, dynamic>{
      'Authorization': 'Bearer $bearerBodyJwt',
    };
  }

  /// TCP / DNS — JWT yenileme işe yaramaz; [onConnectAuthFailure] tetiklenmez.
  bool _looksLikeTransportFailure(Object? error) {
    final s = '$error'.toLowerCase();
    return s.contains('connection refused') ||
        s.contains('connection reset') ||
        s.contains('connection timed out') ||
        s.contains('network is unreachable') ||
        s.contains('failed host lookup') ||
        s.contains('socketexception') ||
        s.contains('host lookup failed');
  }

  void _logSocketConnectError(Object? error, {required bool isReconnect}) {
    final tag = isReconnect ? 'reconnect' : 'bağlantı';
    if (_looksLikeTransportFailure(error)) {
      final now = DateTime.now();
      final last = _lastTransportErrorLog;
      if (last == null || now.difference(last) > const Duration(seconds: 10)) {
        _lastTransportErrorLog = now;
        debugPrint(
          '🔌 Socket ($tag): sunucuya ulaşılamıyor ($_serverOrigin). '
          'Backend çalışıyor mu? Admin → sunucu adresi / yerel için --dart-define=SERVER_ORIGIN=...',
        );
      }
      return;
    }
    debugPrint('🔌 Socket $tag hatası: $error');
  }

  void _scheduleAuthFailureRecovery(Object? error) {
    if (_looksLikeTransportFailure(error)) return;
    final kick = onConnectAuthFailure;
    if (kick == null) return;
    final now = DateTime.now();
    final last = _lastAuthFailureKick;
    if (last != null && now.difference(last) < const Duration(seconds: 2)) {
      return;
    }
    _lastAuthFailureKick = now;
    _authFailureRecoveryTimer?.cancel();
    _authFailureRecoveryTimer = Timer(const Duration(milliseconds: 500), () async {
      try {
        await kick();
      } catch (e) {
        debugPrint('onConnectAuthFailure hatası: $e');
      }
    });
  }

  /// Depoda "Bearer ..." veya çift prefix kayıtlıysa tek JWT'ye indirger
  String _stripBearerPrefix(String raw) {
    var s = raw.trim();
    while (s.toLowerCase().startsWith('bearer ')) {
      s = s.substring(7).trim();
    }
    return s;
  }

  // ============================================================
  // CLIENT → SERVER EVENT GÖNDERİCİLERİ
  // ============================================================

  /// Müşteri: Yolculuk iste
  void requestRide({
    required LatLng pickup,
    required LatLng dropoff,
    required String pickupAddress,
    required String dropoffAddress,
    required double estimatedPrice,
    required double distanceKm,
  }) {
    _emit('ride:request', {
      'pickup': pickup.toJson(),
      'dropoff': dropoff.toJson(),
      'pickupAddress': pickupAddress,
      'dropoffAddress': dropoffAddress,
      'estimatedPrice': estimatedPrice,
      'distanceKm': distanceKm,
    });
  }

  /// Sürücü: Yolculuğu kabul et
  void acceptRide(String rideId) {
    _emit('ride:accept', {'rideId': rideId});
  }

  /// Sürücü: Yolculuğu reddet
  void rejectRide(String rideId) {
    _emit('ride:reject', {'rideId': rideId});
  }

  /// Sürücü: Yolcunun söylediği 4 haneli biniş kodunu doğrula
  void verifyPickupCode(String rideId, String code) {
    _emit('ride:verify_pickup_code', {'rideId': rideId, 'code': code});
  }

  /// Sürücü: Biniş noktasına vardım
  void arrivedAtPickup(String rideId) {
    _emit('ride:arrived', {'rideId': rideId});
  }

  /// Sürücü: Yolculuğu başlat
  void startRide(String rideId) {
    _emit('ride:start', {'rideId': rideId});
  }

  /// Sürücü: Yolculuğu tamamla
  void completeRide(String rideId, {double? finalPrice}) {
    _emit('ride:complete', {'rideId': rideId, 'finalPrice': finalPrice});
  }

  /// Her iki taraf: Yolculuğu iptal et
  void cancelRide(String rideId, {String? reason}) {
    _emit('ride:cancel', {'rideId': rideId, 'reason': reason ?? 'İptal edildi.'});
  }

  /// Sürücü: Çevrimiçi ol.
  ///
  /// Socket bağlı değilse otomatik olarak bağlantı kurulur ve event ilk
  /// bağlantı kurulduğu anda gönderilir. Çağıran taraf [waitForConfirmation]
  /// ile sunucudan `driver:online_confirmed` veya `driver:online_blocked`
  /// gelene kadar bekleyebilir.
  ///
  /// Dönüş: emit gerçekten kabloya yazıldıysa `true`.
  Future<bool> goOnline({
    Duration connectTimeout = const Duration(seconds: 8),
  }) async {
    return _emitWithConnect(
      'driver:go_online',
      const <String, dynamic>{},
      connectTimeout: connectTimeout,
    );
  }

  /// Sürücü: Çevrimdışı ol — bağlı değilse de denemeden vazgeçer.
  void goOffline() {
    _emit('driver:go_offline', {});
  }

  /// Sürücü: Konum güncelle (5 sn aralıkla)
  void updateLocation(double lat, double lng, {double bearing = 0}) {
    _emit('driver:location:update', {'lat': lat, 'lng': lng, 'bearing': bearing});
  }

  // ============================================================
  // YARDIMCI METODLAR
  // ============================================================

  void _emit(String event, Map<String, dynamic> data) {
    if (_socket != null && _isConnected) {
      _socket!.emit(event, data);
    } else {
      debugPrint('⚠️ Socket bağlı değil, event gönderilemedi: $event');
      // Bağlantı yoksa otomatik tekrar bağlan; UI, onConnected üzerinden
      // kritik state'i (ör. driver:go_online) yeniden göndermelidir.
      ensureConnected();
    }
  }

  /// Bağlantı yoksa önce bağlanmayı bekler, sonra event'i yazar.
  ///
  /// Yarış durumlarına karşı stream'e ilk önce abone olur, ardından bağlantıyı
  /// tetikler — böylece tam o anda gelen `onConnect` event'i kaçırılmaz.
  Future<bool> _emitWithConnect(
    String event,
    Map<String, dynamic> data, {
    required Duration connectTimeout,
  }) async {
    if (_socket != null && _isConnected) {
      _socket!.emit(event, data);
      return true;
    }

    // ÖNCE abone ol, SONRA bağlantı tetikle — `.first` broadcast stream'e
    // hemen abone olur, ensureConnected sırasında gelen olay kaçırılmaz.
    final connectedFuture = onConnected.first;
    Future<void>? guarded;
    try {
      guarded = connectedFuture.timeout(connectTimeout);
    } catch (_) {
      // teorik olarak buraya gelmez ama güvenli düş
    }

    final token = _lastToken;
    if (token == null || token.isEmpty) {
      debugPrint('_emitWithConnect: token yok, $event gönderilemiyor');
      guarded?.ignore();
      return false;
    }

    if (_socket == null) {
      connect(token);
    } else if (!_isConnected) {
      try {
        _socket!.connect();
      } catch (e) {
        debugPrint('_emitWithConnect connect hata: $e');
      }
    }

    // Tekrar kontrol — bu arada bağlandıysa beklemeye gerek yok
    if (_isConnected && _socket != null) {
      guarded?.ignore();
      _socket!.emit(event, data);
      return true;
    }

    try {
      await guarded;
    } on TimeoutException {
      debugPrint('_emitWithConnect: bağlantı zaman aşımı $event');
      return false;
    } catch (e) {
      debugPrint('_emitWithConnect: bağlantı hata $event: $e');
      return false;
    }

    if (_socket != null && _isConnected) {
      _socket!.emit(event, data);
      return true;
    }
    return false;
  }

  /// Uygulama arkaplandan döndüğünde ya da emit başarısız olduğunda
  /// aktif bağlantı yoksa son token ile yeniden bağlan.
  /// Zaten bağlıysa hiçbir şey yapmaz.
  void ensureConnected() {
    if (_isConnected && _socket != null) return;
    final token = _lastToken;
    if (token == null || token.isEmpty) {
      debugPrint('ensureConnected: token yok, bağlanamıyor');
      return;
    }
    final s = _socket;
    if (s != null) {
      debugPrint('ensureConnected: mevcut sokete connect() çağrılıyor');
      s.connect();
      return;
    }
    debugPrint('ensureConnected: yeni bağlantı kuruluyor');
    connect(token);
  }

  /// Bağlantıyı kapat
  void disconnect() {
    _ignoreSessionEndedBefore = null;
    _authFailureRecoveryTimer?.cancel();
    _authFailureRecoveryTimer = null;
    _lastAuthFailureKick = null;
    _lastTransportErrorLog = null;
    _socket?.disconnect();
    _socket?.dispose();
    _socket = null;
    _isConnected = false;
    _lastToken = null;
  }

  /// Tüm stream controller'ları kapat
  void dispose() {
    _authFailureRecoveryTimer?.cancel();
    _authFailureRecoveryTimer = null;
    disconnect();
    _connectedController.close();
    _rideAcceptedController.close();
    _driverLocationController.close();
    _rideStatusController.close();
    _newRideRequestController.close();
    _noDriverFoundController.close();
    _rideCompletedController.close();
    _rideCancelledController.close();
    _driverArrivedController.close();
    _rideStartedController.close();
    _rideSearchingController.close();
    _rideMatchingProgressController.close();
    _rideRequestCancelledController.close();
    _rideSnapshotController.close();
    _pickupCodeResultController.close();
    _rideStartRejectedController.close();
    _rideRevealLocationController.close();
    _rideAcceptFailedController.close();
    _driverOnlineBlockedController.close();
    _driverForcedOfflineController.close();
    _driverOnlineConfirmedController.close();
    _rideCompleteFailedController.close();
  }
}
