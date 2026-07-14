import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:geolocator/geolocator.dart';
import 'package:flutter/foundation.dart';
import '../../core/constants/app_constants.dart';
import '../../core/utils/location_permission_util.dart';
import '../../core/theme/app_theme.dart';
import '../../core/utils/map_marker_icons.dart';
import '../../core/widgets/breathing_dot.dart';
import '../../core/widgets/online_scan_bar.dart';
import '../../models/ride_model.dart' hide LatLng;
import '../../providers/providers.dart';
import '../../services/directions_service.dart';
import '../../services/driver_push_registration.dart';
import '../../services/driver_ride_request_fcm.dart';
import '../../services/ride_match_sound.dart';
import '../../services/ride_session_sync.dart';
import '../review/rate_ride_screen.dart';
import 'ride_request_dialog.dart';
import 'active_ride_panel.dart';

const _driverMapNightStyle = '''
[
  {"elementType":"geometry","stylers":[{"color":"#070b14"}]},
  {"elementType":"labels.text.stroke","stylers":[{"color":"#070b14"}]},
  {"elementType":"labels.text.fill","stylers":[{"color":"#8fa3bf"}]},
  {"featureType":"administrative","elementType":"labels.text.fill","stylers":[{"color":"#6f84a3"}]},
  {"featureType":"road","elementType":"geometry","stylers":[{"color":"#182235"}]},
  {"featureType":"road.arterial","elementType":"geometry","stylers":[{"color":"#22314a"}]},
  {"featureType":"road.highway","elementType":"geometry","stylers":[{"color":"#2a3f66"}]},
  {"featureType":"road.highway","elementType":"geometry.stroke","stylers":[{"color":"#162338"},{"weight":0.75}]},
  {"featureType":"road.highway.controlled_access","elementType":"geometry","stylers":[{"color":"#2f4570"}]},
  {"featureType":"road.highway.controlled_access","elementType":"geometry.stroke","stylers":[{"color":"#142032"},{"weight":0.8}]},
  {"featureType":"road","elementType":"labels.text.fill","stylers":[{"color":"#cdd9ea"}]},
  {"featureType":"water","elementType":"geometry","stylers":[{"color":"#0b1f3a"}]},
  {"featureType":"water","elementType":"labels.text.fill","stylers":[{"color":"#7fb3ff"}]},
  {"featureType":"landscape","elementType":"geometry","stylers":[{"color":"#1a2030"}]},
  {"featureType":"landscape.natural","elementType":"geometry","stylers":[{"color":"#1f2f24"}]},
  {"featureType":"poi.park","elementType":"geometry","stylers":[{"color":"#244231"}]},
  {"featureType":"poi.business","stylers":[{"visibility":"off"}]},
  {"featureType":"poi.attraction","stylers":[{"visibility":"off"}]},
  {"featureType":"poi.school","stylers":[{"visibility":"off"}]},
  {"featureType":"poi.medical","stylers":[{"visibility":"off"}]},
  {"featureType":"transit","stylers":[{"visibility":"off"}]}
]
''';

/// Sürücü ana ekranı — harita + üst durum çubuğu + büyük online toggle.
class DriverHomeScreen extends ConsumerStatefulWidget {
  const DriverHomeScreen({super.key});

  @override
  ConsumerState<DriverHomeScreen> createState() => _DriverHomeScreenState();
}

