import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:geolocator/geolocator.dart';
import '../../core/constants/app_constants.dart';
import '../../core/utils/location_permission_util.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/top_overlay_toast.dart';
import '../../core/utils/map_marker_icons.dart';
import '../../models/ride_model.dart' hide LatLng;
import '../../models/ride_matching_progress_model.dart';
import '../../models/driver_info_model.dart';
import '../../providers/providers.dart';
import '../../services/directions_service.dart';
import '../../services/driver_push_registration.dart';
import '../../services/ride_match_sound.dart';
import '../../services/ride_session_sync.dart';
import '../../core/widgets/map_fab.dart';
import 'ride_bottom_sheet.dart';
import 'ride_searching_bubble_overlay.dart';
import 'ride_tracking_sheet.dart';
import 'ride_completion_screen.dart';
import 'destination_search_screen.dart';
import 'pickup_pin_screen.dart';

String? _parsePickupPinFromDynamic(dynamic raw) {
  if (raw == null) return null;
  if (raw is num) {
    final n = raw.round().clamp(0, 9999);
    return n.toString().padLeft(4, '0');
  }
  var s = raw.toString().trim();
  if (s.isEmpty) return null;
  if (s.length > 8) s = s.substring(0, 8);
  if (RegExp(r'^\d+$').hasMatch(s)) {
    if (s.length <= 4) return s.padLeft(4, '0');
    return s;
  }
  return s;
}

String? _extractPickupPinFromAcceptPayload(Map<String, dynamic> map) {
  dynamic raw = map['verificationCode'] ??
      map['verification_code'] ??
      map['pickupVerificationCode'] ??
      map['pickup_verification_code'] ??
      map['pickupCode'] ??
      map['pickup_code'];
  final nested = map['ride'];
  if (raw == null && nested is Map) {
    final r = Map<String, dynamic>.from(nested);
    raw = r['verificationCode'] ??
        r['verification_code'] ??
        r['pickupVerificationCode'] ??
        r['pickup_verification_code'] ??
        r['pickupCode'] ??
        r['pickup_code'];
  }
  return _parsePickupPinFromDynamic(raw);
}

/// Müşteri ana ekranı — Google Maps + adres arama + rota çizgisi + taksi çağırma
class CustomerHomeScreen extends ConsumerStatefulWidget {
  const CustomerHomeScreen({super.key});

  @override
  ConsumerState<CustomerHomeScreen> createState() => _CustomerHomeScreenState();
}

