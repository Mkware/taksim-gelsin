import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../core/theme/app_theme.dart';
import '../../core/widgets/brand_logo.dart';
import '../../core/widgets/primary_gradient_button.dart';
import '../../providers/providers.dart';

/// İlk kurulumda gösterilen tanıtım slaytları; tamamlanınca giriş ekranına yönlendirir.
class OnboardingScreen extends ConsumerStatefulWidget {
  const OnboardingScreen({super.key});

  @override
  ConsumerState<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends ConsumerState<OnboardingScreen> {
  final PageController _pageController = PageController();
  int _index = 0;

  static const List<_OnboardingPageData> _pages = [
    _OnboardingPageData(
      icon: Icons.waving_hand_rounded,
      title: 'Hoş geldiniz',
      body:
          'Taksim Gelsin ile Kırıkkale’de taksi çağırın; birkaç dokunuşla '
          'yolculuğunuzu başlatın.',
    ),
    _OnboardingPageData(
      icon: Icons.place_rounded,
      title: 'Nereden, nereye',
      body:
          'Alış ve varış noktanızı seçin; tahmini ücreti görün ve talebinizi '
          'güvenle oluşturun.',
    ),
    _OnboardingPageData(
      icon: Icons.map_rounded,
      title: 'Canlı takip',
      body:
          'Sürücünüz yola çıktığında haritadan izleyin; biniş kodunuz ile '
          'güvenli eşleşme sağlanır.',
    ),
    _OnboardingPageData(
      icon: Icons.verified_user_rounded,
      title: 'Hazırsınız',
      body:
          'Giriş yapın veya hesap oluşturun. Bildirim ve konum izinleri '
          'daha iyi bir deneyim için önerilir.',
    ),
  ];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      final storage = ref.read(storageServiceProvider);
      await storage.init();
      if (!mounted) return;
      if (storage.isOnboardingCompleted()) {
        context.go('/auth/login');
      }
    });
  }

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  Future<void> _finish() async {
    await ref.read(storageServiceProvider).setOnboardingCompleted();
    if (!mounted) return;
    context.go('/auth/login');
  }

  void _next() {
    if (_index < _pages.length - 1) {
      _pageController.nextPage(
        duration: const Duration(milliseconds: 320),
        curve: Curves.easeOutCubic,
      );
    } else {
      _finish();
    }
  }

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.paddingOf(context).bottom;

    return Scaffold(
      backgroundColor: AppTheme.brandMidnight,
      body: Stack(
        children: [
          Positioned.fill(
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    AppTheme.brandMidnight,
                    AppTheme.inkSoft.withValues(alpha: 0.95),
                    AppTheme.ink.withValues(alpha: 0.88),
                  ],
                ),
              ),
            ),
          ),
          SafeArea(
            child: Column(
              children: [
                Align(
                  alignment: Alignment.centerRight,
                  child: TextButton(
                    onPressed: _finish,
                    child: Text(
                      'Atla',
                      style: GoogleFonts.inter(
                        fontWeight: FontWeight.w600,
                        color: Colors.white.withValues(alpha: 0.65),
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 8),
                const Hero(
                  tag: AppTheme.brandHeroTag,
                  child: Material(
                    type: MaterialType.transparency,
                    child: BrandLogo(
                      width: 88,
                      height: 88,
                      borderRadius: 20,
                    ),
                  ),
                ),
                const SizedBox(height: 20),
                Expanded(
                  child: PageView.builder(
                    controller: _pageController,
                    itemCount: _pages.length,
                    onPageChanged: (i) => setState(() => _index = i),
                    itemBuilder: (context, i) {
                      final p = _pages[i];
                      return Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 28),
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Container(
                              width: 88,
                              height: 88,
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                color: AppTheme.primaryColor.withValues(alpha: 0.12),
                                border: Border.all(
                                  color: AppTheme.primaryColor.withValues(alpha: 0.35),
                                ),
                              ),
                              child: Icon(
                                p.icon,
                                size: 44,
                                color: AppTheme.primaryColor,
                              ),
                            ),
                            const SizedBox(height: 28),
                            Text(
                              p.title,
                              textAlign: TextAlign.center,
                              style: GoogleFonts.inter(
                                fontSize: 24,
                                fontWeight: FontWeight.w800,
                                color: Colors.white,
                                height: 1.15,
                              ),
                            ),
                            const SizedBox(height: 16),
                            Text(
                              p.body,
                              textAlign: TextAlign.center,
                              style: GoogleFonts.inter(
                                fontSize: 15,
                                height: 1.5,
                                fontWeight: FontWeight.w400,
                                color: Colors.white.withValues(alpha: 0.72),
                              ),
                            ),
                          ],
                        ),
                      );
                    },
                  ),
                ),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: List.generate(_pages.length, (i) {
                    final active = i == _index;
                    return AnimatedContainer(
                      duration: const Duration(milliseconds: 220),
                      curve: Curves.easeOutCubic,
                      margin: const EdgeInsets.symmetric(horizontal: 4),
                      width: active ? 22 : 7,
                      height: 7,
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(4),
                        color: active
                            ? AppTheme.primaryColor
                            : Colors.white.withValues(alpha: 0.22),
                      ),
                    );
                  }),
                ),
                const SizedBox(height: 22),
                Padding(
                  padding: EdgeInsets.fromLTRB(24, 0, 24, 16 + bottomInset),
                  child: PrimaryGradientButton(
                    label: _index < _pages.length - 1 ? 'Devam' : 'Başla',
                    icon: _index < _pages.length - 1
                        ? Icons.arrow_forward_rounded
                        : Icons.login_rounded,
                    height: 54,
                    variant: PrimaryGradientButtonVariant.brandSolid,
                    onPressed: _next,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _OnboardingPageData {
  const _OnboardingPageData({
    required this.icon,
    required this.title,
    required this.body,
  });
  final IconData icon;
  final String title;
  final String body;
}
