import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/animated_entry.dart';
import '../../core/widgets/glass_card.dart';
import '../../providers/providers.dart';

/// Profil ekranı — hem müşteri hem sürücü için tek ekran.
/// Gece mavisi hero header + stat kartları + menü.
class ProfileScreen extends ConsumerStatefulWidget {
  const ProfileScreen({super.key});

  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ConsumerState<ProfileScreen> {
  @override
  void initState() {
    super.initState();
    Future.microtask(() {
      ref.read(currentUserProvider.notifier).refreshProfileFromApi();
    });
  }

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(currentUserProvider);
    final isDriver = user?.isDriver ?? false;

    return Scaffold(
      backgroundColor: AppTheme.backgroundColor,
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _Header(
            name: user?.fullName ?? '—',
            phone: user?.phone ?? '',
            rating: user?.rating ?? 0,
            ratingCount: user?.ratingCount ?? 0,
            isDriver: isDriver,
          ),
          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(20, 20, 20, 32),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                AnimatedEntry(
                  order: 0,
                  child: _StatsRow(
                    isDriver: isDriver,
                    ratingCount: user?.ratingCount ?? 0,
                    rating: user?.rating ?? 0,
                    createdAt: user?.createdAt,
                  ),
                ),
                const SizedBox(height: 20),

                AnimatedEntry(
                  order: 1,
                  child: _SectionLabel(label: isDriver ? 'Sürücü' : 'Hesabım'),
                ),
                const SizedBox(height: 10),
                AnimatedEntry(
                  order: 1,
                  child: _MenuTile(
                    icon: Icons.person_outline_rounded,
                    title: 'Profili Düzenle',
                    subtitle: 'Kişisel bilgilerinizi güncelleyin',
                    color: AppTheme.primaryColor,
                    onTap: () => context.push('/profile/edit'),
                  ),
                ),
                const SizedBox(height: 10),

                if (isDriver) ...[
                  AnimatedEntry(
                    order: 2,
                    child: _MenuTile(
                      icon: Icons.payments_rounded,
                      title: 'Kazançlarım',
                      subtitle: 'Günlük, haftalık ve toplam kazanç',
                      color: AppTheme.success,
                      onTap: () => context.push('/driver/earnings'),
                    ),
                  ),
                  const SizedBox(height: 10),
                  AnimatedEntry(
                    order: 3,
                    child: _MenuTile(
                      icon: Icons.account_balance_wallet_rounded,
                      title: 'T Coin cüzdanım',
                      subtitle: 'Bakiye görüntüle ve yükleme talebi',
                      color: AppTheme.primaryDark,
                      onTap: () => context.push('/driver/wallet'),
                    ),
                  ),
                  const SizedBox(height: 10),
                  AnimatedEntry(
                    order: 4,
                    child: _MenuTile(
                      icon: Icons.history_rounded,
                      title: 'Yolculuk Geçmişi',
                      subtitle: 'Tamamlanan ve iptal olan yolculuklar',
                      color: AppTheme.info,
                      onTap: () => context.push('/customer/history'),
                    ),
                  ),
                ] else ...[
                  AnimatedEntry(
                    order: 2,
                    child: _MenuTile(
                      icon: Icons.history_rounded,
                      title: 'Yolculuk Geçmişi',
                      subtitle: 'Geçmiş yolculukların ve fişler',
                      color: AppTheme.info,
                      onTap: () => context.push('/customer/history'),
                    ),
                  ),
                ],
                const SizedBox(height: 10),

                AnimatedEntry(
                  order: 4,
                  child: _MenuTile(
                    icon: Icons.notifications_none_rounded,
                    title: 'Bildirimler',
                    subtitle: 'İzinler ve sesli uyarılar',
                    color: AppTheme.warning,
                    onTap: () => context.push('/profile/notifications'),
                  ),
                ),
                const SizedBox(height: 18),

                AnimatedEntry(
                  order: 5,
                  child: _SectionLabel(label: 'Uygulama'),
                ),
                const SizedBox(height: 10),
                AnimatedEntry(
                  order: 7,
                  child: _MenuTile(
                    icon: Icons.gavel_rounded,
                    title: 'Yasal ve gizlilik',
                    subtitle: 'KVKK, gizlilik politikası, kullanım koşulları',
                    color: AppTheme.ink,
                    onTap: () => context.push('/legal'),
                  ),
                ),
                const SizedBox(height: 22),

                AnimatedEntry(
                  order: 8,
                  child: OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppTheme.errorColor,
                      side: BorderSide(
                        color: AppTheme.errorColor.withOpacity(0.4),
                        width: 1.4,
                      ),
                      minimumSize: const Size.fromHeight(54),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                      ),
                    ),
                    icon: const Icon(Icons.logout_rounded),
                    label: const Text(
                      'Çıkış Yap',
                      style: TextStyle(fontWeight: FontWeight.w700),
                    ),
                    onPressed: () => _confirmLogout(context),
                  ),
                ),
                const SizedBox(height: 24),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _confirmLogout(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Çıkış yapmak istiyor musun?'),
        content: const Text('Tekrar giriş yapmak için telefon ve şifreni kullanabilirsin.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Vazgeç'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: AppTheme.errorColor,
              foregroundColor: Colors.white,
            ),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Çıkış Yap'),
          ),
        ],
      ),
    );
    if (confirmed == true && context.mounted) {
      await ref.read(currentUserProvider.notifier).logout();
      if (context.mounted) context.go('/auth/login');
    }
  }
}

