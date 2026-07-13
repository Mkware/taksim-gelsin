import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:geocoding/geocoding.dart';
import 'package:geolocator/geolocator.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:google_fonts/google_fonts.dart';
import '../../core/theme/app_theme.dart';
import '../../services/directions_service.dart';

class PickupPinScreen extends StatefulWidget {
  final LatLng initialPosition;
  final String appBarTitle;
  final String confirmButtonLabel;
  final String instructionText;
  /// Mevcut konum (veya referans noktası) — verilirse [maxRadiusMetersFromAnchor] ile alım daire dışına çıkılamaz.
  final LatLng? anchorPosition;
  /// [anchorPosition] ile pin arasındaki izin verilen maksimum mesafe (m). Null ise sınır yok.
  final double? maxRadiusMetersFromAnchor;

  const PickupPinScreen({
    super.key,
    required this.initialPosition,
    this.appBarTitle = 'Alım Noktasını Belirle',
    this.confirmButtonLabel = 'Bu Konumu Kullan',
    this.instructionText =
        'Pin haritanın ortasında kalacak şekilde hareket ettirin',
    this.anchorPosition,
    this.maxRadiusMetersFromAnchor,
  });

  @override
  State<PickupPinScreen> createState() => _PickupPinScreenState();
}

class _PickupPinScreenState extends State<PickupPinScreen> {
  GoogleMapController? _mapController;
  late LatLng _center;
  String _address = 'Konum belirleniyor...';
  bool _resolving = false;

  bool get _hasRadiusLimit =>
      widget.anchorPosition != null &&
      widget.maxRadiusMetersFromAnchor != null &&
      widget.maxRadiusMetersFromAnchor! > 0;

  @override
  void initState() {
    super.initState();
    _center = _hasRadiusLimit
        ? _clampToRadius(
            widget.anchorPosition!,
            widget.initialPosition,
            widget.maxRadiusMetersFromAnchor!,
          )
        : widget.initialPosition;
    _reverseGeocode();
  }

  static double _bearingDegrees(LatLng a, LatLng b) {
    final lat1 = a.latitude * math.pi / 180;
    final lat2 = b.latitude * math.pi / 180;
    final dLon = (b.longitude - a.longitude) * math.pi / 180;
    final y = math.sin(dLon) * math.cos(lat2);
    final x = math.cos(lat1) * math.sin(lat2) -
        math.sin(lat1) * math.cos(lat2) * math.cos(dLon);
    return (math.atan2(y, x) * 180 / math.pi + 360) % 360;
  }

  /// [bearingDegrees] yönünde [distanceMeters] kadar git (WGS84).
  static LatLng _offsetMeters(LatLng start, double bearingDegrees, double distanceMeters) {
    const earthRadius = 6371000.0;
    final brng = bearingDegrees * math.pi / 180;
    final lat1 = start.latitude * math.pi / 180;
    final lng1 = start.longitude * math.pi / 180;
    final angDist = distanceMeters / earthRadius;
    final lat2 = math.asin(
      math.sin(lat1) * math.cos(angDist) +
          math.cos(lat1) * math.sin(angDist) * math.cos(brng),
    );
    final lng2 = lng1 +
        math.atan2(
          math.sin(brng) * math.sin(angDist) * math.cos(lat1),
          math.cos(angDist) - math.sin(lat1) * math.sin(lat2),
        );
    return LatLng(lat2 * 180 / math.pi, lng2 * 180 / math.pi);
  }

  static LatLng _clampToRadius(LatLng anchor, LatLng point, double maxMeters) {
    final d = Geolocator.distanceBetween(
      anchor.latitude,
      anchor.longitude,
      point.latitude,
      point.longitude,
    );
    if (d <= maxMeters + 0.5) return point;
    final bear = _bearingDegrees(anchor, point);
    return _offsetMeters(anchor, bear, maxMeters);
  }

  Future<void> _ensureWithinRadiusOnIdle() async {
    if (!_hasRadiusLimit || _mapController == null) return;
    final anchor = widget.anchorPosition!;
    final maxM = widget.maxRadiusMetersFromAnchor!;
    final d = Geolocator.distanceBetween(
      anchor.latitude,
      anchor.longitude,
      _center.latitude,
      _center.longitude,
    );
    if (d <= maxM + 0.5) return;
    final clamped = _clampToRadius(anchor, _center, maxM);
    await _mapController!.animateCamera(CameraUpdate.newLatLng(clamped));
    if (!mounted) return;
    setState(() => _center = clamped);
  }

  Future<void> _reverseGeocode() async {
    if (_resolving) return;
    _resolving = true;
    try {
      final marks = await placemarkFromCoordinates(
        _center.latitude,
        _center.longitude,
      );
      if (!mounted) return;
      if (marks.isEmpty) {
        setState(() => _address = 'Adres bulunamadı');
      } else {
        final p = marks.first;
        final parts = <String>[
          p.street ?? '',
          p.subLocality ?? '',
          p.locality ?? '',
        ].where((e) => e.trim().isNotEmpty).toList();
        setState(() {
          _address = parts.isEmpty
              ? '${_center.latitude.toStringAsFixed(5)}, ${_center.longitude.toStringAsFixed(5)}'
              : parts.join(', ');
        });
      }
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _address =
            '${_center.latitude.toStringAsFixed(5)}, ${_center.longitude.toStringAsFixed(5)}';
      });
    } finally {
      _resolving = false;
    }
  }

  String get _instructionLine {
    if (_hasRadiusLimit) {
      final m = widget.maxRadiusMetersFromAnchor!.round();
      return '${widget.instructionText} Mevcut konumunuza en fazla $m m uzaklıkta seçebilirsiniz.';
    }
    return widget.instructionText;
  }

  @override
  Widget build(BuildContext context) {
    final initialTarget = _hasRadiusLimit
        ? _clampToRadius(
            widget.anchorPosition!,
            widget.initialPosition,
            widget.maxRadiusMetersFromAnchor!,
          )
        : widget.initialPosition;

    return Scaffold(
      appBar: AppBar(
        title: Text(widget.appBarTitle),
      ),
      body: Stack(
        children: [
          GoogleMap(
            initialCameraPosition:
                CameraPosition(target: initialTarget, zoom: 16),
            myLocationEnabled: true,
            myLocationButtonEnabled: true,
            onMapCreated: (c) => _mapController = c,
            onCameraMove: (pos) => _center = pos.target,
            onCameraIdle: () async {
              await _ensureWithinRadiusOnIdle();
              await _reverseGeocode();
            },
          ),
          const Center(
            child: IgnorePointer(
              child: Icon(Icons.location_pin, color: AppTheme.errorColor, size: 44),
            ),
          ),
          Positioned(
            left: 12,
            right: 12,
            bottom: 16,
            child: Material(
              color: Colors.white,
              borderRadius: BorderRadius.circular(14),
              elevation: 8,
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      _instructionLine,
                      style: GoogleFonts.inter(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: AppTheme.textSecondary,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      _address,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: GoogleFonts.inter(
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 10),
                    ElevatedButton(
                      onPressed: () {
                        LatLng use = _center;
                        if (_hasRadiusLimit) {
                          use = _clampToRadius(
                            widget.anchorPosition!,
                            _center,
                            widget.maxRadiusMetersFromAnchor!,
                          );
                        }
                        Navigator.pop(
                          context,
                          PlaceDetail(
                            lat: use.latitude,
                            lng: use.longitude,
                            address: _address,
                            name: _address,
                          ),
                        );
                      },
                      child: Text(widget.confirmButtonLabel),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
