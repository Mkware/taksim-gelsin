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

  /// Konum baloncuğu — biniş noktasının üstünde (koyu zemin, beyaz yazı).
  static Future<BitmapDescriptor> buildOriginLabelMarker(String text) {
    return _buildLabelBubbleMarker(
      text,
      background: AppTheme.ink,
      foreground: const Color(0xFFFFFFFF),
    );
  }

  /// Varış baloncuğu — adresi gösterir (marka rengi zemin, koyu yazı).
  static Future<BitmapDescriptor> buildDestinationLabelMarker(String text) {
    return _buildLabelBubbleMarker(
      text,
      background: AppTheme.primaryColor,
      foreground: AppTheme.ink,
    );
  }

  /// Metin baloncuğu + alttan sivri kuyruklu pin — konum adı etiketi.
  /// Metin dinamik olduğundan (statik ikonların aksine) her çağrıda yeniden çizilir.
  static Future<BitmapDescriptor> _buildLabelBubbleMarker(
    String text, {
    required Color background,
    required Color foreground,
  }) async {
    final label = _truncateLabel(text.trim(), 28);
    final textPainter = TextPainter(
      text: TextSpan(
        text: label.isEmpty ? ' ' : label,
        style: TextStyle(
          color: foreground,
          fontSize: 20,
          fontWeight: FontWeight.w700,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout(maxWidth: 440);

    const hPad = 16.0;
    const vPad = 10.0;
    const tailHeight = 12.0;
    const tailWidth = 16.0;
    const dotOuterRadius = 7.0;
    const dotInnerRadius = 3.5;
    const dotGap = 3.0;
    const bubbleRadius = 14.0;

    final bubbleWidth = textPainter.width + hPad * 2;
    final bubbleHeight = textPainter.height + vPad * 2;
    final totalWidth = bubbleWidth;
    final totalHeight = bubbleHeight + tailHeight + dotOuterRadius * 2 + dotGap;

    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder);

    final bubbleRect = RRect.fromRectAndRadius(
      Rect.fromLTWH(0, 3, bubbleWidth, bubbleHeight),
      const Radius.circular(bubbleRadius),
    );

    final shadowPaint = Paint()
      ..color = const Color(0x40000000)
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 5);
    canvas.drawRRect(bubbleRect, shadowPaint);
    canvas.drawRRect(bubbleRect, Paint()..color = background);

    final tailCenterX = bubbleWidth / 2;
    final tailPath = Path()
      ..moveTo(tailCenterX - tailWidth / 2, bubbleHeight)
      ..lineTo(tailCenterX + tailWidth / 2, bubbleHeight)
      ..lineTo(tailCenterX, bubbleHeight + tailHeight)
      ..close();
    canvas.drawPath(tailPath, Paint()..color = background);

    textPainter.paint(canvas, Offset(hPad, vPad));

    final dotCenter = Offset(
      tailCenterX,
      bubbleHeight + tailHeight + dotGap + dotOuterRadius,
    );
    canvas.drawCircle(dotCenter, dotOuterRadius, Paint()..color = const Color(0xFFFFFFFF));
    canvas.drawCircle(dotCenter, dotInnerRadius, Paint()..color = background);

    final picture = recorder.endRecording();
    final image = await picture.toImage(totalWidth.ceil(), totalHeight.ceil());
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    return BitmapDescriptor.fromBytes(bytes!.buffer.asUint8List());
  }

  static String _truncateLabel(String text, int maxChars) {
    if (text.length <= maxChars) return text;
    return '${text.substring(0, maxChars - 1)}…';
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