// ============================================================
// HEADER
// ============================================================

class _Header extends StatelessWidget {
  const _Header({
    required this.name,
    required this.phone,
    required this.rating,
    required this.ratingCount,
    required this.isDriver,
  });

  final String name;
  final String phone;
  final double rating;
  final int ratingCount;
  final bool isDriver;

  @override
  Widget build(BuildContext context) {
    final displayRating = ratingCount > 0 ? rating : 0.0;
    final initial = name.trim().isNotEmpty ? name.trim()[0].toUpperCase() : '?';

    return Container(
      decoration: const BoxDecoration(
        gradient: AppTheme.inkGradient,
      ),
      child: SafeArea(
        bottom: false,
        child: Stack(
          children: [
            // Dekoratif orb'lar
            Positioned(
              top: -40,
              right: -30,
              child: _orb(160, AppTheme.primaryColor.withOpacity(0.18)),
            ),
            Positioned(
              bottom: -20,
              left: -40,
              child: _orb(120, AppTheme.info.withOpacity(0.12)),
            ),

            Padding(
              padding: const EdgeInsets.fromLTRB(20, 4, 20, 16),
              child: Column(
                children: [
                  // Üst çubuk
                  Row(
                    children: [
                      IconButton(
                        icon: const Icon(Icons.arrow_back_ios_new_rounded,
                            color: Colors.white),
                        onPressed: () => Navigator.of(context).maybePop(),
                      ),
                      const Spacer(),
                      const Text(
                        'Profil',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                          letterSpacing: 0.2,
                        ),
                      ),
                      const Spacer(),
                      const SizedBox(width: 48),
                    ],
                  ),
                  const SizedBox(height: 4),

                  // Avatar — Hero uyumlu (geçişte taşma çizgisi: clipBehavior + FittedBox)
                  Hero(
                    tag: AppTheme.brandHeroTag,
                    child: Container(
                      width: 68,
                      height: 68,
                      clipBehavior: Clip.antiAlias,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        gradient: AppTheme.primaryGradient,
                        boxShadow: AppTheme.primaryGlow(opacity: 0.45),
                      ),
                      alignment: Alignment.center,
                      child: FittedBox(
                        fit: BoxFit.scaleDown,
                        child: Padding(
                          padding: const EdgeInsets.all(4),
                          child: Text(
                            initial,
                            style: const TextStyle(
                              color: AppTheme.ink,
                              fontSize: 26,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 10),

                  // İsim
                  Text(
                    name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 19,
                      fontWeight: FontWeight.w800,
                      letterSpacing: -0.3,
                    ),
                  ),
                  const SizedBox(height: 3),

                  // Telefon + rol rozeti
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        phone,
                        style: TextStyle(
                          color: Colors.white.withOpacity(0.7),
                          fontSize: 13,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                        decoration: BoxDecoration(
                          color: (isDriver ? AppTheme.success : AppTheme.primaryColor)
                              .withOpacity(0.18),
                          borderRadius: BorderRadius.circular(999),
                          border: Border.all(
                            color: (isDriver ? AppTheme.success : AppTheme.primaryColor)
                                .withOpacity(0.6),
                          ),
                        ),
                        child: Text(
                          isDriver ? 'SÜRÜCÜ' : 'MÜŞTERİ',
                          style: TextStyle(
                            color: isDriver ? AppTheme.success : AppTheme.primaryColor,
                            fontSize: 10,
                            fontWeight: FontWeight.w800,
                            letterSpacing: 0.8,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '${displayRating.toStringAsFixed(1)} · $ratingCount değerlendirme',
                    style: TextStyle(
                      color: Colors.white.withValues(alpha: 0.72),
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _orb(double size, Color color) {
    return IgnorePointer(
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          gradient: RadialGradient(colors: [color, color.withValues(alpha: 0)]),
        ),
      ),
    );
  }
}

// ============================================================
// STATS
// ============================================================

class _StatsRow extends StatelessWidget {
  const _StatsRow({
    required this.isDriver,
    required this.ratingCount,
    required this.rating,
    required this.createdAt,
  });

  final bool isDriver;
  final int ratingCount;
  final double rating;
  final String? createdAt;

  @override
  Widget build(BuildContext context) {
    final memberYear = _memberYear(createdAt);
    final ratingLabel = (ratingCount > 0 ? rating : 0.0).toStringAsFixed(1);

    return Row(
      children: [
        Expanded(
          child: _StatTile(
            icon: Icons.star_rounded,
            value: ratingLabel,
            label: 'Ort. puan',
            color: AppTheme.primaryColor,
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: _StatTile(
            icon: Icons.verified_rounded,
            value: memberYear,
            label: 'Üyelik',
            color: AppTheme.success,
          ),
        ),
      ],
    );
  }

  String _memberYear(String? createdAt) {
    if (createdAt == null) return '—';
    try {
      final d = DateTime.parse(createdAt);
      return '${d.year}';
    } catch (_) {
      return '—';
    }
  }
}

class _StatTile extends StatelessWidget {
  const _StatTile({
    required this.icon,
    required this.value,
    required this.label,
    required this.color,
  });

  final IconData icon;
  final String value;
  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return GlassCard(
      padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 10),
      child: Column(
        children: [
          Container(
            width: 40,
            height: 40,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: color.withOpacity(0.12),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(icon, color: color, size: 22),
          ),
          const SizedBox(height: 8),
          Text(
            value,
            style: const TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w800,
              color: AppTheme.textPrimary,
              letterSpacing: -0.3,
            ),
          ),
          Text(
            label,
            style: const TextStyle(
              fontSize: 11,
              color: AppTheme.textSecondary,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }
}

// ============================================================
// MENU
// ============================================================

class _SectionLabel extends StatelessWidget {
  const _SectionLabel({required this.label});
  final String label;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(left: 4),
      child: Text(
        label.toUpperCase(),
        style: const TextStyle(
          fontSize: 11,
          color: AppTheme.textMuted,
          fontWeight: FontWeight.w700,
          letterSpacing: 1.2,
        ),
      ),
    );
  }
}

class _MenuTile extends StatelessWidget {
  const _MenuTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.color,
    this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final Color color;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return GlassCard(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      onTap: onTap,
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: color.withOpacity(0.14),
              borderRadius: BorderRadius.circular(14),
            ),
            child: Icon(icon, color: color, size: 22),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: AppTheme.textPrimary,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  subtitle,
                  style: const TextStyle(
                    fontSize: 12,
                    color: AppTheme.textSecondary,
                  ),
                ),
              ],
            ),
          ),
          const Icon(
            Icons.arrow_forward_ios_rounded,
            size: 16,
            color: AppTheme.textMuted,
          ),
        ],
      ),
    );
  }
}
