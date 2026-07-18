import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:lottie/lottie.dart';

import '../../core/theme/app_theme.dart';

/// Taksi aranırken radar + dönen taksiler + (isteğe bağlı) Lottie.
class RideSearchingAnimation extends StatefulWidget {
  const RideSearchingAnimation({
    super.key,
    this.height = 132,
    this.compact = false,
    this.showLottie = true,
  });

  final double height;
  final bool compact;
  final bool showLottie;

  @override
  State<RideSearchingAnimation> createState() => _RideSearchingAnimationState();
}

class _RideSearchingAnimationState extends State<RideSearchingAnimation>
    with SingleTickerProviderStateMixin {
  late final AnimationController _ctrl;

  @override
  void initState() {
    super.initState();
    _ctrl = AnimationController(
      vsync: this,
      duration: Duration(milliseconds: widget.compact ? 2200 : 2800),
    )..repeat();
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.compact) {
      return SizedBox(
        width: 40,
        height: 40,
        child: AnimatedBuilder(
          animation: _ctrl,
          builder: (context, _) => CustomPaint(
            painter: _SearchingPainter(
              t: _ctrl.value,
              compact: true,
              accent: AppTheme.primaryColor,
              pulse: AppTheme.info,
            ),
          ),
        ),
      );
    }

    return SizedBox(
      height: widget.height,
      width: double.infinity,
      child: AnimatedBuilder(
        animation: _ctrl,
        builder: (context, child) {
          return Stack(
            alignment: Alignment.center,
            children: [
              if (widget.showLottie)
                Opacity(
                  opacity: 0.38,
                  child: Lottie.asset(
                    'assets/animations/taxi_request_loading.json',
                    height: widget.height * 0.92,
                    fit: BoxFit.contain,
                    repeat: true,
                  ),
                ),
              CustomPaint(
                size: Size(double.infinity, widget.height),
                painter: _SearchingPainter(
                  t: _ctrl.value,
                  compact: false,
                  accent: AppTheme.primaryColor,
                  pulse: AppTheme.info,
                ),
              ),
              child!,
            ],
          );
        },
        child: _CenterTaxiBadge(t: _ctrl),
      ),
    );
  }
}

class _CenterTaxiBadge extends StatelessWidget {
  const _CenterTaxiBadge({required this.t});

  final Animation<double> t;

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: t,
      builder: (context, _) {
        final bob = math.sin(t.value * math.pi * 2) * 3;
        return Transform.translate(
          offset: Offset(0, bob),
          child: Container(
            width: 52,
            height: 52,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: Colors.white,
              boxShadow: [
                BoxShadow(
                  color: AppTheme.primaryColor.withOpacity(0.35),
                  blurRadius: 16,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
            child: Icon(
              LucideIcons.carTaxiFront,
              size: 30,
              color: AppTheme.primaryDark,
            ),
          ),
        );
      },
    );
  }
}

class _SearchingPainter extends CustomPainter {
  _SearchingPainter({
    required this.t,
    required this.compact,
    required this.accent,
    required this.pulse,
  });

  final double t;
  final bool compact;
  final Color accent;
  final Color pulse;

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final baseR = compact ? 14.0 : math.min(size.width, size.height) * 0.34;

    for (var i = 0; i < 3; i++) {
      final phase = (t + i * 0.28) % 1.0;
      final scale = 0.35 + phase * 0.95;
      final opacity = (1 - phase) * (compact ? 0.5 : 0.38);
      final paint = Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = compact ? 1.6 : 2.2
        ..color = pulse.withOpacity(opacity.clamp(0.0, 1.0));
      canvas.drawCircle(center, baseR * scale, paint);
    }

