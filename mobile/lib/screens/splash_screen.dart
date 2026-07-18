import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../core/theme/app_theme.dart';
import '../models/user_model.dart';
import '../providers/providers.dart';

/// Splash logosu — [_kSplashLogoAsset] mevcut marka logosunun (assets/images/brand_logo.png)
/// arka planı kaldırılmış, sıkı kırpılmış hali. Logo pikselleri/oranları/renkleri/fontu
/// değişmedi; yalnızca düz lacivert dolgu şeffaflaştırıldı ki logo bu ekranın kendi
/// lacivert gradyanı üzerine kaynaşarak otursun (bkz. brand_logo.dart — diğer ekranlar
/// hâlâ opak orijinal logoyu kullanıyor, bu değişiklik yalnızca splash'e özel).
const String _kSplashLogoAsset = 'assets/images/brand_logo_splash.png';

/// Logo görselindeki dikey bantlar (pin / yazı / alt çizgi) — piksel analizinden
/// ölçülen boşluk aralıklarının orta noktaları. Sahne koreografisi bu bantları
/// bağımsız olarak canlandırmak için görseli üçe böler (kırpma dışında görsel
/// değişmez).
const double _kPinBandEnd = 0.236;
const double _kTextBandEnd = 0.769;

/// Kaynak PNG oranı (1304x958) — mevcut logonun en-boy oranı, değiştirilmedi.
const double _kLogoAspect = 1304 / 958;

class SplashScreen extends ConsumerStatefulWidget {
  const SplashScreen({super.key});

