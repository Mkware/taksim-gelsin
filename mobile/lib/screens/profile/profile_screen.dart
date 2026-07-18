import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:share_plus/share_plus.dart';
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
          const _Header(),
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
                    icon: LucideIcons.user,
                    title: 'Profili Düzenle',
                    subtitle: 'Kişisel bilgilerinizi güncelleyin',
                    color: AppTheme.primaryColor,
                    onTap: () => context.push('/profile/edit'),
                  ),
                ),
                const SizedBox(height: 10),

                if (isDriver) ...[
                  AnimatedEntry(
                    order: 3,
                    child: _MenuTile(
                      icon: LucideIcons.wallet,
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
                      icon: LucideIcons.history,
                      title: 'Yolculuk Geçmişi',
                      subtitle: 'Tamamlanan ve iptal olan yolculuklar',
                      color: AppTheme.info,
                      onTap: () => context.push('/customer/history'),
                    ),
                  ),
                  if ((user?.driverCode ?? '').isNotEmpty) ...[
                    const SizedBox(height: 10),
                    AnimatedEntry(
                      order: 5,
                      child: _MenuTile(
                        icon: LucideIcons.share2,
                        title: 'Sürücü Numaram: ${user!.driverCode}',
                        subtitle: 'Müşterilerle paylaşmak için dokun',
                        color: AppTheme.success,
                        onTap: () {
                          SharePlus.instance.share(ShareParams(
                            text: 'Taksim Gelsin\'de beni favori sürücün olarak ekle 🚕\n'
                                'Sürücü numaram: ${user.driverCode}',
                          ));
                        },
                      ),
                    ),
                  ],
                ] else ...[
                  AnimatedEntry(
                    order: 2,
                    child: _MenuTile(
                      icon: LucideIcons.history,
                      title: 'Yolculuk Geçmişi',
                      subtitle: 'Geçmiş yolculukların ve fişler',
                      color: AppTheme.info,
                      onTap: () => context.push('/customer/history'),
                    ),
                  ),
                  const SizedBox(height: 10),
                  AnimatedEntry(
                    order: 3,
                    child: _MenuTile(
                      icon: LucideIcons.heart,
                      title: 'Favori Sürücülerim',
                      subtitle: 'Bildiğin sürücüleri favorile, tek dokunuşla çağır',
                      color: AppTheme.errorColor,
                      onTap: () => context.push('/customer/favorite-drivers'),
                    ),
                  ),
                ],
                const SizedBox(height: 10),

                AnimatedEntry(
                  order: 4,
                  child: _MenuTile(
                    icon: LucideIcons.bell,
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
                    icon: LucideIcons.gavel,
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
                    icon: const Icon(LucideIcons.logOut),
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
  const _Header();

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        gradient: AppTheme.inkGradient,
      ),
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 4, 20, 4),
          child: Row(
            children: [
              IconButton(
                icon: const Icon(LucideIcons.chevronLeft,
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
            icon: LucideIcons.star,
            value: ratingLabel,
            label: 'Ort. puan',
            color: AppTheme.primaryColor,
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: _StatTile(
            icon: LucideIcons.badgeCheck,
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
            LucideIcons.chevronRight,
            size: 16,
            color: AppTheme.textMuted,
          ),
        ],
      ),
    );
  }
}