class _CustomerHomeScreenState extends ConsumerState<CustomerHomeScreen>
    with WidgetsBindingObserver {
  GoogleMapController? _mapController;
  LatLng _currentPosition = const LatLng(AppConstants.defaultLat, AppConstants.defaultLng);
  LatLng? _pickupPosition;
  LatLng? _dropoffPosition;
  String? _pickupAddress;
  String? _dropoffAddress;
  final Set<Marker> _markers = {};
  final Set<Polyline> _polylines = {};
  bool _locationLoading = true;
  final List<RouteInfo> _routeAlternatives = [];
  int _selectedRouteIndex = 0;
  BitmapDescriptor? _driverCarIcon;
  BitmapDescriptor? _userLocationIcon;
  BitmapDescriptor? _dropoffIcon;
  /// Yolculuk başladı (socket) — süre özeti için
  DateTime? _tripStartedAt;

  /// Rezervasyon alt paneli — varış + rota sonrası otomatik yükseltme
  final DraggableScrollableController _bookSheetController =
      DraggableScrollableController();

  /// Rota yüklenince sheet animasyonu bitene kadar alt inset en az [expanded] (ilk karede 0.35 bildirimi padding'i bozmasın).
  bool _mapBottomInsetAtLeastExpanded = false;

  int _routeBoundsFitGeneration = 0;

  RouteInfo? get _selectedRouteInfo =>
      _routeAlternatives.isEmpty ? null : _routeAlternatives[_selectedRouteIndex];

  // Socket dinleyici abonelikleri
  StreamSubscription? _rideAcceptedSub;
  StreamSubscription? _driverLocationSub;
  StreamSubscription? _noDriverFoundSub;
  StreamSubscription? _driverArrivedSub;
  StreamSubscription? _rideStartedSub;
  StreamSubscription? _rideCompletedSub;
  StreamSubscription? _rideCancelledSub;
  StreamSubscription? _rideSearchingSub;
  StreamSubscription? _rideMatchingProgressSub;
  StreamSubscription? _rideSnapshotSub;
  StreamSubscription? _connectedSub;

  // Directions servisi
  late final DirectionsService _directionsService;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      DriverPushRegistration.ensureRegisteredForCustomer(ref);
    });
    WidgetsBinding.instance.addObserver(this);
    _directionsService = DirectionsService(AppConstants.googleMapsApiKey);
    _getCurrentLocation();
    _setupSocketListeners();
    _checkActiveRide();
    _loadMapMarkerIcons();
    // RideSessionSync splash'ta snapshot'ı provider'a yazar; haritayı senkronize et
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _hydrateMapFromProviders();
    });
    unawaited(_restoreActiveRideFromApi());
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    super.didChangeAppLifecycleState(state);
    if (state == AppLifecycleState.resumed) {
      // Arkaplandan dönünce soket kopmuş olabilir — yeniden bağlan.
      ref.read(socketServiceProvider).ensureConnected();
      // Aktif yolculuk varsa REST ile tekrar doğrula (snapshot zaman aşımına karşı)
      _restoreActiveRideFromApi();
    }
  }

  void _loadMapMarkerIcons() {
    MapMarkerIcons.loadTaxiMarker().then((icon) {
      if (!mounted) return;
      setState(() => _driverCarIcon = icon);
      _rebuildMarkers();
    });
    MapMarkerIcons.loadUserLocationMarker().then((icon) {
      if (!mounted) return;
      setState(() => _userLocationIcon = icon);
      _rebuildMarkers();
    });
    MapMarkerIcons.loadDropoffMarker().then((icon) {
      if (!mounted) return;
      setState(() => _dropoffIcon = icon);
      _rebuildMarkers();
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _rideAcceptedSub?.cancel();
    _driverLocationSub?.cancel();
    _noDriverFoundSub?.cancel();
    _driverArrivedSub?.cancel();
    _rideStartedSub?.cancel();
    _rideCompletedSub?.cancel();
    _rideCancelledSub?.cancel();
    _rideSearchingSub?.cancel();
    _rideMatchingProgressSub?.cancel();
    _rideSnapshotSub?.cancel();
    _connectedSub?.cancel();
    dismissTopOverlayToast();
    _bookSheetController.dispose();
    _mapController?.dispose();
    super.dispose();
  }

  static const double _bookSheetInitialSize = 0.32;
  static const double _bookSheetExpandedSize = 0.65;

  /// Draggable alt panelin yükseklik oranı — harita padding ve kamera ortalaması için.
  double _sheetExtent = _bookSheetInitialSize;

  double _extentForMapBottomInset() {
    var e = _sheetExtent;
    if (_routeAlternatives.isNotEmpty && _mapBottomInsetAtLeastExpanded) {
      if (e < _bookSheetExpandedSize) e = _bookSheetExpandedSize;
    }
    return e;
  }

  EdgeInsets _mapPaddingInsets(BuildContext context, {required bool searchingBubble}) {
    final mq = MediaQuery.of(context);
    final h = mq.size.height;
    final top = mq.padding.top + (searchingBubble ? 252 : 62);
    final bottom = h * _extentForMapBottomInset() + 16;
    return EdgeInsets.only(top: top, bottom: bottom, left: 12, right: 12);
  }

  void _scheduleRouteBoundsFit(LatLng pickup, LatLng dropoff) {
    _routeBoundsFitGeneration++;
    final gen = _routeBoundsFitGeneration;

    void tryFit() {
      if (!mounted || gen != _routeBoundsFitGeneration) return;
      if (_pickupPosition != pickup || _dropoffPosition != dropoff) return;
      _fitBounds(pickup, dropoff);
    }

    WidgetsBinding.instance.addPostFrameCallback((_) => tryFit());
    Future<void>.delayed(const Duration(milliseconds: 80), tryFit);
    Future<void>.delayed(const Duration(milliseconds: 420), tryFit);
  }

  void _expandBookSheetForRouteOptions() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      if (!_bookSheetController.isAttached) return;
      _bookSheetController.animateTo(
        _bookSheetExpandedSize,
        duration: const Duration(milliseconds: 360),
        curve: Curves.easeOutCubic,
      );
    });
  }

  void _collapseBookSheet() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      if (!_bookSheetController.isAttached) return;
      _bookSheetController.animateTo(
        _bookSheetInitialSize,
        duration: const Duration(milliseconds: 280),
        curve: Curves.easeOutCubic,
      );
    });
  }

  /// Mevcut GPS konumunu al
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

      setState(() {
        _currentPosition = LatLng(position.latitude, position.longitude);
        _pickupPosition = _currentPosition;
        _pickupAddress = 'Mevcut Konumunuz';
        _locationLoading = false;
      });

      _mapController?.animateCamera(CameraUpdate.newLatLngZoom(_currentPosition, 15));
      _rebuildMarkers();
    } catch (e) {
      setState(() => _locationLoading = false);
      debugPrint('Konum hatası: $e');
    }
  }

  /// Aktif yolculuk kontrolü
  void _checkActiveRide() {
    final activeRide = ref.read(activeRideProvider);
    if (activeRide != null && activeRide.isActive) {
      _rebuildMarkers();
    }
  }

  void _clearMatchingProgress() {
    ref.read(rideMatchingProgressProvider.notifier).clear();
  }

  void _applyMatchingProgress(Map<String, dynamic> data) {
    final rideId = data['rideId'] as String? ?? '';
    if (rideId.isEmpty) return;
    final active = ref.read(activeRideProvider);
    if (active == null || active.status != RideStatus.searching) return;
    final sameRide = active.id == rideId || active.id.startsWith('temp_');
    if (!sameRide) return;
    ref.read(rideMatchingProgressProvider.notifier).apply(
          RideMatchingProgressModel.fromJson(data),
        );
  }

  /// Socket event dinleyicilerini kur
  void _setupSocketListeners() {
    final socket = ref.read(socketServiceProvider);

    // Splash'ta açılan soket snapshot'ı bu ekran mount olmadan kaçırabilir — reconnect'te REST ile tamamla
    _connectedSub?.cancel();
    _connectedSub = socket.onConnected.listen((_) {
      if (!mounted) return;
      _restoreActiveRideFromApi();
    });

    // Sunucu gerçek yolculuk id (taksi çağrısı sonrası — iptal için zorunlu)
    _rideSearchingSub = socket.onRideSearching.listen((data) {
      if (!mounted) return;
      final rideId = data['rideId'] as String? ?? '';
      if (rideId.isEmpty) return;
      ref.read(activeRideProvider.notifier).updateRideId(rideId);
    });

    _rideMatchingProgressSub = socket.onRideMatchingProgress.listen((data) {
      if (!mounted) return;
      _applyMatchingProgress(data);
    });

    // Sürücü yolculuğu kabul etti
    // Backend iki ride:accepted gönderir: ilki anlık (minimal bilgi), ikincisi zengin (sürücü detay + ETA).
    // Ses / snackbar yalnızca ilkinde çalar; ikincisi sürücü bilgisini sessizce günceller.
    _rideAcceptedSub = socket.onRideAccepted.listen((data) async {
      if (!mounted) return;
      final map = Map<String, dynamic>.from(data as Map);
      final rideId = map['rideId'] as String? ?? '';
      final rawDriver = map['driverInfo'] ?? map['driver'];
      final DriverInfoModel? driverInfo = rawDriver != null
          ? DriverInfoModel.fromJson(Map<String, dynamic>.from(rawDriver as Map))
          : null;

      final currentRide = ref.read(activeRideProvider);
      final isFirstAccept = currentRide == null || currentRide.status != RideStatus.accepted;

      if (currentRide == null && rideId.isNotEmpty) {
        ref.read(activeRideProvider.notifier).setRide(RideModel(
          id: rideId,
          customerId: ref.read(currentUserProvider)?.id ?? '',
          pickupAddress: _pickupAddress ?? 'Mevcut Konumunuz',
          dropoffAddress: _dropoffAddress ?? '',
          distanceKm: null,
          estimatedPrice: 0,
          status: RideStatus.accepted,
          pickupLat: _pickupPosition?.latitude,
          pickupLng: _pickupPosition?.longitude,
          dropoffLat: _dropoffPosition?.latitude,
          dropoffLng: _dropoffPosition?.longitude,
        ));
      } else {
        if (rideId.isNotEmpty) {
          ref.read(activeRideProvider.notifier).updateRideId(rideId);
        }
        ref.read(activeRideProvider.notifier).updateStatus(RideStatus.accepted);
      }

      final pin = _extractPickupPinFromAcceptPayload(map) ?? '';
      if (pin.isNotEmpty) {
        ref.read(activeRideProvider.notifier).applyPickupVerificationCode(pin);
      }

      if (driverInfo != null) {
        ref.read(assignedDriverProvider.notifier).setDriver(driverInfo);
        if (driverInfo.lat != 0 && driverInfo.lng != 0) {
          _updateDriverMarker(driverInfo.lat, driverInfo.lng);
          _mapController?.animateCamera(
            CameraUpdate.newLatLngZoom(
              LatLng(driverInfo.lat, driverInfo.lng),
              16.2,
            ),
          );
        }
      }
      _applyMapPolylines();

      if (isFirstAccept) {
        _clearMatchingProgress();
        await RideMatchSound.playDefaultNotificationAlert();
        _showSnackBar('Sürücü bulundu! Yola çıkıyor.', AppTheme.accentColor);
      }

      if (rideId.isNotEmpty) {
        unawaited(_syncPickupVerificationCodeFromApi(rideId));
      }
    });

    // Sürücü konum güncellemesi
    _driverLocationSub = socket.onDriverLocation.listen((data) {
      if (!mounted) return;
      final lat = (data['lat'] as num?)?.toDouble();
      final lng = (data['lng'] as num?)?.toDouble();
      if (lat != null && lng != null) {
        _updateDriverMarker(lat, lng);
      }
    });

    // Sürücü bulunamadı
    _noDriverFoundSub = socket.onNoDriverFound.listen((_) {
      if (!mounted) return;
      _clearMatchingProgress();
      ref.read(activeRideProvider.notifier).clear();
      _showSnackBar('Yakında uygun sürücü bulunamadı.', AppTheme.errorColor);
    });

    // Sürücü biniş noktasına vardı
    _driverArrivedSub = socket.onDriverArrived.listen((payload) {
      if (!mounted) return;
      final target = payload['targetCustomerId'] as String? ?? '';
      final me = ref.read(currentUserProvider)?.id;
      if (target.isNotEmpty && me != null && target != me) {
        return;
      }
      ref.read(activeRideProvider.notifier).updateStatus(RideStatus.arriving);
      _applyMapPolylines();
      _showSnackBar('Sürücünüz geldi sizi bekliyor.', AppTheme.accentColor);
    });

    // Yolculuk başladı
    _rideStartedSub = socket.onRideStarted.listen((_) {
      if (!mounted) return;
      ref.read(activeRideProvider.notifier).updateStatus(RideStatus.inProgress);
      _tripStartedAt = DateTime.now();
      _applyMapPolylines();
      _showSnackBar('Yolculuk başladı! İyi yolculuklar.', AppTheme.accentColor);
    });

    // Yolculuk tamamlandı
    _rideCompletedSub = socket.onRideCompleted.listen((data) {
      if (!mounted) return;
      final rideSnap = ref.read(activeRideProvider);
      final driverSnap = ref.read(assignedDriverProvider);
      final fp = (data['finalPrice'] as num?)?.toDouble();
      final tripDuration =
          _tripStartedAt != null ? DateTime.now().difference(_tripStartedAt!) : null;

      RideModel? completedRide;
      if (rideSnap != null) {
        completedRide = rideSnap.copyWith(
          status: RideStatus.completed,
          finalPrice: fp ?? rideSnap.finalPrice,
          completedAt: DateTime.now().toIso8601String(),
        );
      }

      ref.read(activeRideProvider.notifier).clear();
      ref.read(assignedDriverProvider.notifier).clear();
      _tripStartedAt = null;
      _clearMap();

      final summary = completedRide;
      if (summary != null && mounted) {
        Navigator.of(context).push(
          MaterialPageRoute<void>(
            fullscreenDialog: true,
            builder: (_) => RideCompletionScreen(
              ride: summary,
              driver: driverSnap,
              tripDuration: tripDuration,
            ),
          ),
        );
      } else if (mounted) {
        _showSnackBar('Yolculuk tamamlandı! Teşekkürler.', AppTheme.accentColor);
      }
    });

    // Yolculuk iptal edildi
    _rideCancelledSub = socket.onRideCancelled.listen((_) {
      if (!mounted) return;
      _clearMatchingProgress();
      ref.read(activeRideProvider.notifier).clear();
      ref.read(assignedDriverProvider.notifier).clear();
      _clearMap();
      _showSnackBar('Yolculuk iptal edildi.', AppTheme.errorColor);
    });

    // Aktif yolculuk snapshot'ı (bağlantı / reconnect sonrası — kaldığı yerden devam)
    _rideSnapshotSub = socket.onRideSnapshot.listen((data) {
      if (!mounted) return;
      _applyRideSnapshot(data);
    });
  }

  /// Snapshot payload'ını state'e uygular — UI kaldığı yerden devam eder.
  void _applyRideSnapshot(Map<String, dynamic> data) {
    ref.read(rideSessionSyncProvider).applyCustomerRideSnapshot(data);
    final ride = ref.read(activeRideProvider);
    if (ride == null || !ride.isActive) return;
    _hydrateMapFromRide(ride);
    final driver = ref.read(assignedDriverProvider);
    if (driver != null && (driver.lat != 0 || driver.lng != 0)) {
      _updateDriverMarker(driver.lat, driver.lng);
    }
  }

  void _hydrateMapFromProviders() {
    final ride = ref.read(activeRideProvider);
    if (ride == null || !ride.isActive) return;
    _hydrateMapFromRide(ride);
    final driver = ref.read(assignedDriverProvider);
    if (driver != null && (driver.lat != 0 || driver.lng != 0)) {
      _updateDriverMarker(driver.lat, driver.lng);
    }
  }

  void _hydrateMapFromRide(RideModel ride) {
    final pickupLat = ride.pickupLat;
    final pickupLng = ride.pickupLng;
    final dropoffLat = ride.dropoffLat;
    final dropoffLng = ride.dropoffLng;

    if (pickupLat != null && pickupLng != null) {
      _pickupPosition = LatLng(pickupLat, pickupLng);
      _pickupAddress = ride.pickupAddress;
    }
    if (dropoffLat != null && dropoffLng != null) {
      _dropoffPosition = LatLng(dropoffLat, dropoffLng);
      _dropoffAddress = ride.dropoffAddress;
      _fetchAndDrawRoute();
    } else {
      _applyMapPolylines();
    }
    _rebuildMarkers();
  }

  /// Sürücü kabulünden sonra PIN bazen sokette boş gelir; DB'den birkaç kez dene.
  Future<void> _syncPickupVerificationCodeFromApi(String expectedRideId) async {
    for (var attempt = 0; attempt < 8; attempt++) {
      if (attempt > 0) {
        await Future<void>.delayed(const Duration(milliseconds: 550));
      }
      if (!mounted) return;
      final cur0 = ref.read(activeRideProvider);
      if (cur0 == null) return;
      if (cur0.id != expectedRideId) {
        if (expectedRideId.isEmpty || !cur0.id.startsWith('temp_')) return;
        ref.read(activeRideProvider.notifier).updateRideId(expectedRideId);
      }
      final cur = ref.read(activeRideProvider);
      if (cur == null || cur.id != expectedRideId) return;
      final existing = cur.pickupVerificationCode?.trim() ?? '';
      if (existing.length >= 4) return;

      try {
        final api = ref.read(apiServiceProvider);
        final res = await api.getActiveRide();
        final body = res.data;
        if (body is! Map) continue;
        final payload = body['data'] ?? body['ride'];
        if (payload == null || payload is! Map) continue;
        final data = Map<String, dynamic>.from(payload);
        final raw = data['pickup_verification_code'] ??
            data['pickupVerificationCode'] ??
            data['verification_code'] ??
            data['verificationCode'] ??
            data['pickup_code'] ??
            data['pickupCode'];
        final parsed = _parsePickupPinFromDynamic(raw);
        if (parsed != null && parsed.isNotEmpty) {
          ref.read(activeRideProvider.notifier).applyPickupVerificationCode(parsed);
          return;
        }
      } catch (_) {
        // sonraki deneme
      }
    }
  }

  /// REST ile provider restore (RideSessionSync) + harita senkronu.
  Future<void> _restoreActiveRideFromApi() async {
    await ref.read(rideSessionSyncProvider).restoreCustomerActiveRideFromApi();
    if (!mounted) return;
    _hydrateMapFromProviders();
  }

  /// Marker'lar: kullanıcı konumu, varış, eşleşen sürücü (alım haritada pin değil).
  void _rebuildMarkers() {
    _markers.clear();
    if (_userLocationIcon != null) {
      _markers.add(Marker(
        markerId: const MarkerId('user'),
        position: _currentPosition,
        icon: _userLocationIcon!,
        anchor: const Offset(0.5, 0.5),
        zIndexInt: 3,
      ));
    }
    if (_dropoffPosition != null) {
      _markers.add(Marker(
        markerId: const MarkerId('dropoff'),
        position: _dropoffPosition!,
        icon: _dropoffIcon ?? BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueAzure),
        anchor: const Offset(0.5, 0.5),
        infoWindow: InfoWindow(title: 'Varış', snippet: _dropoffAddress ?? ''),
        zIndexInt: 1,
      ));
    }
    final driver = ref.read(assignedDriverProvider);
    final activeRide = ref.read(activeRideProvider);
    final hasActive = activeRide != null && activeRide.isActive;

    // Sürücü marker'ı sadece eşleşme olduğunda gösterilir
    if (hasActive && driver != null && (driver.lat != 0 || driver.lng != 0)) {
      _markers.add(Marker(
        markerId: const MarkerId('driver'),
        position: LatLng(driver.lat, driver.lng),
        icon: _driverCarIcon ?? BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueOrange),
        anchor: const Offset(0.5, 0.5),
        zIndexInt: 4,
        infoWindow: const InfoWindow(title: 'Sürücü'),
      ));
    }

    setState(() {});
  }

  /// Ana rota + (kabul / geliyor) sürücü → biniş kesikli çizgi
  void _applyMapPolylines() {
    if (!mounted) return;
    final activeRide = ref.read(activeRideProvider);
    final driver = ref.read(assignedDriverProvider);
    final next = <Polyline>{};

    if (_routeAlternatives.isNotEmpty) {
      final pts = _routeAlternatives[_selectedRouteIndex].points;
      next.add(Polyline(
        polylineId: const PolylineId('route'),
        points: pts,
        color: AppTheme.ink,
        width: 3,
        geodesic: true,
        startCap: Cap.roundCap,
        endCap: Cap.roundCap,
        jointType: JointType.round,
      ));
    }

    if (activeRide != null &&
        (activeRide.status == RideStatus.accepted || activeRide.status == RideStatus.arriving) &&
        driver != null &&
        (driver.lat != 0 || driver.lng != 0) &&
        _pickupPosition != null) {
      next.add(Polyline(
        polylineId: const PolylineId('driver_pickup'),
        points: [LatLng(driver.lat, driver.lng), _pickupPosition!],
        color: AppTheme.primaryColor,
        width: 4,
        geodesic: true,
        patterns: [PatternItem.dash(16), PatternItem.gap(10)],
        startCap: Cap.roundCap,
        endCap: Cap.roundCap,
      ));
    }

    setState(() {
      _polylines
        ..clear()
        ..addAll(next);
    });
  }

  /// Rota çizgisini Google Directions API ile çiz (alternatif rotalar dahil)
  Future<void> _fetchAndDrawRoute() async {
    if (_pickupPosition == null || _dropoffPosition == null) return;

    final routes = await _directionsService.getDirectionsAlternatives(
      _pickupPosition!,
      _dropoffPosition!,
    );

    if (!mounted) return;

    if (routes.isEmpty) {
      setState(() {
        _routeAlternatives.clear();
        _selectedRouteIndex = 0;
      });
      _showSnackBar('Bu iki nokta için rota bulunamadı.', AppTheme.errorColor);
      return;
    }

    setState(() {
      _routeAlternatives
        ..clear()
        ..addAll(routes);
      _selectedRouteIndex = 0;
      _sheetExtent = _bookSheetExpandedSize;
      _mapBottomInsetAtLeastExpanded = true;
    });
    _applyMapPolylines();

    _expandBookSheetForRouteOptions();
    _scheduleRouteBoundsFit(_pickupPosition!, _dropoffPosition!);
    Future<void>.delayed(const Duration(milliseconds: 480), () {
      if (!mounted) return;
      setState(() => _mapBottomInsetAtLeastExpanded = false);
    });
  }

  void _onRouteAlternativeSelected(int index) {
    if (index < 0 || index >= _routeAlternatives.length) return;
    setState(() => _selectedRouteIndex = index);
    _applyMapPolylines();
  }

  /// Sürücü marker'ını güncelle
  void _updateDriverMarker(double lat, double lng) {
    final assigned = ref.read(assignedDriverProvider);
    if (assigned == null) {
      final ride = ref.read(activeRideProvider);
      final driverId = ride?.driverId?.trim() ?? '';
      if (driverId.isEmpty) return;
      ref.read(assignedDriverProvider.notifier).setDriver(DriverInfoModel(
        id: driverId,
        fullName: 'Sürücü',
        phone: '',
        vehiclePlate: '',
        vehicleModel: '',
        vehicleColor: '',
        lat: lat,
        lng: lng,
      ));
      final rideAfter = ref.read(activeRideProvider);
      final assignedAfter = ref.read(assignedDriverProvider);
      if (rideAfter != null &&
          rideAfter.isActive &&
          rideAfter.status != RideStatus.searching &&
          !RideSessionSync.customerSessionComplete(rideAfter, assignedAfter)) {
        unawaited(_restoreActiveRideFromApi());
      }
    } else {
      ref.read(assignedDriverProvider.notifier).updateLocation(lat, lng);
    }
    _rebuildMarkers();
    _applyMapPolylines();
  }

  /// Haritayı temizle
  void _clearMap() {
    _routeBoundsFitGeneration++;
    _dropoffPosition = null;
    _dropoffAddress = null;
    _routeAlternatives.clear();
    _selectedRouteIndex = 0;
    _tripStartedAt = null;
    _sheetExtent = _bookSheetInitialSize;
    _mapBottomInsetAtLeastExpanded = false;
    _applyMapPolylines();
    if (_pickupPosition != null) _rebuildMarkers();
    _collapseBookSheet();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || _mapController == null) return;
      _mapController!.animateCamera(
        CameraUpdate.newLatLngZoom(_currentPosition, 15),
      );
    });
  }

  Future<void> _applyDropoffFromPlaceDetail(PlaceDetail result) async {
    if (!mounted) return;
    setState(() {
      _dropoffPosition = LatLng(result.lat, result.lng);
      _dropoffAddress = result.name.isNotEmpty ? result.name : result.address;
    });
    _rebuildMarkers();
    await _fetchAndDrawRoute();
  }

  /// Adres arama ekranını aç
  Future<void> _openDestinationSearch() async {
    final result = await Navigator.push<PlaceDetail>(
      context,
      MaterialPageRoute(
        builder: (_) => DestinationSearchScreen(
          apiKey: AppConstants.googleMapsApiKey,
          currentLocation: _currentPosition,
        ),
      ),
    );

    if (result != null && mounted) {
      await _applyDropoffFromPlaceDetail(result);
    }
  }

  Future<void> _openDropoffPinPicker() async {
    final initial = _dropoffPosition ?? _pickupPosition ?? _currentPosition;
    final result = await Navigator.push<PlaceDetail>(
      context,
      MaterialPageRoute(
        builder: (_) => PickupPinScreen(
          initialPosition: initial,
          appBarTitle: 'Varış Noktasını Belirle',
        ),
      ),
    );
    if (result != null && mounted) {
      await _applyDropoffFromPlaceDetail(result);
    }
  }

  Future<void> _openPickupPicker() async {
    final result = await Navigator.push<PlaceDetail>(
      context,
      MaterialPageRoute(
        builder: (_) => PickupPinScreen(
          initialPosition: _pickupPosition ?? _currentPosition,
          anchorPosition: _currentPosition,
          maxRadiusMetersFromAnchor: AppConstants.pickupEditRadiusMeters,
        ),
      ),
    );

    if (result == null || !mounted) return;
    setState(() {
      _pickupPosition = LatLng(result.lat, result.lng);
      _pickupAddress = result.name.isNotEmpty ? result.name : result.address;
    });
    _rebuildMarkers();
    if (_dropoffPosition != null) {
      await _fetchAndDrawRoute();
    }
  }

  void _fitBounds(LatLng sw, LatLng ne) {
    final bounds = LatLngBounds(
      southwest: LatLng(
        sw.latitude < ne.latitude ? sw.latitude : ne.latitude,
        sw.longitude < ne.longitude ? sw.longitude : ne.longitude,
      ),
      northeast: LatLng(
        sw.latitude > ne.latitude ? sw.latitude : ne.latitude,
        sw.longitude > ne.longitude ? sw.longitude : ne.longitude,
      ),
    );
    _mapController?.animateCamera(CameraUpdate.newLatLngBounds(bounds, 64));
  }

  void _showSnackBar(String message, Color color) {
    if (!mounted) return;
    showTopOverlayToast(context, message, color);
  }

  @override
  Widget build(BuildContext context) {
    ref.listen(activeRideProvider, (prev, next) {
      if (!mounted) return;
      if (next == null || !next.isActive) {
        _clearMatchingProgress();
        return;
      }
      if (prev?.id == next.id &&
          prev?.status == next.status &&
          prev?.pickupLat == next.pickupLat &&
          prev?.dropoffLat == next.dropoffLat) {
        return;
      }
      _hydrateMapFromRide(next);
    });
    ref.listen(assignedDriverProvider, (prev, next) {
      if (!mounted || next == null) return;
      if (prev?.lat == next.lat && prev?.lng == next.lng) return;
      if (next.lat != 0 || next.lng != 0) {
        _updateDriverMarker(next.lat, next.lng);
      } else {
        _rebuildMarkers();
      }
    });

    final activeRide = ref.watch(activeRideProvider);
    final user = ref.watch(currentUserProvider);
    final isSearching =
        activeRide != null && activeRide.status == RideStatus.searching;

    return Scaffold(
      body: Stack(
        children: [
          // Google Maps
          GoogleMap(
            initialCameraPosition: CameraPosition(target: _currentPosition, zoom: AppConstants.defaultZoom),
            onMapCreated: (controller) => _mapController = controller,
            padding: _mapPaddingInsets(context, searchingBubble: isSearching),
            markers: _markers,
            polylines: _polylines,
            myLocationEnabled: false,
            myLocationButtonEnabled: false,
            zoomControlsEnabled: false,
            mapToolbarEnabled: false,
            compassEnabled: false,
          ),

          // Alt — bottom sheet ile birleşen yumuşak beyaz geçiş (referans UI)
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            height: 120,
            child: IgnorePointer(
              child: DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [
                      Colors.black.withValues(alpha: 0),
                      Colors.black.withValues(alpha: 0.12),
                    ],
                  ),
                ),
              ),
            ),
          ),

          // Üst bilgi çubuğu
          Positioned(
            top: MediaQuery.of(context).padding.top + 8,
            left: 16,
            right: 16,
            child: Row(
              children: [
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
                          color: AppTheme.surfaceColor,
                          shape: BoxShape.circle,
                          boxShadow: AppTheme.softShadow(opacity: 0.14),
                        ),
                        alignment: Alignment.center,
                        child: FittedBox(
                          fit: BoxFit.scaleDown,
                          child: Padding(
                            padding: const EdgeInsets.all(2),
                            child: Text(
                              (user?.fullName.isNotEmpty ?? false)
                                  ? user!.fullName[0].toUpperCase()
                                  : '?',
                              style: const TextStyle(
                                color: AppTheme.ink,
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
                const Spacer(),
                MapFab(
                  icon: Icons.my_location_rounded,
                  tooltip: 'Konumuma git',
                  minimalStyle: true,
                  onTap: () {
                    _mapController?.animateCamera(CameraUpdate.newLatLngZoom(_currentPosition, 15));
                  },
                ),
              ],
            ),
          ),

          if (isSearching)
            Positioned(
              top: MediaQuery.of(context).padding.top + 56,
              left: 14,
              right: 14,
              child: const RideSearchingBubbleOverlay(),
            ),

          // Yükleniyor göstergesi
          if (_locationLoading)
            const Center(child: CircularProgressIndicator(color: AppTheme.primaryColor)),

          // Alt panel: geçiş animasyonu
          Positioned.fill(
            child: NotificationListener<DraggableScrollableNotification>(
              onNotification: (DraggableScrollableNotification n) {
                final e = n.extent;
                if (e != _sheetExtent) {
                  setState(() => _sheetExtent = e);
                }
                return false;
              },
              child: activeRide != null && activeRide.isActive
                  ? KeyedSubtree(
                      key: ValueKey<String>('track-${activeRide.id}'),
                      child: DraggableScrollableSheet(
                        initialChildSize: 0.34,
                        minChildSize: 0.25,
                        maxChildSize: 0.78,
                        expand: true,
                        builder: (context, scrollController) {
                          return RideTrackingSheet(
                            ride: activeRide,
                            sheetScrollController: scrollController,
                          );
                        },
                      ),
                    )
                  : KeyedSubtree(
                      key: const ValueKey<String>('book'),
                      child: DraggableScrollableSheet(
                        controller: _bookSheetController,
                        initialChildSize: _bookSheetInitialSize,
                        minChildSize: 0.29,
                        maxChildSize: 0.88,
                        snap: true,
                        snapSizes: const <double>[
                          _bookSheetInitialSize,
                          _bookSheetExpandedSize,
                          0.88,
                        ],
                        expand: false,
                        builder: (context, scrollController) {
                          return RideBottomSheet(
                            sheetScrollController: scrollController,
                            pickupPosition: _pickupPosition,
                            dropoffPosition: _dropoffPosition,
                            pickupAddress: _pickupAddress,
                            dropoffAddress: _dropoffAddress,
                            routeInfo: _selectedRouteInfo,
                            routeAlternatives:
                                List<RouteInfo>.from(_routeAlternatives),
                            selectedRouteIndex: _selectedRouteIndex,
                            onRouteAlternativeSelected:
                                _onRouteAlternativeSelected,
                            onSelectPickup: _openPickupPicker,
                            onSelectDropoff: _openDestinationSearch,
                            onSelectDropoffOnMap: _openDropoffPinPicker,
                            onClearDropoff: _clearMap,
                            onHistoryPlaceSelected: (detail) {
                              unawaited(_applyDropoffFromPlaceDetail(detail));
                            },
                          );
                        },
                      ),
                    ),
            ),
          ),
        ],
      ),
    );
  }

}
