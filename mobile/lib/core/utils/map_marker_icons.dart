import 'dart:ui' as ui;

import 'package:flutter/painting.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

import '../theme/app_theme.dart';

/// Harita marker bitmap'leri (Google Maps `BitmapDescriptor`).
class MapMarkerIcons {
  MapMarkerIcons._();

  static BitmapDescriptor? _car;
  static BitmapDescriptor? _userDot;
  static BitmapDescriptor? _dropoff;

  /// Üstten görünüm sarı taksi — ride-hailing UI referansına yakın.
  static Future<BitmapDescriptor> loadTaxiMarker() async {
    if (_car != null) return _car!;
    _car = await _buildTaxiMarker();
    return _car!;
  }

  /// Eski API uyumluluğu — [loadTaxiMarker] ile aynı.
  static Future<BitmapDescriptor> loadCarMarker() => loadTaxiMarker();

  /// Küçük mavi varış işareti (varsayılan kırmızı pinden farklı).
  static Future<BitmapDescriptor> loadDropoffMarker() async {
    if (_dropoff != null) return _dropoff!;
    _dropoff = await _buildDropoffMarker();
    return _dropoff!;
  }

  /// Siyah nokta + gri halo + yön oku (Google mavi nokta yerine).
  static Future<BitmapDescriptor> loadUserLocationMarker() async {
    if (_userDot != null) return _userDot!;
    _userDot = await _buildUserLocationMarker();
    return _userDot!;
  }

  static Future<BitmapDescriptor> _buildTaxiMarker() async {
    const double size = 128;
    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder);

    final cx = size / 2;
    final cy = size / 2;

    final shadow = Paint()
      ..color = const Color(0x33000000)
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 4);
    canvas.drawOval(
      Rect.fromCenter(center: Offset(cx, cy + 18), width: size * 0.42, height: 16),
      shadow,
    );

    final body = RRect.fromRectAndRadius(
      Rect.fromCenter(center: Offset(cx, cy), width: size * 0.52, height: size * 0.38),
      const Radius.circular(14),
    );
    final taxiYellow = Paint()..color = AppTheme.primaryColor;
    canvas.drawRRect(body, taxiYellow);

    final roof = RRect.fromRectAndRadius(
      Rect.fromCenter(center: Offset(cx, cy - 6), width: size * 0.34, height: size * 0.2),
      const Radius.circular(8),
    );
    canvas.drawRRect(
      roof,
      Paint()..color = const Color(0xFF2E2E2E),
    );

    final win = RRect.fromRectAndRadius(
      Rect.fromCenter(center: Offset(cx, cy + 2), width: size * 0.22, height: size * 0.1),
      const Radius.circular(4),
    );
    canvas.drawRRect(
      win,
      Paint()..color = const Color(0xFF90CAF9),
    );

    final hl = Paint()
      ..color = const Color(0x33FFFFFF)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2;
    canvas.drawRRect(body.deflate(2), hl);

    final picture = recorder.endRecording();
    final image = await picture.toImage(size.toInt(), size.toInt());
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    return BitmapDescriptor.fromBytes(bytes!.buffer.asUint8List());
  }

  static Future<BitmapDescriptor> _buildDropoffMarker() async {
    const double size = 40;
    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder);
    const blue = Color(0xFF2196F3);
    final c = Offset(size / 2, size / 2);
    canvas.drawCircle(c, 16, Paint()..color = blue);
    canvas.drawCircle(c, 6, Paint()..color = const Color(0xFFFFFFFF));
    canvas.drawCircle(c, 3, Paint()..color = blue);

    final picture = recorder.endRecording();
    final image = await picture.toImage(size.toInt(), size.toInt());
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    return BitmapDescriptor.fromBytes(bytes!.buffer.asUint8List());
  }

  static Future<BitmapDescriptor> _buildUserLocationMarker() async {
    const double size = 96;
    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder);

    final cx = size / 2;
    final cy = size / 2;

    final halo = Paint()..color = const Color(0x669E9E9E);
    canvas.drawCircle(Offset(cx, cy), 36, halo);

    final innerHalo = Paint()..color = const Color(0x339E9E9E);
    canvas.drawCircle(Offset(cx, cy), 26, innerHalo);

    canvas.drawCircle(Offset(cx, cy), 14, Paint()..color = const Color(0xFF212121));

    final path = Path()
      ..moveTo(cx, cy - 20)
      ..lineTo(cx - 6, cy - 10)
      ..lineTo(cx + 6, cy - 10)
      ..close();
    canvas.drawPath(path, Paint()..color = const Color(0xFFFFFFFF));

    final picture = recorder.endRecording();
    final image = await picture.toImage(size.toInt(), size.toInt());
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    return BitmapDescriptor.fromBytes(bytes!.buffer.asUint8List());
  }
}