    if (!compact) {
      final orbitR = baseR * 0.72;
      for (var i = 0; i < 3; i++) {
        final angle = t * math.pi * 2 + i * (2 * math.pi / 3);
        final pos = center + Offset(math.cos(angle), math.sin(angle)) * orbitR;
        final iconPaint = Paint()..color = accent.withOpacity(0.92);
        _drawMiniTaxi(canvas, pos, iconPaint, 11);
      }

      final sweep = Paint()
        ..shader = SweepGradient(
          colors: [
            pulse.withOpacity(0),
            pulse.withOpacity(0.22),
            pulse.withOpacity(0),
          ],
          stops: const [0.0, 0.12, 0.24],
          transform: GradientRotation(t * math.pi * 2),
        ).createShader(Rect.fromCircle(center: center, radius: baseR * 1.05));
      canvas.drawCircle(center, baseR * 1.05, sweep);

      final pin = Paint()..color = pulse;
      canvas.drawCircle(center, 5, pin);
    }
  }

  void _drawMiniTaxi(Canvas canvas, Offset c, Paint fill, double s) {
    final path = Path()
      ..moveTo(c.dx - s, c.dy + s * 0.35)
      ..lineTo(c.dx - s * 0.55, c.dy - s * 0.55)
      ..lineTo(c.dx + s * 0.15, c.dy - s * 0.55)
      ..lineTo(c.dx + s * 0.55, c.dy - s * 0.15)
      ..lineTo(c.dx + s, c.dy + s * 0.35)
      ..close();
    canvas.drawPath(path, fill);
    canvas.drawCircle(c + Offset(-s * 0.45, s * 0.55), s * 0.22, fill);
    canvas.drawCircle(c + Offset(s * 0.45, s * 0.55), s * 0.22, fill);
  }

  @override
  bool shouldRepaint(covariant _SearchingPainter old) => old.t != t;
}

/// İlerleme çubuğunda akan parıltı.
class RideSearchingShimmerBar extends StatefulWidget {
  const RideSearchingShimmerBar({
    super.key,
    required this.value,
    this.minHeight = 8,
  });

  final double? value;
  final double minHeight;

  @override
  State<RideSearchingShimmerBar> createState() => _RideSearchingShimmerBarState();
}

class _RideSearchingShimmerBarState extends State<RideSearchingShimmerBar>
    with SingleTickerProviderStateMixin {
  late final AnimationController _shimmer;

  @override
  void initState() {
    super.initState();
    _shimmer = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1400),
    )..repeat();
  }

  @override
  void dispose() {
    _shimmer.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final v = widget.value;
    return ClipRRect(
      borderRadius: BorderRadius.circular(999),
      child: SizedBox(
        height: widget.minHeight,
        child: Stack(
          fit: StackFit.expand,
          children: [
            LinearProgressIndicator(
              minHeight: widget.minHeight,
              value: v,
              backgroundColor: const Color(0xFFE5E7EB),
              valueColor: const AlwaysStoppedAnimation<Color>(AppTheme.success),
            ),
            AnimatedBuilder(
              animation: _shimmer,
              builder: (context, _) {
                return LayoutBuilder(
                  builder: (context, constraints) {
                    final w = constraints.maxWidth;
                    final fillW = v != null ? w * v.clamp(0.04, 1.0) : w * 0.35;
                    final x = -w * 0.35 + (_shimmer.value * (fillW + w * 0.7));
                    return ClipRect(
                      child: Align(
                        alignment: Alignment.centerLeft,
                        widthFactor: v ?? 0.35,
                        child: Transform.translate(
                          offset: Offset(x, 0),
                          child: Container(
                            width: w * 0.28,
                            decoration: BoxDecoration(
                              gradient: LinearGradient(
                                colors: [
                                  Colors.white.withOpacity(0),
                                  Colors.white.withOpacity(0.55),
                                  Colors.white.withOpacity(0),
                                ],
                              ),
                            ),
                          ),
                        ),
                      ),
                    );
                  },
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}

/// "Bekleniyor…" / durum metni için nabız noktaları.
class RideSearchingDots extends StatefulWidget {
  const RideSearchingDots({super.key});

  @override
  State<RideSearchingDots> createState() => _RideSearchingDotsState();
}

class _RideSearchingDotsState extends State<RideSearchingDots>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c;

  @override
  void initState() {
    super.initState();
    _c = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1200),
    )..repeat();
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _c,
      builder: (context, _) {
        return Row(
          mainAxisSize: MainAxisSize.min,
          children: List.generate(3, (i) {
            final phase = (_c.value + i * 0.2) % 1.0;
            final y = math.sin(phase * math.pi * 2) * 2;
            final opacity = 0.35 + (math.sin(phase * math.pi * 2) + 1) * 0.325;
            return Padding(
              padding: const EdgeInsets.only(left: 3),
              child: Transform.translate(
                offset: Offset(0, y),
                child: Container(
                  width: 5,
                  height: 5,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: AppTheme.info.withOpacity(opacity),
                  ),
                ),
              ),
            );
          }),
        );
      },
    );
  }
}