class _DriverHomeScreenState extends ConsumerState<DriverHomeScreen>
    with WidgetsBindingObserver, TickerProviderStateMixin {
  static const _panelSurface = Color(0xFF0F172A);
  static const _panelElevated = Color(0xFF1E293B);
  static const _panelBorder = Color(0xFF334155);
  static const _textOnDark = Color(0xFFE2E8F0);
  static const _textOnDarkMuted = Color(0xFF94A3B8);
  static const _statusOnlineDark = Color(0xFF166534);
  static const _statusOfflineGray = Color(0xFF9CA3AF);

  GoogleMapController? _mapController;
  LatLng _currentPosition =
      const LatLng(AppConstants.defaultLat, AppConstants.defaultLng);
  bool _locationLoading = true;
  StreamSubscription<Position>? _positionStreamSub;

  /// Online olduğunda butonun etrafında yavaşça atan halka animasyonu
  late final AnimationController _ringCtrl;

  // Harita rota/marker durumu
  final Set<Marker> _markers = {};
  final Set<Polyline> _polylines = {};
  BitmapDescriptor? _pickupIcon;
  BitmapDescriptor? _dropoffIcon;
  late final DirectionsService _directionsService;
  String? _lastRouteKey; // aynı hedefe tekrar API atmayı önler

  // Socket dinleyici abonelikleri
  StreamSubscription? _newRideRequestSub;
  StreamSubscription? _rideStatusSub;
  StreamSubscription? _rideCancelledSub;
  StreamSubscription? _rideCompletedSub;
  StreamSubscription? _rideRequestCancelledSub;
  StreamSubscription? _connectedSub;
  StreamSubscription? _rideSnapshotSub;
  StreamSubscription? _rideStartedSub;
  StreamSubscription? _driverArrivedSub;
  StreamSubscription? _pickupCodeResultSub;
  StreamSubscription? _rideStartRejectedSub;
  StreamSubscription? _rideRevealLocationSub;
  StreamSubscription? _rideAcceptFailedSub;
  StreamSubscription? _driverOnlineBlockedSub;
  StreamSubscription? _driverForcedOfflineSub;
  StreamSubscription? _rideCompleteFailedSub;
  OverlayEntry? _toastEntry;
  Timer? _toastTimer;

  /// Kabul düğmesine basıldıktan sonra sunucunun `ride:reveal_location` ile tamamlaması için bağlam
  Map<String, dynamic>? _pendingAcceptContext;

  /// `ride:accept` sunucuya gönderildiyse — timeout ile gelen `ride:request_cancelled`
  /// `_pendingAcceptContext`'i silmesin; aksi halde `ride:reveal_location` boşa düşer (siyah ekran).
  String? _acceptEmittedRideId;

  /// Gelen talep diyaloğu — yalnızca bu context ile kapat (rootNavigator maybePop ana rotayı siler).
  BuildContext? _rideRequestDialogContext;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      DriverPushRegistration.ensureRegisteredForDriver(ref);
      await ref.read(currentUserProvider.notifier).refreshProfileFromApi();
      if (!mounted) return;
      if (ref.read(isDriverOnlineProvider)) {
        _startLocationUpdates();
        _ringCtrl.repeat();
      }
    });
    WidgetsBinding.instance.addObserver(this);
    _ringCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 2200),
    );
    _directionsService = DirectionsService(AppConstants.googleMapsApiKey);
    MapMarkerIcons.loadUserLocationMarker().then((icon) {
      if (!mounted) return;
      setState(() => _pickupIcon = icon);
      _rebuildMarkers();
    });
    MapMarkerIcons.loadDropoffMarker().then((icon) {
      if (!mounted) return;
      setState(() => _dropoffIcon = icon);
      _rebuildMarkers();
    });
    _getCurrentLocation();
    _setupSocketListeners();
    DriverRideRequestFcm.install(ref);
    // Socket henüz hazır değilken REST ile de restore dene
    _restoreActiveRideFromApi();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _positionStreamSub?.cancel();
    _newRideRequestSub?.cancel();
    _rideStatusSub?.cancel();
    _rideCancelledSub?.cancel();
    _rideCompletedSub?.cancel();
    _rideRequestCancelledSub?.cancel();
    _connectedSub?.cancel();
    _rideSnapshotSub?.cancel();
    _rideStartedSub?.cancel();
    _driverArrivedSub?.cancel();
    _pickupCodeResultSub?.cancel();
    _rideStartRejectedSub?.cancel();
    _rideRevealLocationSub?.cancel();
    _rideAcceptFailedSub?.cancel();
    _driverOnlineBlockedSub?.cancel();
    _driverForcedOfflineSub?.cancel();
    _rideCompleteFailedSub?.cancel();
    _toastTimer?.cancel();
    _toastEntry?.remove();
    _ringCtrl.dispose();
    _mapController?.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    super.didChangeAppLifecycleState(state);
    if (state == AppLifecycleState.resumed) {
      ref.read(socketServiceProvider).ensureConnected();
      // Snapshot reconnect ile zaten gelir; REST ile ek güvence
      _restoreActiveRideFromApi();
      unawaited((() async {
        await ref.read(currentUserProvider.notifier).refreshProfileFromApi();
        if (!mounted) return;
        if (ref.read(isDriverOnlineProvider)) {
          _startLocationUpdates();
          _ringCtrl.repeat();
        } else {
          _stopLocationUpdates();
          _ringCtrl.stop();
          _ringCtrl.reset();
        }
      })());
    }
  }

  Future<void> _getCurrentLocation() async {
    try {
      final permission = await requestForegroundLocationPermission();
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        setState(() => _locationLoading = false);
        return;
      }
      final position = await Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.high,
      );
      if (!mounted) return;
      setState(() {
        _currentPosition = LatLng(position.latitude, position.longitude);
        _locationLoading = false;
      });
      _rebuildMarkers();
      _mapController?.animateCamera(
          CameraUpdate.newLatLngZoom(_currentPosition, 14.5));
    } catch (e) {
      if (!mounted) return;
      setState(() => _locationLoading = false);
      debugPrint('Konum hatası: $e');
    }
  }

  void _setupSocketListeners() {
    final socket = ref.read(socketServiceProvider);

    _connectedSub = socket.onConnected.listen((_) {
      if (!mounted) return;
      final isOnline = ref.read(isDriverOnlineProvider);
      if (!isOnline) return;
      final bal = ref.read(currentUserProvider)?.balanceTcoin;
      final minOnline = ref.read(platformConfigProvider).minDriverOnlineBalanceTcoin;
      if (bal != null && bal < minOnline) {
        _setDriverOfflineLocally(
          snackMessage:
              'Yetersiz T Coin — çevrimdışısın. En az $minOnline T Coin gerekir.',
        );
        return;
      }
      debugPrint('🔁 Soket yeniden bağlandı — driver:go_online tekrar gönderiliyor');
      unawaited(socket.goOnline());
    });

    _rideRevealLocationSub = socket.onRideRevealLocation.listen((data) {
      if (!mounted) return;
      final ctx = _pendingAcceptContext;
      final rideId = data['rideId'] as String? ?? '';
      if (rideId.isEmpty || ctx == null) return;
      if ((ctx['rideId'] as String?) != rideId) return;
      _pendingAcceptContext = null;
      _acceptEmittedRideId = null;

      final pickup = data['pickup'] as Map<String, dynamic>?;
      final dropoff = data['dropoff'] as Map<String, dynamic>?;
      final bal = (data['balanceTcoin'] as num?)?.toDouble();
      final pin = data['pickupVerificationCode'] as String?;
      final myId = ref.read(currentUserProvider)?.id ?? '';
      final cust = ctx['customerInfo'];
      final custMap =
          cust is Map ? Map<String, dynamic>.from(cust) : null;

      ref.read(activeRideProvider.notifier).setRide(
            RideModel(
              id: rideId,
              customerId: (custMap?['id'] as String?) ??
                  (ctx['customerId'] as String? ?? ''),
              customerName: custMap?['fullName'] as String?,
              customerPhone: custMap?['phone'] as String?,
              customerRating: (custMap?['rating'] as num?)?.toDouble(),
              driverId: myId,
              pickupAddress: ctx['pickupAddress'] as String? ??
                  ctx['pickup']?['address'] as String? ??
                  'Biniş Noktası',
              dropoffAddress: ctx['dropoffAddress'] as String? ??
                  ctx['dropoff']?['address'] as String? ??
                  'İniş Noktası',
              estimatedPrice: (ctx['estimatedPrice'] as num?)?.toDouble() ??
                  (ctx['price'] as num?)?.toDouble() ??
                  0,
              distanceKm: (ctx['distanceKm'] as num?)?.toDouble(),
              status: RideStatus.accepted,
              pickupLat: (pickup?['lat'] as num?)?.toDouble(),
              pickupLng: (pickup?['lng'] as num?)?.toDouble(),
              dropoffLat: (dropoff?['lat'] as num?)?.toDouble(),
              dropoffLng: (dropoff?['lng'] as num?)?.toDouble(),
              pickupVerificationCode: pin,
            ),
          );
      if (bal != null) {
        final cur = ref.read(currentUserProvider);
        if (cur != null) {
          final updated = cur.copyWith(balanceTcoin: bal);
          ref.read(currentUserProvider.notifier).updateUser(updated);
          ref.read(storageServiceProvider).saveUser(updated);
        }
        _showSnackBar(
          'Yolculuk kabul edildi. Kalan: ${bal.toStringAsFixed(0)} T Coin',
          AppTheme.success,
        );
      } else {
        _showSnackBar('Yolculuk kabul edildi! Biniş noktasına git.',
            AppTheme.success);
      }
      _refreshActiveRideRoute();
    });

    _rideAcceptFailedSub = socket.onRideAcceptFailed.listen((data) {
      if (!mounted) return;
      final rideId = data['rideId'] as String? ?? '';
      final ctx = _pendingAcceptContext;
      if (rideId.isNotEmpty && ctx != null && ctx['rideId'] == rideId) {
        _pendingAcceptContext = null;
        _acceptEmittedRideId = null;
      }
      final msg = data['message'] as String? ?? 'Kabul edilemedi.';
      _showSnackBar(msg, AppTheme.errorColor);
    });

    _newRideRequestSub = socket.onNewRideRequest.listen((data) async {
      if (!mounted) return;
      await _presentIncomingRideRequest(data);
    });

    _rideCancelledSub = socket.onRideCancelled.listen((_) {
      if (!mounted) return;
      ref.read(activeRideProvider.notifier).clear();
      ref.read(pendingRideRequestProvider.notifier).state = null;
      _clearRoute();
      _showSnackBar('Yolculuk iptal edildi.', AppTheme.errorColor);
    });

    _rideRequestCancelledSub = socket.onRideRequestCancelled.listen((data) {
      if (!mounted) return;
      final rideId = data['rideId'] as String? ?? '';
      if (rideId.isEmpty) return;

      final pending = ref.read(pendingRideRequestProvider);
      final pendingId = pending?['rideId'] as String?;
      final acceptCtx = _pendingAcceptContext;
      final matchesPending = pendingId == rideId;
      final matchesAcceptCtx =
          acceptCtx != null && acceptCtx['rideId'] == rideId;
      if (!matchesPending && !matchesAcceptCtx) return;

      if (matchesAcceptCtx) {
        if (_acceptEmittedRideId != rideId) {
          _pendingAcceptContext = null;
        }
      }
      if (matchesPending) {
        ref.read(pendingRideRequestProvider.notifier).state = null;
      }

      _closeRideRequestDialogIfOpen();

      final reason = data['reason'] as String?;
      final serverMsg = data['message'] as String?;
      final msg = serverMsg?.trim().isNotEmpty == true
          ? serverMsg!.trim()
          : reason == 'no_driver'
              ? 'Bu çağrı için müsait sürücü bulunamadı; istek kapatıldı.'
              : reason == 'accept_failed'
                  ? 'Bu çağrı artık kabul edilemiyor.'
                  : 'İstek iptal edildi veya süresi doldu.';
      _showSnackBar(msg, AppTheme.offlineColor);
    });

    _rideCompletedSub = socket.onRideCompleted.listen((data) async {
      if (!mounted) return;
      final eventRideId = (data['rideId'] as String? ?? '').trim();
      final price = (data['finalPrice'] as num?)?.toDouble();
      final completedRide = ref.read(activeRideProvider);
      RideModel? reviewRide = completedRide;
      ref.read(activeRideProvider.notifier).clear();
      _clearRoute();
      _showSnackBar(
        'Yolculuk tamamlandı! Kazanç: ${price?.toStringAsFixed(0) ?? '?'} ₺',
        AppTheme.success,
      );
      var reviewedId = completedRide?.customerId ?? '';
      final rideIdForFetch = completedRide?.id.isNotEmpty == true
          ? completedRide!.id
          : eventRideId;
      if ((reviewedId.isEmpty || reviewRide == null) && rideIdForFetch.isNotEmpty) {
        try {
          final api = ref.read(apiServiceProvider);
          final res = await api.getRide(rideIdForFetch);
          final body = res.data;
          if (body is Map && body['success'] == true) {
            final payload = body['data'];
            if (payload is Map) {
              reviewedId = (payload['customer_id'] ?? payload['customerId'] ?? '').toString();
              final m = Map<String, dynamic>.from(payload);
              if (reviewRide == null) {
                reviewRide = RideModel.fromJson(m).copyWith(
                  finalPrice: (data['finalPrice'] as num?)?.toDouble(),
                  status: RideStatus.completed,
                );
              }
            }
          }
        } catch (_) {
          // Fallback: reviewedId boş kalırsa ekran açılmayacak.
        }
      }
      if (reviewRide != null && reviewedId.isNotEmpty) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (!mounted) return;
          Navigator.of(context).push(
            MaterialPageRoute<void>(
              builder: (_) => RateRideScreen(
                ride: reviewRide!,
                reviewedId: reviewedId,
                titleText: 'Yolcu deneyimi nasıldı?',
                subtitleText: 'Yolcunuzu değerlendirin',
                successText: 'Yolcu değerlendirmesi kaydedildi.',
              ),
            ),
          );
        });
      }
    });

    // Aktif yolculuk snapshot'ı (reconnect / uygulama açılışı)
    _rideSnapshotSub = socket.onRideSnapshot.listen((data) {
      if (!mounted) return;
      _applyRideSnapshot(data);
    });

    // Yolculuk başladı — sürücü tarafında da durum güncellenir
    _rideStartedSub = socket.onRideStarted.listen((rideId) {
      if (!mounted) return;
      final cur = ref.read(activeRideProvider);
      if (cur != null && cur.id == rideId) {
        ref.read(activeRideProvider.notifier).updateStatus(RideStatus.inProgress);
      }
    });

    // Sürücü vardı onayı — durum geçişi yansıt
    _driverArrivedSub = socket.onDriverArrived.listen((payload) {
      if (!mounted) return;
      final rideId = payload['rideId'] as String? ?? '';
      if (rideId.isEmpty) return;
      final cur = ref.read(activeRideProvider);
      if (cur != null &&
          cur.id == rideId &&
          (cur.status == RideStatus.accepted ||
              cur.status == RideStatus.arriving)) {
        ref.read(activeRideProvider.notifier).updateStatus(RideStatus.arriving);
      }
    });

    // Sunucudan tek yönlü durum güncellemesi (snapshot sonrası ince sync)
    _rideStatusSub = socket.onRideStatus.listen((data) {
      if (!mounted) return;
      final rideId = data['rideId'] as String? ?? '';
      final statusStr = data['status'] as String? ?? '';
      if (rideId.isEmpty || statusStr.isEmpty) return;
      final cur = ref.read(activeRideProvider);
      if (cur == null || cur.id != rideId) return;
      ref.read(activeRideProvider.notifier).updateStatus(RideStatus.fromString(statusStr));
    });

    _pickupCodeResultSub = socket.onPickupCodeResult.listen((data) {
      if (!mounted) return;
      final rideId = data['rideId'] as String? ?? '';
      final ok = data['ok'] == true;
      final cur = ref.read(activeRideProvider);
      if (rideId.isEmpty || cur == null || cur.id != rideId) return;
      if (ok) {
        ref.read(activeRideProvider.notifier).setPickupCodeVerified(true);
        // Kod doğrulaması başarılıysa sürücü tarafında yolculuğu otomatik başlat.
        ref.read(socketServiceProvider).startRide(rideId);
        _showSnackBar(
          'Kod doğrulandı. Yolculuk otomatik başlatılıyor...',
          AppTheme.success,
        );
      } else {
        final msg = data['message'] as String? ?? 'Kod hatalı, lütfen tekrar deneyin.';
        _showSnackBar(msg, AppTheme.errorColor);
      }
    });

    _rideStartRejectedSub = socket.onRideStartRejected.listen((data) {
      if (!mounted) return;
      final rideId = data['rideId'] as String? ?? '';
      final msg = data['message'] as String? ??
          'Yolculuk başlatılamadı. Kodu doğruladığından emin ol.';
      final cur = ref.read(activeRideProvider);
      if (rideId.isEmpty || cur == null || cur.id != rideId) return;
      _showSnackBar(msg, AppTheme.errorColor);
    });

    _driverOnlineBlockedSub = socket.onDriverOnlineBlocked.listen((data) {
      if (!mounted) return;
      final minO = ref.read(platformConfigProvider).minDriverOnlineBalanceTcoin;
      final msg = data['message'] as String? ??
          'Çevrimiçi olmak için en az $minO T Coin gerekir.';
      _setDriverOfflineLocally(snackMessage: msg);
    });

    _driverForcedOfflineSub = socket.onDriverForcedOffline.listen((data) {
      if (!mounted) return;
      final msg = data['message'] as String? ??
          'Bakiye yetersiz — çevrimdışı yapıldı.';
      _setDriverOfflineLocally(snackMessage: msg);
      ref.read(currentUserProvider.notifier).refreshProfileFromApi();
    });

    _rideCompleteFailedSub = socket.onRideCompleteFailed.listen((data) {
      if (!mounted) return;
      final msg = (data['message'] as String?)?.trim();
      _showSnackBar(
        msg?.isNotEmpty == true ? msg! : 'Yolculuk tamamlanamadı, tekrar dene.',
        AppTheme.errorColor,
      );
    });
  }

  /// Çevrimiçi toggle / sunucu — yerelde çevrimdışı UI ve konum gönderimini durdurur.
  void _setDriverOfflineLocally({String? snackMessage, bool showSnack = true}) {
    ref.read(socketServiceProvider).goOffline();
    ref.read(isDriverOnlineProvider.notifier).state = false;
    _stopLocationUpdates();
    _ringCtrl.stop();
    _ringCtrl.reset();
    if (mounted && showSnack && (snackMessage ?? '').isNotEmpty) {
      _showSnackBar(snackMessage!, AppTheme.errorColor);
    }
  }

  /// Snapshot payload'ını state'e uygular — sürücü yolculuğa kaldığı yerden devam eder.
  void _applyRideSnapshot(Map<String, dynamic> data) {
    final existing = ref.read(activeRideProvider);
    ref.read(rideSessionSyncProvider).applyDriverRideSnapshot(data);
    final ride = ref.read(activeRideProvider);
    if (ride == null || !ride.isActive) return;
    if (existing?.status != ride.status ||
        existing?.pickupLat != ride.pickupLat ||
        existing?.dropoffLat != ride.dropoffLat) {
      _refreshActiveRideRoute();
    }
  }

  /// Uygulama açılışında REST ile aktif yolculuğu restore et (socket gecikirse).
  Future<void> _restoreActiveRideFromApi() async {
    final existing = ref.read(activeRideProvider);
    await ref.read(rideSessionSyncProvider).restoreDriverActiveRideFromApi();
    if (!mounted) return;
    final ride = ref.read(activeRideProvider);
    if (ride == null || !ride.isActive) return;
    if (existing?.status != ride.status ||
        existing?.pickupLat != ride.pickupLat ||
        existing?.dropoffLat != ride.dropoffLat) {
      _refreshActiveRideRoute();
    }
  }

  bool _onlineTogglePending = false;

  Future<void> _toggleOnline(bool value) async {
    if (_onlineTogglePending) return;
    setState(() => _onlineTogglePending = true);
    try {
      final socket = ref.read(socketServiceProvider);
      if (value) {
        var bal = ref.read(currentUserProvider)?.balanceTcoin;
        if (bal == null) {
          await ref.read(currentUserProvider.notifier).refreshProfileFromApi();
          if (!mounted) return;
          bal = ref.read(currentUserProvider)?.balanceTcoin;
        }
        final minOnline =
            ref.read(platformConfigProvider).minDriverOnlineBalanceTcoin;
        if ((bal ?? 0) < minOnline) {
          if (!mounted) return;
          _showSnackBar(
            'Çevrimiçi olmak için en az $minOnline T Coin gerekir.',
            AppTheme.errorColor,
          );
          return;
        }

        // socket.goOnline() içinde bağlantı yoksa önce bağlanma beklenir.
        // Yarış durumu olmaması için stream aboneliği aynı çağrı içinde
        // bağlantı tetikleyiciden ÖNCE yapılır (socket_service.dart).
        final ok = await socket.goOnline(
          connectTimeout: const Duration(seconds: 8),
        );
        if (!ok) {
          if (!mounted) return;
          _showSnackBar(
            'Sunucuya bağlanılamadı. İnternet bağlantını kontrol et.',
            AppTheme.errorColor,
          );
          return;
        }

        // Sunucudan onay (driver:online_confirmed) veya engelleme
        // (driver:online_blocked) bekle — engelse local state false kalır.
        Map<String, dynamic>? confirmation;
        try {
          confirmation = await Future.any<Map<String, dynamic>>([
            socket.onDriverOnlineConfirmed.first,
            socket.onDriverOnlineBlocked.first.then((b) => <String, dynamic>{
                  '__blocked': true,
                  ...b,
                }),
          ]).timeout(const Duration(seconds: 6));
        } on TimeoutException {
          confirmation = null;
        } catch (_) {
          confirmation = null;
        }

        if (!mounted) return;

        if (confirmation != null && confirmation['__blocked'] == true) {
          // online_blocked stream'i ayrıca _driverOnlineBlockedSub
          // tarafından dinleniyor; ayrıca state'i de güvenli temizlesin diye
          // burada local'i de offline tutuyoruz.
          _setDriverOfflineLocally(showSnack: false);
          return;
        }

        // confirmation null olsa bile bizden state'i true yapmamızı bekle:
        // sunucu onayı gelmeden hemen UI'yi açmak yerine, optimistic ama
        // sunucu yan etkisini olabildiğince doğrulayan bir akış izliyoruz.
        ref.read(isDriverOnlineProvider.notifier).state = true;
        _startLocationUpdates();
        _ringCtrl.repeat();
        _showSnackBar(
          confirmation == null
              ? 'Çevrimiçisin — sunucu yanıtı beklenmeden açıldı'
              : 'Çevrimiçisin — istek bekleniyor',
          AppTheme.success,
        );
      } else {
        socket.goOffline();
        ref.read(isDriverOnlineProvider.notifier).state = false;
        _stopLocationUpdates();
        _ringCtrl.stop();
        _ringCtrl.reset();
        _showSnackBar('Çevrimdışısın.', AppTheme.offlineColor);
      }
    } finally {
      if (mounted) setState(() => _onlineTogglePending = false);
    }
  }

  void _startLocationUpdates() {
    _positionStreamSub?.cancel();

    late LocationSettings locationSettings;
    if (defaultTargetPlatform == TargetPlatform.android) {
      locationSettings = AndroidSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: 10,
        forceLocationManager: true,
        intervalDuration: Duration(milliseconds: AppConstants.locationUpdateIntervalMs),
        foregroundNotificationConfig: const ForegroundNotificationConfig(
          notificationText: "Arka planda konum takip ediliyor",
          notificationTitle: "Taksim Gelsin",
          enableWakeLock: true,
        ),
      );
    } else if (defaultTargetPlatform == TargetPlatform.iOS) {
      locationSettings = AppleSettings(
        accuracy: LocationAccuracy.high,
        activityType: ActivityType.automotiveNavigation,
        distanceFilter: 10,
        pauseLocationUpdatesAutomatically: false,
        showBackgroundLocationIndicator: true,
      );
    } else {
      locationSettings = const LocationSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: 10,
      );
    }

    _positionStreamSub = Geolocator.getPositionStream(locationSettings: locationSettings).listen(
      (Position position) {
        if (!mounted) return;
        _currentPosition = LatLng(position.latitude, position.longitude);
        _rebuildMarkers();
        final socket = ref.read(socketServiceProvider);
        socket.updateLocation(
          position.latitude,
          position.longitude,
          bearing: position.heading,
        );
      },
      onError: (e) {
        debugPrint('Konum dinleme hatası: $e');
      },
    );

    _sendInitialLocation();
  }

  void _stopLocationUpdates() {
    _positionStreamSub?.cancel();
    _positionStreamSub = null;
  }

  Future<void> _sendInitialLocation() async {
    try {
      final position = await Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.high,
      );
      if (!mounted) return;
      setState(() {
        _currentPosition = LatLng(position.latitude, position.longitude);
      });
      _rebuildMarkers();
      final socket = ref.read(socketServiceProvider);
      socket.updateLocation(
        position.latitude,
        position.longitude,
        bearing: position.heading,
      );
    } catch (e) {
      debugPrint('İlk konum hatası: $e');
    }
  }

  Future<void> _presentIncomingRideRequest(
    Map<String, dynamic> data, {
    bool fromFcm = false,
  }) async {
    final me = ref.read(currentUserProvider)?.id;
    final target =
        (data['targetDriverId'] ?? data['forUserId']) as String? ?? '';
    if (me != null && target.isNotEmpty && target != me) {
      return;
    }

    if (!fromFcm) {
      if (!ref.read(isDriverOnlineProvider)) return;
    } else {
      ref.read(socketServiceProvider).ensureConnected();
    }

    final active = ref.read(activeRideProvider);
    if (active != null && active.isActive) return;
    if (ref.read(pendingRideRequestProvider) != null) return;

    await RideMatchSound.playMatchAlert();
    if (!mounted) return;
    ref.read(pendingRideRequestProvider.notifier).state = data;
    _showRideRequestDialog(data);
  }

  void _closeRideRequestDialogIfOpen() {
    final dCtx = _rideRequestDialogContext;
    _rideRequestDialogContext = null;
    if (dCtx != null && dCtx.mounted) {
      Navigator.of(dCtx, rootNavigator: true).pop();
    }
  }

  void _showRideRequestDialog(Map<String, dynamic> data) {
    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) {
        _rideRequestDialogContext = ctx;
        return RideRequestDialog(
          data: data,
          onAccept: () {
            _closeRideRequestDialogIfOpen();
            _acceptRide(data);
          },
          onReject: () {
            _closeRideRequestDialogIfOpen();
            _rejectRide(data);
          },
        );
      },
    );
  }

  void _acceptRide(Map<String, dynamic> data) {
    final rideId = data['rideId'] as String? ?? '';
    if (rideId.isEmpty) return;
    _pendingAcceptContext = Map<String, dynamic>.from(data);
    _acceptEmittedRideId = rideId;
    ref.read(socketServiceProvider).acceptRide(rideId);
    ref.read(pendingRideRequestProvider.notifier).state = null;
    // Gerçek biniş koordinatları ve kesinti — sunucu `ride:reveal_location` ile gelir
  }

  // ============================================================
  // ROTA & MARKER — sürücü haritası
  // ============================================================

  /// Aktif yolculuk durumuna göre hedefi belirler:
  /// - accepted/arriving → biniş noktası (mavi rota)
  /// - inProgress → iniş noktası (sarı rota)
  /// Hedef değişmedikçe tekrar Directions API çağrılmaz.
  Future<void> _refreshActiveRideRoute() async {
    final ride = ref.read(activeRideProvider);
    if (ride == null || !ride.isActive) {
      _clearRoute();
      return;
    }

    LatLng? target;
    final bool toPickup = ride.status == RideStatus.accepted ||
        ride.status == RideStatus.arriving;
    if (toPickup) {
      if (ride.pickupLat == null || ride.pickupLng == null) return;
      target = LatLng(ride.pickupLat!, ride.pickupLng!);
    } else if (ride.status == RideStatus.inProgress) {
      if (ride.dropoffLat == null || ride.dropoffLng == null) return;
      target = LatLng(ride.dropoffLat!, ride.dropoffLng!);
    } else {
      _clearRoute();
      return;
    }

    final origin = toPickup
        ? _currentPosition
        : LatLng(ride.pickupLat ?? _currentPosition.latitude,
            ride.pickupLng ?? _currentPosition.longitude);

    final key = '${toPickup ? 'p' : 'd'}:${target.latitude.toStringAsFixed(5)}'
        ',${target.longitude.toStringAsFixed(5)}';
    if (_lastRouteKey == key && _polylines.isNotEmpty) {
      _rebuildMarkers();
      return;
    }
    _lastRouteKey = key;

    final route = await _directionsService.getDirections(origin, target);
    if (!mounted) return;

    setState(() {
      _polylines
        ..clear()
        ..add(Polyline(
          polylineId: const PolylineId('driver_route'),
          points: route?.points ?? [origin, target!],
          color: toPickup ? AppTheme.accentColor : AppTheme.primaryColor,
          width: 6,
          geodesic: true,
          startCap: Cap.roundCap,
          endCap: Cap.roundCap,
          jointType: JointType.round,
        ));
    });
    _rebuildMarkers();
    _fitRouteBounds(origin, target);
  }

  void _rebuildMarkers() {
    if (!mounted) return;
    final ride = ref.read(activeRideProvider);
    final next = <Marker>{};

    if (ride != null && ride.isActive) {
      final bool toPickup = ride.status == RideStatus.accepted ||
          ride.status == RideStatus.arriving;
      if (toPickup && ride.pickupLat != null && ride.pickupLng != null) {
        next.add(Marker(
          markerId: const MarkerId('pickup'),
          position: LatLng(ride.pickupLat!, ride.pickupLng!),
          icon: _pickupIcon ??
              BitmapDescriptor.defaultMarkerWithHue(
                  BitmapDescriptor.hueGreen),
          anchor: const Offset(0.5, 0.5),
          infoWindow: InfoWindow(
            title: 'Yolcu',
            snippet: ride.pickupAddress,
          ),
        ));
      }
      if (!toPickup &&
          ride.status == RideStatus.inProgress &&
          ride.dropoffLat != null &&
          ride.dropoffLng != null) {
        next.add(Marker(
          markerId: const MarkerId('dropoff'),
          position: LatLng(ride.dropoffLat!, ride.dropoffLng!),
          icon: _dropoffIcon ??
              BitmapDescriptor.defaultMarkerWithHue(
                  BitmapDescriptor.hueAzure),
          anchor: const Offset(0.5, 0.5),
          infoWindow: InfoWindow(
            title: 'Varış',
            snippet: ride.dropoffAddress,
          ),
        ));
      }
    }

    // GoogleMap myLocation kapalı: SDK her girişte izin sormasın; konum Geolocator + marker ile.
    final meIcon = _pickupIcon ??
        BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueAzure);
    next.add(Marker(
      markerId: const MarkerId('driver_me'),
      position: _currentPosition,
      icon: meIcon,
      anchor: const Offset(0.5, 0.5),
      flat: true,
      infoWindow: const InfoWindow(title: 'Konumunuz'),
    ));

    setState(() {
      _markers
        ..clear()
        ..addAll(next);
    });
  }

  void _clearRoute() {
    _lastRouteKey = null;
    if (_polylines.isEmpty && _markers.isEmpty) return;
    setState(() {
      _polylines.clear();
      _markers.clear();
    });
    // Rota silindikten sonra en azından sürücü konumu marker'ı kalsın.
    _rebuildMarkers();
  }

  void _fitRouteBounds(LatLng a, LatLng b) {
    final sw = LatLng(
      a.latitude < b.latitude ? a.latitude : b.latitude,
      a.longitude < b.longitude ? a.longitude : b.longitude,
    );
    final ne = LatLng(
      a.latitude > b.latitude ? a.latitude : b.latitude,
      a.longitude > b.longitude ? a.longitude : b.longitude,
    );
    _mapController?.animateCamera(
      CameraUpdate.newLatLngBounds(
        LatLngBounds(southwest: sw, northeast: ne),
        90,
      ),
    );
  }

  void _rejectRide(Map<String, dynamic> data) {
    final rideId = data['rideId'] as String? ?? '';
    if (rideId.isEmpty) return;
    final socket = ref.read(socketServiceProvider);
    socket.rejectRide(rideId);
    ref.read(pendingRideRequestProvider.notifier).state = null;
  }

  void _showSnackBar(String message, Color color) {
    if (!mounted) return;
    _toastTimer?.cancel();
    _toastEntry?.remove();

    final overlay = Overlay.of(context);
    final mq = MediaQuery.of(context);
    final top = mq.padding.top + 70;

    _toastEntry = OverlayEntry(
      builder: (_) => Positioned(
        top: top,
        left: 16,
        right: 16,
        child: IgnorePointer(
          ignoring: true,
          child: Material(
            color: Colors.transparent,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.94),
                borderRadius: BorderRadius.circular(12),
                boxShadow: const [
                  BoxShadow(
                    color: Color(0x55000000),
                    blurRadius: 14,
                    offset: Offset(0, 6),
                  ),
                ],
              ),
              child: Row(
                children: [
                  const Icon(Icons.info_outline_rounded, color: Colors.white, size: 18),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      message,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w700,
                        fontSize: 13.5,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );

    overlay.insert(_toastEntry!);
    _toastTimer = Timer(const Duration(seconds: 3), () {
      _toastEntry?.remove();
      _toastEntry = null;
    });
  }

  // ============================================================
  // BUILD
  // ============================================================
  @override
  Widget build(BuildContext context) {
    final isOnline = ref.watch(isDriverOnlineProvider);
    final activeRide = ref.watch(activeRideProvider);
    final user = ref.watch(currentUserProvider);

    ref.listen<Map<String, dynamic>?>(driverPendingFcmRideRequestProvider, (prev, next) {
      if (next == null || !mounted) return;
      ref.read(driverPendingFcmRideRequestProvider.notifier).state = null;
      unawaited(_presentIncomingRideRequest(next, fromFcm: true));
    });

    // Aktif yolculuk durumu değiştikçe rota/marker'ı yeniden çiz
    ref.listen<RideModel?>(activeRideProvider, (prev, next) {
      if (next == null || !next.isActive) {
        _clearRoute();
        return;
      }
      if (prev?.status != next.status ||
          prev?.pickupLat != next.pickupLat ||
          prev?.dropoffLat != next.dropoffLat) {
        _refreshActiveRideRoute();
      }
    });

    return Scaffold(
      body: Stack(
        children: [
          // Harita
          GoogleMap(
            initialCameraPosition:
                CameraPosition(target: _currentPosition, zoom: 14.5),
            onMapCreated: (controller) {
              _mapController = controller;
              controller.setMapStyle(_driverMapNightStyle);
              _refreshActiveRideRoute();
            },
            markers: _markers,
            polylines: _polylines,
            // true iken Google Maps SDK ayrıca konum izni tetikleyebilir (çıkış/giriş sonrası tekrar soru).
            myLocationEnabled: false,
            myLocationButtonEnabled: false,
            zoomControlsEnabled: false,
            mapToolbarEnabled: false,
            compassEnabled: false,
          ),

          // Hafif üst gradient — durum çubuğunun okunurluğu için
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            child: IgnorePointer(
              child: Container(
                height: MediaQuery.of(context).padding.top + 160,
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [
                      Colors.black.withOpacity(0.45),
                      Colors.transparent,
                    ],
                  ),
                ),
              ),
            ),
          ),

          // Üst çubuk (altında çevrimiçi tarayıcı bar)
          Positioned(
            top: MediaQuery.of(context).padding.top + 10,
            left: 16,
            right: 16,
            child: _buildTopBar(user, isOnline),
          ),

          // Yükleniyor
          if (_locationLoading)
            const Center(
              child: CircularProgressIndicator(color: AppTheme.primaryColor),
            ),

          // Alt panel — aktif yolculuk veya boşta
          Positioned.fill(
            child: AnimatedSwitcher(
              duration: const Duration(milliseconds: 360),
              switchInCurve: Curves.fastOutSlowIn,
              switchOutCurve: Curves.easeInCubic,
              transitionBuilder: (child, anim) => FadeTransition(
                opacity: anim,
                child: SlideTransition(
                  position: Tween<Offset>(
                    begin: const Offset(0, 0.08),
                    end: Offset.zero,
                  ).animate(anim),
                  child: child,
                ),
              ),
              child: activeRide != null && activeRide.isActive
                  ? KeyedSubtree(
                      key: ValueKey<String>('active-${activeRide.id}'),
                      child: Align(
                        alignment: Alignment.bottomCenter,
                        child: SizedBox(
                          width: MediaQuery.sizeOf(context).width,
                          child: ActiveRidePanel(ride: activeRide),
                        ),
                      ),
                    )
                  : Align(
                      key: const ValueKey('idle'),
                      alignment: Alignment.bottomCenter,
                      child: _buildBottomPanel(
                        isOnline,
                        onlineBusy: _onlineTogglePending,
                      ),
                    ),
            ),
          ),
        ],
      ),
    );
  }

  // ---------- TOP BAR ----------
  Widget _buildTopBar(dynamic user, bool isOnline) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        _buildTopBarRow(user, isOnline),
        const SizedBox(height: 8),
        ClipRRect(
          borderRadius: BorderRadius.circular(999),
          child: OnlineScanBar(active: isOnline, color: AppTheme.success),
        ),
      ],
    );
  }

  Widget _buildTopBarRow(dynamic user, bool isOnline) {
    return Row(
      children: [
        // Profil — hero
        Hero(
          tag: AppTheme.brandHeroTag,
          child: Material(
            color: Colors.transparent,
            shape: const CircleBorder(),
            clipBehavior: Clip.antiAlias,
            child: InkWell(
              customBorder: const CircleBorder(),
              onTap: () => context.push('/profile'),
              child: Container(
                width: 46,
                height: 46,
                clipBehavior: Clip.antiAlias,
                decoration: BoxDecoration(
                  color: _panelElevated.withOpacity(0.94),
                  shape: BoxShape.circle,
                  border: Border.all(
                    color: (isOnline ? _statusOnlineDark : _statusOfflineGray)
                        .withOpacity(0.95),
                    width: 1.6,
                  ),
                  boxShadow: [
                    ...AppTheme.softShadow(opacity: 0.34),
                    BoxShadow(
                      color: (isOnline ? _statusOnlineDark : _statusOfflineGray)
                          .withOpacity(0.24),
                      blurRadius: 14,
                      offset: const Offset(0, 2),
                    ),
                  ],
                ),
                alignment: Alignment.center,
                child: FittedBox(
                  fit: BoxFit.scaleDown,
                  child: Padding(
                    padding: const EdgeInsets.all(2),
                    child: Text(
                      (user?.fullName?.isNotEmpty == true)
                          ? user.fullName[0].toUpperCase()
                          : '?',
                      style: const TextStyle(
                        color: _textOnDark,
                        fontWeight: FontWeight.w800,
                        fontSize: 18,
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),

        // Ortada büyük online durum pill
        Expanded(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 10),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 350),
              curve: Curves.easeOut,
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: _panelElevated.withOpacity(0.94),
                borderRadius: BorderRadius.circular(999),
                border: Border.all(color: _panelBorder.withOpacity(0.85)),
                boxShadow: AppTheme.softShadow(opacity: 0.28),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  BreathingDot(
                    color: isOnline ? _statusOnlineDark : _statusOfflineGray,
                    size: 9,
                    pulse: isOnline,
                  ),
                  const SizedBox(width: 10),
                  Flexible(
                    child: Text(
                      isOnline ? 'Çevrimiçi' : 'Çevrimdışı',
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                        color: _textOnDark,
                        letterSpacing: 0.2,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),

        // Konuma odaklan
        _circleButton(
          icon: Icons.my_location_rounded,
          isOnline: isOnline,
          onTap: () {
            _mapController?.animateCamera(
                CameraUpdate.newLatLngZoom(_currentPosition, 14.5));
          },
        ),
      ],
    );
  }

  Widget _circleButton({
    required IconData icon,
    required bool isOnline,
    required VoidCallback onTap,
  }) {
    return Material(
      color: _panelElevated.withOpacity(0.94),
      shape: const CircleBorder(),
      elevation: 0,
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: onTap,
        child: Container(
          width: 46,
          height: 46,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            border: Border.all(
              color: (isOnline ? _statusOnlineDark : _statusOfflineGray)
                  .withOpacity(0.95),
              width: 1.6,
            ),
            boxShadow: [
              ...AppTheme.softShadow(opacity: 0.3),
              BoxShadow(
                color: (isOnline ? _statusOnlineDark : _statusOfflineGray)
                    .withOpacity(0.22),
                blurRadius: 14,
                offset: const Offset(0, 2),
              ),
            ],
          ),
          alignment: Alignment.center,
          child: Icon(
            icon,
            color: isOnline ? _statusOnlineDark : _statusOfflineGray,
            size: 22,
          ),
        ),
      ),
    );
  }

  // ---------- BOTTOM PANEL (idle, kompakt) ----------
  Widget _buildBottomPanel(
    bool isOnline, {
    Key? key,
    required bool onlineBusy,
  }) {
    return Container(
      key: key,
      decoration: BoxDecoration(
        color: _panelSurface,
        borderRadius:
            BorderRadius.vertical(top: Radius.circular(AppTheme.radiusXxl)),
        border: Border(top: BorderSide(color: _panelBorder, width: 1)),
        boxShadow: const [
          BoxShadow(
            color: Color(0x66000000),
            blurRadius: 20,
            offset: Offset(0, -6),
          ),
        ],
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 12),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // Tutma çubuğu
              Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: _panelBorder,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(height: 10),

              // Başlık satırı — kompakt
              Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  Container(
                    width: 36,
                    height: 36,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: (isOnline
                          ? AppTheme.success.withOpacity(0.18)
                          : _panelElevated),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Icon(
                      isOnline
                          ? Icons.local_taxi_rounded
                          : Icons.nightlight_round,
                      size: 20,
                      color: isOnline ? AppTheme.success : _textOnDarkMuted,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          isOnline ? 'Çevrimiçisin' : 'Mesaiye başla',
                          style: const TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w800,
                            color: _textOnDark,
                          ),
                        ),
                        Text(
                          isOnline
                              ? 'Yakındaki istekler otomatik gelir.'
                              : 'Çevrimiçi olunca istekler gelmeye başlar.',
                          style: const TextStyle(
                            fontSize: 11.5,
                            color: _textOnDarkMuted,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),

              // Kompakt online toggle
              _OnlineToggleButton(
                isOnline: isOnline,
                isLoading: onlineBusy,
                ringController: _ringCtrl,
                onTap: () => _toggleOnline(!isOnline),
              ),
              const SizedBox(height: 10),
              Text(
                'Uygulamayı açık tutun. Arka planda kalırsa istekler geç gelebilir.',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 10,
                  color: Color(0xFF64748B),
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Dairesel büyük online/offline buton — online iken etrafında
/// yumuşak atan halka animasyonu çalışır.
class _OnlineToggleButton extends StatelessWidget {
  const _OnlineToggleButton({
    required this.isOnline,
    required this.isLoading,
    required this.ringController,
    required this.onTap,
  });

  final bool isOnline;
  final bool isLoading;
  final AnimationController ringController;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: isLoading ? null : onTap,
      child: SizedBox(
        height: 60,
        child: Stack(
          alignment: Alignment.center,
          children: [
            // Arka plan ana şerit
            AnimatedContainer(
              duration: const Duration(milliseconds: 350),
              curve: Curves.easeOutCubic,
              height: 52,
              width: double.infinity,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(AppTheme.radiusXl),
                gradient: isOnline
                    ? const LinearGradient(
                        colors: [Color(0xFF10B981), Color(0xFF059669)],
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                      )
                    : const LinearGradient(
                        colors: [Color(0xFF334155), Color(0xFF1E293B)],
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                      ),
                boxShadow: [
                  BoxShadow(
                    color: (isOnline ? AppTheme.success : AppTheme.ink)
                        .withOpacity(0.35),
                    blurRadius: 20,
                    offset: const Offset(0, 10),
                  ),
                ],
              ),
            ),

            // Dönen halka (sadece online)
            if (isOnline)
              AnimatedBuilder(
                animation: ringController,
                builder: (context, _) {
                  final t = ringController.value;
                  final scale = 1 + t * 0.06;
                  final opacity = (1 - t) * 0.45;
                  return Transform.scale(
                    scale: scale,
                    child: Container(
                      height: 52,
                      width: double.infinity,
                      decoration: BoxDecoration(
                        borderRadius:
                            BorderRadius.circular(AppTheme.radiusXl),
                        border: Border.all(
                          color: AppTheme.success.withOpacity(opacity),
                          width: 2.5,
                        ),
                      ),
                    ),
                  );
                },
              ),

            // Etiket veya yükleme
            if (isLoading)
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const SizedBox(
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(
                      strokeWidth: 2.5,
                      color: Colors.white,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Text(
                    isOnline ? 'Kapatılıyor…' : 'Bağlanıyor…',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 15,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 0.2,
                    ),
                  ),
                ],
              )
            else
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  AnimatedSwitcher(
                    duration: const Duration(milliseconds: 250),
                    transitionBuilder: (c, a) =>
                        ScaleTransition(scale: a, child: FadeTransition(opacity: a, child: c)),
                    child: Icon(
                      isOnline ? Icons.pause_rounded : Icons.bolt_rounded,
                      key: ValueKey(isOnline),
                      color: Colors.white,
                      size: 22,
                    ),
                  ),
                  const SizedBox(width: 10),
                  Text(
                    isOnline ? 'Çevrimdışı Ol' : 'Çevrimiçi Ol',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 15,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 0.3,
                    ),
                  ),
                ],
              ),
          ],
        ),
      ),
    );
  }
}
