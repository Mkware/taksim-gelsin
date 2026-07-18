import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/glass_card.dart';
import '../../core/widgets/status_pill.dart';
import '../../core/widgets/top_overlay_toast.dart';
import '../../models/favorite_driver_model.dart';
import '../../providers/providers.dart';

/// Favori sürücü yönetimi — sürücü numarasıyla ekleme, listeleme, çıkarma (maks. 3).
class FavoriteDriversScreen extends ConsumerStatefulWidget {
  const FavoriteDriversScreen({super.key});

  @override
  ConsumerState<FavoriteDriversScreen> createState() => _FavoriteDriversScreenState();
}

class _FavoriteDriversScreenState extends ConsumerState<FavoriteDriversScreen> {
  static const _maxFavorites = 3;

  List<FavoriteDriverModel> _favorites = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _isLoading = true);
    try {
      final res = await ref.read(apiServiceProvider).getFavoriteDrivers();
      final body = res.data;
      final list = (body is Map && body['success'] == true) ? body['data'] : null;
      setState(() {
        _favorites = list is List
            ? list
                .whereType<Map>()
                .map((e) => FavoriteDriverModel.fromJson(Map<String, dynamic>.from(e)))
                .toList()
            : [];
      });
    } catch (_) {
      if (mounted) {
        showTopOverlayToast(context, 'Favori sürücüler alınamadı.', AppTheme.errorColor);
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _addByCode() async {
    final controller = TextEditingController();
    final code = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      backgroundColor: AppTheme.surfaceColor,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppTheme.radiusLg)),
      ),
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(
          left: 20,
          right: 20,
          bottom: 20 + MediaQuery.of(ctx).viewInsets.bottom,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Container(
                  width: 44,
                  height: 44,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: AppTheme.primaryColor.withOpacity(0.14),
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: const Icon(LucideIcons.userPlus,
                      color: AppTheme.primaryColor, size: 22),
                ),
                const SizedBox(width: 14),
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Sürücü Ekle',
                        style: TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w800,
                          color: AppTheme.textPrimary,
                        ),
                      ),
                      SizedBox(height: 2),
                      Text(
                        'Sürücünün 6 haneli numarasını gir',
                        style: TextStyle(
                          fontSize: 12.5,
                          color: AppTheme.textSecondary,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 20),
            TextField(
              controller: controller,
              keyboardType: TextInputType.number,
              maxLength: 6,
              autofocus: true,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 22,
                fontWeight: FontWeight.w800,
                letterSpacing: 8,
                color: AppTheme.textPrimary,
              ),
              decoration: InputDecoration(
                counterText: '',
                hintText: '000000',
                hintStyle: TextStyle(
                  color: AppTheme.textMuted,
                  letterSpacing: 8,
                ),
                filled: true,
                fillColor: AppTheme.subtle,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(AppTheme.radiusSm),
                  borderSide: BorderSide.none,
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(AppTheme.radiusSm),
                  borderSide: const BorderSide(color: AppTheme.primaryColor, width: 2),
                ),
              ),
            ),
            const SizedBox(height: 16),
            FilledButton(
              style: FilledButton.styleFrom(
                backgroundColor: AppTheme.primaryColor,
                foregroundColor: AppTheme.ink,
                minimumSize: const Size.fromHeight(50),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(AppTheme.radiusSm),
                ),
              ),
              onPressed: () => Navigator.pop(ctx, controller.text.trim()),
              child: const Text(
                'Ekle',
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800),
              ),
            ),
          ],
        ),
      ),
    );

    if (code == null || code.isEmpty || !mounted) return;

    try {
      final res = await ref.read(apiServiceProvider).addFavoriteDriver(code);
      final body = res.data;
      if (body is Map && body['success'] == true) {
        if (mounted) {
          showTopOverlayToast(context, 'Favori sürücü eklendi.', AppTheme.success);
        }
        await _load();
      } else {
        final msg = (body is Map ? body['error'] as String? : null) ?? 'Sürücü eklenemedi.';
        if (mounted) showTopOverlayToast(context, msg, AppTheme.errorColor);
      }
    } catch (e) {
      final msg = _errorMessageFrom(e) ?? 'Sürücü eklenemedi.';
      if (mounted) showTopOverlayToast(context, msg, AppTheme.errorColor);
    }
  }

  String? _errorMessageFrom(Object e) {
    try {
      final data = (e as dynamic).response?.data;
      if (data is Map && data['error'] is String) return data['error'] as String;
    } catch (_) {}
    return null;
  }

  Future<void> _remove(FavoriteDriverModel driver) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Favoriden çıkar'),
        content: Text('${driver.fullName} favori sürücülerinden çıkarılsın mı?'),
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
            child: const Text('Çıkar'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    try {
      await ref.read(apiServiceProvider).removeFavoriteDriver(driver.driverId);
      await _load();
    } catch (_) {
      if (mounted) {
        showTopOverlayToast(context, 'Favori sürücü çıkarılamadı.', AppTheme.errorColor);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.backgroundColor,
      appBar: AppBar(
        title: const Text('Favori Sürücülerim'),
        backgroundColor: AppTheme.backgroundColor,
        elevation: 0,
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
              children: [
                Text(
                  'Bildiğin/güvendiğin bir sürücüyü, sürücü numarasıyla favorilerine ekle. '
                  'En fazla $_maxFavorites sürücü ekleyebilirsin.',
                  style: const TextStyle(
                    fontSize: 13,
                    color: AppTheme.textSecondary,
                    height: 1.4,
                  ),
                ),
                const SizedBox(height: 16),
                ..._favorites.map((d) => Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: _FavoriteDriverCard(driver: d, onRemove: () => _remove(d)),
                    )),
                if (_favorites.length < _maxFavorites)
                  GlassCard(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                    onTap: _addByCode,
                    child: Row(
                      children: [
                        Container(
                          width: 44,
                          height: 44,
                          alignment: Alignment.center,
                          decoration: BoxDecoration(
                            color: AppTheme.primaryColor.withOpacity(0.14),
                            borderRadius: BorderRadius.circular(14),
                          ),
                          child: const Icon(LucideIcons.userPlus,
                              color: AppTheme.primaryColor, size: 22),
                        ),
                        const SizedBox(width: 14),
                        const Expanded(
                          child: Text(
                            'Sürücü Ekle',
                            style: TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.w700,
                              color: AppTheme.textPrimary,
                            ),
                          ),
                        ),
                        const Icon(LucideIcons.chevronRight,
                            size: 16, color: AppTheme.textMuted),
                      ],
                    ),
                  ),
              ],
            ),
    );
  }
}

class _FavoriteDriverCard extends StatelessWidget {
  const _FavoriteDriverCard({required this.driver, required this.onRemove});

  final FavoriteDriverModel driver;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    return GlassCard(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  driver.fullName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: AppTheme.textPrimary,
                  ),
                ),
                const SizedBox(height: 6),
                Row(
                  children: [
                    StatusPill(
                      label: driver.isOnline ? 'Çevrimiçi' : 'Çevrimdışı',
                      color: driver.isOnline ? AppTheme.success : AppTheme.errorColor,
                      pulse: driver.isOnline,
                    ),
                    const SizedBox(width: 8),
                    Flexible(
                      child: Text(
                        '${driver.vehiclePlate} · ${driver.vehicleModel}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 12,
                          color: AppTheme.textSecondary,
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          IconButton(
            onPressed: onRemove,
            icon: const Icon(LucideIcons.trash2, size: 18, color: AppTheme.errorColor),
            tooltip: 'Çıkar',
          ),
        ],
      ),
    );
  }
}
