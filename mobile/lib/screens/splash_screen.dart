import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:google_fonts/google_fonts.dart';
import '../core/theme/app_theme.dart';
import '../core/widgets/brand_logo.dart';
import '../models/user_model.dart';
import '../providers/providers.dart';

/// Splash — sinematik açılış: radyal parıltı, yüzen parçacıklar, logo shimmer, kademeli metin girişi.
class SplashScreen extends ConsumerStatefulWidget {
  const SplashScreen({super.key});

  @override
  ConsumerState<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends ConsumerState<SplashScreen>
    with TickerProviderStateMixin {
  // ─── Ana sahne kontrolcüleri ───
  late final AnimationController _bgRevealCtrl;
  late final AnimationController _logoCtrl;
  late final AnimationController _shimmerCtrl;
  late final AnimationController _textCtrl;
  late final AnimationController _particleCtrl;
  late final AnimationController _progressCtrl;

  @override
  void initState() {
    super.initState();

    // 1) Arka plan radyal açılım (0→1)
    _bgRevealCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1400),
    );

    // 2) Logo giriş (scale + fade)
    _logoCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 900),
    );

    // 3) Shimmer süpürme (sonsuz döngü)
    _shimmerCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 2200),
    );

    // 4) Alt metin kademeli giriş
    _textCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 800),
    );

    // 5) Parçacık sistemi (sonsuz)
    _particleCtrl = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 8),
    );

    // 6) İlerleme çubuğu
    _progressCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1800),
    );

    // ─── Koreografi ───
    _bgRevealCtrl.forward();
    Future<void>.delayed(const Duration(milliseconds: 400), () {
      if (!mounted) return;
      _logoCtrl.forward();
      _particleCtrl.repeat();
    });
    Future<void>.delayed(const Duration(milliseconds: 900), () {
      if (!mounted) return;
      _shimmerCtrl.repeat();
    });
    Future<void>.delayed(const Duration(milliseconds: 1100), () {
      if (!mounted) return;
      _textCtrl.forward();
      _progressCtrl.repeat();
    });

    _checkAuth();
  }

  @override
  void dispose() {
    _bgRevealCtrl.dispose();
    _logoCtrl.dispose();
    _shimmerCtrl.dispose();
    _textCtrl.dispose();
    _particleCtrl.dispose();
    _progressCtrl.dispose();
    super.dispose();
  }

  // ─── Auth akışı (mevcut mantık korunuyor) ───
  Future<void> _checkAuth() async {
    final storage = ref.read(storageServiceProvider);
    await storage.init();

    final userNotifier = ref.read(currentUserProvider.notifier);
    final platform = ref.read(platformConfigProvider.notifier);

    await Future.wait([
      userNotifier.loadSavedUser(),
      platform.refresh().timeout(
            const Duration(seconds: 3),
            onTimeout: () {},
          ),
    ]);

    if (!mounted) return;

    final UserModel? userInitial = ref.read(currentUserProvider);
    if (userInitial == null) {
      await Future<void>.delayed(const Duration(milliseconds: 280));
      if (!mounted) return;
      if (!storage.isOnboardingCompleted()) {
        context.go('/onboarding');
      } else {
        context.go('/auth/login');
      }
      return;
    }

    final tokenBefore = await storage.getAccessToken();
    try {
      await userNotifier.refreshProfileFromApi().timeout(
            const Duration(seconds: 6),
            onTimeout: () {},
          );
    } catch (_) {}

    if (!mounted) return;

    final UserModel? userAfterMe = ref.read(currentUserProvider);
    if (userAfterMe == null) {
      if (!storage.isOnboardingCompleted()) {
        context.go('/onboarding');
      } else {
        context.go('/auth/login');
      }
      return;
    }

    await Future<void>.delayed(const Duration(milliseconds: 320));
    if (!mounted) return;

    final tokenAfter = await storage.getAccessToken();
    if (tokenAfter != null) {
      final renewed = tokenBefore != null && tokenBefore != tokenAfter;
      if (!renewed) {
        ref.read(socketServiceProvider).connect(tokenAfter);
      }
    }
    if (!mounted) return;

    if (userAfterMe.isAdmin) {
      context.go('/admin');
    } else {
      context.go(userAfterMe.isDriver ? '/driver' : '/customer');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF050810),
      body: AnimatedBuilder(
        animation: Listenable.merge([
          _bgRevealCtrl,
          _logoCtrl,
          _shimmerCtrl,
          _textCtrl,
          _particleCtrl,
          _progressCtrl,
        ]),
        builder: (context, _) => Stack(
          fit: StackFit.expand,
          children: [
            // ─── Katman 1: Radyal arka plan açılımı ───
            _buildBackground(),

            // ─── Katman 2: Yüzen parçacıklar ───
            _buildParticles(),

            // ─── Katman 3: Ana içerik ───
            _buildCenterContent(),
          ],
        ),
      ),
    );
  }

  // ═══════════════════════════════════════════════════════════
  // ARKA PLAN
  // ═══════════════════════════════════════════════════════════
  Widget _buildBackground() {
    final reveal = CurvedAnimation(
      parent: _bgRevealCtrl,
      curve: Curves.easeOutExpo,
    ).value;

    return Stack(
      fit: StackFit.expand,
      children: [
        // Derin zemin
        Container(
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                Color(0xFF050810),
                Color(0xFF0B1228),
                Color(0xFF0A0F1E),
              ],
            ),
          ),
        ),

        // Radyal altın parıltı — merkez
        Positioned.fill(
          child: Opacity(
            opacity: reveal,
            child: Transform.scale(
              scale: 0.5 + reveal * 0.5,
              child: Container(
                decoration: BoxDecoration(
                  gradient: RadialGradient(
                    center: Alignment.center,
                    radius: 0.7,
                    colors: [
                      AppTheme.primaryColor.withOpacity(0.12 * reveal),
                      AppTheme.primaryColor.withOpacity(0.04 * reveal),
                      Colors.transparent,
                    ],
                    stops: const [0.0, 0.4, 1.0],
                  ),
                ),
              ),
            ),
          ),
        ),

        // Üst-sağ mavi orb
        Positioned(
          top: -60,
          right: -40,
          child: Opacity(
            opacity: (reveal * 0.7).clamp(0.0, 1.0),
            child: Container(
              width: 240,
              height: 240,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: RadialGradient(
                  colors: [
                    AppTheme.info.withOpacity(0.15),
                    AppTheme.info.withOpacity(0.0),
                  ],
                ),
              ),
            ),
          ),
        ),

        // Alt-sol mor orb
        Positioned(
          bottom: -80,
          left: -60,
          child: Opacity(
            opacity: (reveal * 0.6).clamp(0.0, 1.0),
            child: Container(
              width: 280,
              height: 280,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: RadialGradient(
                  colors: [
                    const Color(0xFF7C3AED).withOpacity(0.12),
                    const Color(0xFF7C3AED).withOpacity(0.0),
                  ],
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }

  // ═══════════════════════════════════════════════════════════
  // YÜZEN PARÇACIKLAR
  // ═══════════════════════════════════════════════════════════
  Widget _buildParticles() {
    return CustomPaint(
      painter: _ParticlePainter(
        progress: _particleCtrl.value,
        color: AppTheme.primaryColor,
      ),
      size: Size.infinite,
    );
  }

  // ═══════════════════════════════════════════════════════════
  // MERKEZ İÇERİK
  // ═══════════════════════════════════════════════════════════
  Widget _buildCenterContent() {
    final logoScale = CurvedAnimation(
      parent: _logoCtrl,
      curve: Curves.easeOutBack,
    ).value;
    final logoFade = CurvedAnimation(
      parent: _logoCtrl,
      curve: Curves.easeOut,
    ).value;

    final textSlide = CurvedAnimation(
      parent: _textCtrl,
      curve: Curves.easeOutCubic,
    ).value;

    final shimmerVal = _shimmerCtrl.value;

    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // ─── Logo + shimmer ───
          Opacity(
            opacity: logoFade,
            child: Transform.scale(
              scale: 0.6 + logoScale * 0.4,
              child: Container(
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(20),
                  boxShadow: [
                    BoxShadow(
                      color: AppTheme.primaryColor.withOpacity(0.25 * logoFade),
                      blurRadius: 40,
                      spreadRadius: 4,
                      offset: const Offset(0, 8),
                    ),
                    BoxShadow(
                      color: AppTheme.primaryColor.withOpacity(0.08 * logoFade),
                      blurRadius: 80,
                      spreadRadius: 12,
                    ),
                  ],
                ),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(28),
                  child: SizedBox(
                    width: 160,
                    height: 160,
                    child: Stack(
                      children: [
                        // Logo
                        const Hero(
                          tag: AppTheme.brandHeroTag,
                          child: Material(
                            type: MaterialType.transparency,
                            child: BrandLogo(
                              width: 160,
                              height: 160,
                              borderRadius: 28,
                            ),
                          ),
                        ),
                        // Shimmer süpürme efekti
                        Positioned.fill(
                          child: _ShimmerOverlay(progress: shimmerVal),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(height: 32),

          // ─── "TAKSİM GELSİN" ───
          Transform.translate(
            offset: Offset(0, 18 * (1 - textSlide)),
            child: Opacity(
              opacity: textSlide,
              child: Text(
                'TAKSİM GELSİN',
                style: GoogleFonts.inter(
                  fontSize: 22,
                  fontWeight: FontWeight.w800,
                  letterSpacing: 5.0,
                  color: Colors.white.withOpacity(0.95),
                  shadows: [
                    Shadow(
                      color: AppTheme.primaryColor.withOpacity(0.5),
                      blurRadius: 20,
                    ),
                  ],
                ),
              ),
            ),
          ),
          const SizedBox(height: 10),

          // ─── Slogan ───
          Transform.translate(
            offset: Offset(0, 24 * (1 - textSlide)),
            child: Opacity(
              opacity: (textSlide - 0.3).clamp(0.0, 1.0) / 0.7,
              child: Text(
                'Güvenli ve hızlı ulaşım',
                style: GoogleFonts.poppins(
                  fontSize: 13,
                  fontWeight: FontWeight.w400,
                  letterSpacing: 1.2,
                  color: Colors.white.withOpacity(0.5),
                ),
              ),
            ),
          ),
          const SizedBox(height: 48),

          // ─── Parlayan ilerleme göstergesi ───
          Transform.translate(
            offset: Offset(0, 20 * (1 - textSlide)),
            child: Opacity(
              opacity: textSlide,
              child: SizedBox(
                width: 40,
                height: 40,
                child: _GlowingProgress(progress: _progressCtrl.value),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ═══════════════════════════════════════════════════════════════
// SHIMMER OVERLAY — logo üzerinde süzülen parlak şerit
// ═══════════════════════════════════════════════════════════════
class _ShimmerOverlay extends StatelessWidget {
  const _ShimmerOverlay({required this.progress});
  final double progress;

  @override
  Widget build(BuildContext context) {
    return ShaderMask(
      shaderCallback: (bounds) {
        final x = -0.5 + progress * 2.0;
        return LinearGradient(
          begin: Alignment(x - 0.3, -0.3),
          end: Alignment(x + 0.3, 0.3),
          colors: [
            Colors.transparent,
            Colors.white.withOpacity(0.18),
            Colors.white.withOpacity(0.28),
            Colors.white.withOpacity(0.18),
            Colors.transparent,
          ],
          stops: const [0.0, 0.35, 0.5, 0.65, 1.0],
        ).createShader(bounds);
      },
      blendMode: BlendMode.srcATop,
      child: Container(color: Colors.white.withOpacity(0.01)),
    );
  }
}

// ═══════════════════════════════════════════════════════════════
// PARÇACIK SİSTEMİ — yüzen altın noktalar
// ═══════════════════════════════════════════════════════════════
class _ParticlePainter extends CustomPainter {
  _ParticlePainter({required this.progress, required this.color});
  final double progress;
  final Color color;

  static final List<_Particle> _particles = List.generate(18, (i) {
    final rng = math.Random(i * 42 + 7);
    return _Particle(
      x: rng.nextDouble(),
      y: rng.nextDouble(),
      size: 1.5 + rng.nextDouble() * 2.5,
      speed: 0.3 + rng.nextDouble() * 0.7,
      phase: rng.nextDouble() * math.pi * 2,
      opacity: 0.15 + rng.nextDouble() * 0.35,
    );
  });

  @override
  void paint(Canvas canvas, Size size) {
    for (final p in _particles) {
      final t = (progress * p.speed + p.phase / (math.pi * 2)) % 1.0;
      final px = p.x * size.width + math.sin(t * math.pi * 2 + p.phase) * 20;
      final py = (p.y - t * 0.4) % 1.0 * size.height;
      final alpha = p.opacity * (0.5 + 0.5 * math.sin(t * math.pi * 2));

      // Glow halo
      canvas.drawCircle(
        Offset(px, py),
        p.size * 3,
        Paint()
          ..color = color.withOpacity(alpha * 0.15)
          ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 8),
      );

      // Core dot
      canvas.drawCircle(
        Offset(px, py),
        p.size,
        Paint()..color = color.withOpacity(alpha),
      );
    }
  }

  @override
  bool shouldRepaint(covariant _ParticlePainter old) => old.progress != progress;
}

class _Particle {
  final double x, y, size, speed, phase, opacity;
  const _Particle({
    required this.x,
    required this.y,
    required this.size,
    required this.speed,
    required this.phase,
    required this.opacity,
  });
}

// ═══════════════════════════════════════════════════════════════
// PARLAYAN İLERLEME — dönen altın halka
// ═══════════════════════════════════════════════════════════════
class _GlowingProgress extends StatelessWidget {
  const _GlowingProgress({required this.progress});
  final double progress;

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      painter: _GlowRingPainter(progress: progress),
    );
  }
}

class _GlowRingPainter extends CustomPainter {
  _GlowRingPainter({required this.progress});
  final double progress;

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final radius = size.width / 2 - 4;

    // Track
    canvas.drawCircle(
      center,
      radius,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2
        ..color = Colors.white.withOpacity(0.08),
    );

    // Arc glow
    final sweep = math.pi * 0.8;
    final startAngle = progress * math.pi * 2 - math.pi / 2;

    // Outer glow
    canvas.drawArc(
      Rect.fromCircle(center: center, radius: radius),
      startAngle,
      sweep,
      false,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 5
        ..strokeCap = StrokeCap.round
        ..color = AppTheme.primaryColor.withOpacity(0.2)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 6),
    );

    // Core arc
    canvas.drawArc(
      Rect.fromCircle(center: center, radius: radius),
      startAngle,
      sweep,
      false,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2.5
        ..strokeCap = StrokeCap.round
        ..shader = SweepGradient(
          startAngle: startAngle,
          endAngle: startAngle + sweep,
          colors: [
            AppTheme.primaryColor.withOpacity(0.0),
            AppTheme.primaryColor.withOpacity(0.9),
            AppTheme.primaryColor,
          ],
        ).createShader(Rect.fromCircle(center: center, radius: radius)),
    );

    // Tip dot
    final tipAngle = startAngle + sweep;
    final tipX = center.dx + radius * math.cos(tipAngle);
    final tipY = center.dy + radius * math.sin(tipAngle);

    canvas.drawCircle(
      Offset(tipX, tipY),
      3.5,
      Paint()..color = AppTheme.primaryColor,
    );
    canvas.drawCircle(
      Offset(tipX, tipY),
      6,
      Paint()
        ..color = AppTheme.primaryColor.withOpacity(0.25)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 4),
    );
  }

  @override
  bool shouldRepaint(covariant _GlowRingPainter old) => old.progress != progress;
}
