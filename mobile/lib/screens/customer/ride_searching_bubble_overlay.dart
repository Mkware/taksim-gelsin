import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:shimmer/shimmer.dart';

import '../../core/theme/app_theme.dart';
import 'ride_searching_animation.dart';

/// Harita üstü — konuşma balonu içinde taksi arama animasyonu.
class RideSearchingBubbleOverlay extends StatefulWidget {
  const RideSearchingBubbleOverlay({super.key});

  @override
  State<RideSearchingBubbleOverlay> createState() =>
      _RideSearchingBubbleOverlayState();
}

class _RideSearchingBubbleOverlayState extends State<RideSearchingBubbleOverlay>
    with TickerProviderStateMixin {
  late final AnimationController _headlineGlow;
  late final AnimationController _enter;

  static const _headline = 'Sana en uygun taksiyi yönlendiriyoruz';

  @override
  void initState() {
    super.initState();
    _headlineGlow = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 2400),
    )..repeat(reverse: true);
    _enter = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 420),
    )..forward();
  }

  @override
  void dispose() {
    _headlineGlow.dispose();
    _enter.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FadeTransition(
      opacity: CurvedAnimation(parent: _enter, curve: Curves.easeOut),
      child: SlideTransition(
        position: Tween<Offset>(begin: const Offset(0, -0.08), end: Offset.zero)
            .animate(CurvedAnimation(parent: _enter, curve: Curves.easeOutCubic)),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Material(
              color: Colors.transparent,
              elevation: 0,
              child: Container(
                width: double.infinity,
                padding: const EdgeInsets.fromLTRB(14, 12, 14, 10),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(22),
                  border: Border.all(color: const Color(0xFFE8EAEF)),
                  boxShadow: [
                    BoxShadow(
                      color: AppTheme.ink.withValues(alpha: 0.1),
                      blurRadius: 28,
                      offset: const Offset(0, 10),
                    ),
                  ],
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const RideSearchingAnimation(height: 108),
                    const SizedBox(height: 8),
                    AnimatedBuilder(
                      animation: _headlineGlow,
                      builder: (context, child) {
                        final glow = 0.55 + _headlineGlow.value * 0.45;
                        return Shimmer.fromColors(
                          baseColor: AppTheme.ink.withValues(alpha: 0.88),
                          highlightColor:
                              AppTheme.primaryColor.withValues(alpha: glow * 0.85),
                          period: const Duration(milliseconds: 1800),
                          child: child!,
                        );
                      },
                      child: Text(
                        _headline,
                        textAlign: TextAlign.center,
                        style: GoogleFonts.inter(
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                          color: AppTheme.ink,
                          height: 1.25,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            CustomPaint(
              size: const Size(22, 11),
              painter: _BubbleTailPainter(
                fill: Colors.white,
                border: const Color(0xFFE8EAEF),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _BubbleTailPainter extends CustomPainter {
  _BubbleTailPainter({required this.fill, required this.border});

  final Color fill;
  final Color border;

  @override
  void paint(Canvas canvas, Size size) {
    final path = Path()
      ..moveTo(0, 0)
      ..lineTo(size.width, 0)
      ..lineTo(size.width / 2, size.height)
      ..close();

    canvas.drawPath(
      path,
      Paint()
        ..color = border
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.2,
    );
    canvas.drawPath(path, Paint()..color = fill);
  }

  @override
  bool shouldRepaint(covariant _BubbleTailPainter old) =>
      old.fill != fill || old.border != border;
}