  @override
  ConsumerState<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends ConsumerState<SplashScreen>
    with TickerProviderStateMixin {
  // 1-2) Arka plan + merkez yumuşak ışık
  late final AnimationController _bgCtrl;
  // 3) Sarı pin — yukarıdan hafif zıplayarak gelir
  late final AnimationController _pinCtrl;
  // 4) Logo (yazı) — %90→%100 ölçek + opaklık
  late final AnimationController _textCtrl;
  // 5) Alt çizgi — soldan sağa çizilir
  late final AnimationController _curveCtrl;
  // 6) Logonun arkasında hafif sarı parlama
  late final AnimationController _glowCtrl;
  // 7) Nefes alma (%100 → %102 → %100), sonsuz döngü
  late final AnimationController _breatheCtrl;

  /// Sahne koreografisinin tamamı (pin inişi → yazı → alt çizgi → sarı
  /// parlama → nefes alma başlangıcı) oynanana kadar geçmesi gereken süre —
  /// auth kontrolü ağdan çok hızlı dönerse (ör. zaten oturum açık bir
  /// kullanıcı) bile ekran erken kesilip animasyon yarıda kalmasın.
  static const Duration _minSplashDuration = Duration(milliseconds: 1400);
  final Stopwatch _splashStopwatch = Stopwatch()..start();

  Future<void> _awaitMinimumSplashDuration() async {
    final remaining = _minSplashDuration - _splashStopwatch.elapsed;
    if (remaining > Duration.zero) {
      await Future<void>.delayed(remaining);
    }
  }

  @override
  void initState() {
    super.initState();

    _bgCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 850),
    );
    _pinCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 450),
    );
    _textCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 500),
    );
    _curveCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 400),
    );
    _glowCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 350),
    );
    _breatheCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1500),
    );

    // ─── Koreografi ───
    _bgCtrl.forward();
    Future<void>.delayed(const Duration(milliseconds: 230), () {
      if (!mounted) return;
      _pinCtrl.forward();
    });
    Future<void>.delayed(const Duration(milliseconds: 300), () {
      if (!mounted) return;
      _textCtrl.forward();
    });
    Future<void>.delayed(const Duration(milliseconds: 700), () {
      if (!mounted) return;
      _curveCtrl.forward();
    });
    Future<void>.delayed(const Duration(milliseconds: 1000), () {
      if (!mounted) return;
      _glowCtrl.forward();
    });
    Future<void>.delayed(const Duration(milliseconds: 1300), () {
      if (!mounted) return;
      _breatheCtrl.repeat(reverse: true);
    });

    _checkAuth();
  }

  @override
  void dispose() {
    _bgCtrl.dispose();
    _pinCtrl.dispose();
    _textCtrl.dispose();
    _curveCtrl.dispose();
    _glowCtrl.dispose();
    _breatheCtrl.dispose();
    super.dispose();
  }

  // ─── Auth akışı (mevcut mantık korunuyor) ───
  Future<void> _checkAuth() async {
    try {
      await _checkAuthInner();
    } catch (e) {
      // Ne olursa olsun splash'te asılı kalma (ör. yedekten dönen bozuk depo verisi) —
      // oturumsuz akışa düş.
      debugPrint('Splash auth kontrolü hatası: $e');
      await _awaitMinimumSplashDuration();
      if (!mounted) return;
      var onboarded = true;
      try {
        onboarded = ref.read(storageServiceProvider).isOnboardingCompleted();
      } catch (_) {}
      context.go(onboarded ? '/auth/login' : '/onboarding');
    }
  }

  Future<void> _checkAuthInner() async {
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
      await _awaitMinimumSplashDuration();
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
      await _awaitMinimumSplashDuration();
      if (!mounted) return;
      if (!storage.isOnboardingCompleted()) {
        context.go('/onboarding');
      } else {
        context.go('/auth/login');
      }
      return;
    }

    await _awaitMinimumSplashDuration();
    if (!mounted) return;

    final tokenAfter = await storage.getAccessToken();
    if (tokenAfter != null) {
      final renewed = tokenBefore != null && tokenBefore != tokenAfter;
      if (!renewed) {
        ref.read(socketServiceProvider).connect(tokenAfter);
      }
    }
    if (!mounted) return;

    context.go(userAfterMe.isDriver ? '/driver' : '/customer');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF031E5C),
      body: AnimatedBuilder(
        animation: Listenable.merge([
          _bgCtrl,
          _pinCtrl,
          _textCtrl,
          _curveCtrl,
          _glowCtrl,
          _breatheCtrl,
        ]),
        builder: (context, _) => Stack(
          fit: StackFit.expand,
          children: [
            _buildBackground(),
            Center(child: _buildLogo(context)),
          ],
        ),
      ),
    );
  }

  // ═══════════════════════════════════════════════════════════
  // 1-2) ARKA PLAN — hafif lacivert gradyan + yumuşak merkez ışığı
  // ═══════════════════════════════════════════════════════════
  Widget _buildBackground() {
    final reveal = CurvedAnimation(
      parent: _bgCtrl,
      curve: Curves.easeOutExpo,
    ).value;

    return Stack(
      fit: StackFit.expand,
      children: [
        // Zemin — düz görünmesin diye çok hafif köşegen gradyan
        const DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                Color(0xFF0A2D6B),
                Color(0xFF031E5C),
                Color(0xFF020F38),
              ],
              stops: [0.0, 0.55, 1.0],
            ),
          ),
        ),

        // Merkezde çok hafif, dikkat dağıtmayan ışık
        Opacity(
          opacity: reveal,
          child: const DecoratedBox(
            decoration: BoxDecoration(
              gradient: RadialGradient(
                center: Alignment.center,
                radius: 0.75,
                colors: [
                  Color(0x14EFF1F9),
                  Color(0x00EFF1F9),
                ],
                stops: [0.0, 1.0],
              ),
            ),
          ),
        ),

        // Alt kenarda çok hafif gölge — zemine derinlik/oturma hissi
        Align(
          alignment: Alignment.bottomCenter,
          child: Opacity(
            opacity: reveal * 0.5,
            child: Container(
              height: 260,
              decoration: const BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.bottomCenter,
                  end: Alignment.topCenter,
                  colors: [
                    Color(0xFF3D476D),
                    Color(0x003D476D),
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
  // MERKEZ LOGO — pin / yazı / alt çizgi bağımsız canlandırılır
  // ═══════════════════════════════════════════════════════════
  Widget _buildLogo(BuildContext context) {
    final logoW = MediaQuery.of(context).size.width * 0.56;
    final logoH = logoW / _kLogoAspect;

    // 3) Pin — yukarıdan hafif zıplayarak gelir
    final pinDrop = CurvedAnimation(parent: _pinCtrl, curve: Curves.easeOutBack);
    final pinOpacity = CurvedAnimation(
      parent: _pinCtrl,
      curve: const Interval(0.0, 0.45, curve: Curves.easeOut),
    ).value;
    final pinOffsetY = (1 - pinDrop.value) * -(logoH * 0.55);

    // 4) Logo (yazı) — %90 → %100 ölçek + opaklık
    final textScale = Tween<double>(begin: 0.90, end: 1.0)
        .animate(CurvedAnimation(parent: _textCtrl, curve: Curves.easeOutCubic))
        .value;
    final textOpacity = CurvedAnimation(
      parent: _textCtrl,
      curve: Curves.easeOut,
    ).value;

    // 5) Alt çizgi — soldan sağa çizilir
    final curveProgress = CurvedAnimation(
      parent: _curveCtrl,
      curve: Curves.easeInOutCubic,
    ).value;

    // 6) Logonun arkasında hafif sarı parlama (~%10 opaklık)
    final glowOpacity = CurvedAnimation(
      parent: _glowCtrl,
      curve: Curves.easeOut,
    ).value * 0.10;

    // 7) Nefes alma — %100 → %102 → %100
    final breathe = 1.0 +
        (Curves.easeInOut.transform(_breatheCtrl.value) * 0.02);

    final pinBandH = logoH * _kPinBandEnd;
    final textBandH = logoH * (_kTextBandEnd - _kPinBandEnd);
    final curveBandH = logoH * (1.0 - _kTextBandEnd);

    return Transform.scale(
      scale: breathe,
      child: SizedBox(
        width: logoW,
        height: logoH * 1.35,
        child: Stack(
          alignment: Alignment.center,
          children: [
            // Sarı parlama — logonun arkasında
            Opacity(
              opacity: glowOpacity,
              child: Container(
                width: logoW * 0.9,
                height: logoW * 0.9,
                decoration: const BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: RadialGradient(
                    colors: [
                      Color(0xFFF6CF21),
                      Color(0x00F6CF21),
                    ],
                  ),
                ),
              ),
            ),

            Hero(
              tag: AppTheme.brandHeroTag,
              child: Material(
                type: MaterialType.transparency,
                child: SizedBox(
                  width: logoW,
                  height: logoH,
                  child: Stack(
                    clipBehavior: Clip.none,
                    children: [
                      // Pin
                      Positioned(
                        top: 0,
                        left: 0,
                        child: Transform.translate(
                          offset: Offset(0, pinOffsetY),
                          child: Opacity(
                            opacity: pinOpacity,
                            child: _bandSlice(
                              topFrac: 0.0,
                              bottomFrac: _kPinBandEnd,
                              logoW: logoW,
                              logoH: logoH,
                            ),
                          ),
                        ),
                      ),

                      // Yazı (TAKSİM GELSİN)
                      Positioned(
                        top: pinBandH,
                        left: 0,
                        child: Opacity(
                          opacity: textOpacity,
                          child: Transform.scale(
                            scale: textScale,
                            child: _bandSlice(
                              topFrac: _kPinBandEnd,
                              bottomFrac: _kTextBandEnd,
                              logoW: logoW,
                              logoH: logoH,
                            ),
                          ),
                        ),
                      ),

                      // Alt çizgi — soldan sağa çizilir
                      Positioned(
                        top: pinBandH + textBandH,
                        left: 0,
                        child: ClipRect(
                          child: Align(
                            alignment: Alignment.centerLeft,
                            widthFactor: curveProgress.clamp(0.0001, 1.0),
                            child: _bandSlice(
                              topFrac: _kTextBandEnd,
                              bottomFrac: 1.0,
                              logoW: logoW,
                              logoH: logoH,
                              bandWidthOverride: logoW,
                              bandHeightOverride: curveBandH,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Kaynak logonun [topFrac]–[bottomFrac] arasındaki dikey dilimini, görseli
  /// hiç yeniden boyutlandırmadan/kırpmadan (yalnızca pencereleyerek) gösterir.
  Widget _bandSlice({
    required double topFrac,
    required double bottomFrac,
    required double logoW,
    required double logoH,
    double? bandWidthOverride,
    double? bandHeightOverride,
  }) {
    final bandH = bandHeightOverride ?? (bottomFrac - topFrac) * logoH;
    final bandW = bandWidthOverride ?? logoW;
    return ClipRect(
      child: SizedBox(
        width: bandW,
        height: bandH,
        child: OverflowBox(
          maxWidth: logoW,
          maxHeight: logoH,
          alignment: Alignment.topLeft,
          child: Transform.translate(
            offset: Offset(0, -topFrac * logoH),
            child: Image.asset(
              _kSplashLogoAsset,
              width: logoW,
              height: logoH,
              fit: BoxFit.fill,
              filterQuality: FilterQuality.high,
              gaplessPlayback: true,
            ),
          ),
        ),
      ),
    );
  }
}
