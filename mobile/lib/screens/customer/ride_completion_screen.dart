import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/top_overlay_toast.dart';
import '../../models/driver_info_model.dart';
import '../../models/ride_model.dart';
import '../../providers/providers.dart';

/// Yolculuk bittiğinde: özet, ödeme tipi, sürücü oyu
class RideCompletionScreen extends ConsumerStatefulWidget {
  const RideCompletionScreen({
    super.key,
    required this.ride,
    this.driver,
    this.tripDuration,
  });

  final RideModel ride;
  final DriverInfoModel? driver;
  final Duration? tripDuration;

  @override
  ConsumerState<RideCompletionScreen> createState() => _RideCompletionScreenState();
}

class _RideCompletionScreenState extends ConsumerState<RideCompletionScreen> {
  bool _cash = true;
  int _rating = 5;
  bool _submitting = false;

  String get _distanceStr {
    final km = widget.ride.distanceKm;
    if (km == null) return '—';
    return '${km.toStringAsFixed(1)} km';
  }

  String get _durationStr {
    final d = widget.tripDuration;
    if (d == null) return '—';
    final m = d.inMinutes;
    if (m < 1) return '<1 dk';
    if (m >= 60) return '${m ~/ 60} s ${m % 60} dk';
    return '$m dk';
  }

  Future<void> _submit() async {
    final driver = widget.driver;
    if (driver == null) {
      if (mounted) Navigator.of(context).pop();
      return;
    }

    setState(() => _submitting = true);
    try {
      final api = ref.read(apiServiceProvider);
      await api.submitReview(
        rideId: widget.ride.id,
        reviewedId: driver.id,
        rating: _rating,
        comment: '${_cash ? 'Nakit' : 'Kart'} ile ödendi',
      );
    } catch (_) {
      if (mounted) {
        showTopOverlayToast(
          context,
          'Değerlendirme gönderilemedi; yine de teşekkürler.',
          AppTheme.ink,
        );
      }
    }
    if (mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final driver = widget.driver;

    return Scaffold(
      backgroundColor: AppTheme.backgroundColor,
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Align(
                alignment: Alignment.centerRight,
                child: IconButton(
                  onPressed: () => Navigator.of(context).pop(),
                  icon: const Icon(Icons.close_rounded),
                ),
              ),
              const Icon(Icons.check_circle_rounded, color: AppTheme.accentColor, size: 56),
              const SizedBox(height: 8),
              Text(
                'Yolculuk tamamlandı',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                      fontWeight: FontWeight.bold,
                      color: AppTheme.secondaryColor,
                    ),
              ),
              const SizedBox(height: 20),
              _SummaryCard(
                distance: _distanceStr,
                duration: _durationStr,
                amountLabel: widget.ride.customerFareLabel,
              ),
              const SizedBox(height: 20),
              Text(
                'Ödeme yöntemi',
                style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: _PaymentChip(
                      label: 'Nakit',
                      icon: Icons.payments_outlined,
                      selected: _cash,
                      onTap: () => setState(() => _cash = true),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: _PaymentChip(
                      label: 'Kart',
                      icon: Icons.credit_card_rounded,
                      selected: !_cash,
                      onTap: () => setState(() => _cash = false),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 24),
              Text(
                'Sürücünüzü değerlendirin',
                style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
              ),
              if (driver != null) ...[
                const SizedBox(height: 8),
                Text(
                  driver.fullName,
                  style: const TextStyle(color: AppTheme.textSecondary, fontSize: 14),
                ),
              ],
              const SizedBox(height: 12),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: List.generate(5, (i) {
                  final star = i < _rating;
                  return IconButton(
                    onPressed: () => setState(() => _rating = i + 1),
                    icon: Icon(
                      star ? Icons.star_rounded : Icons.star_outline_rounded,
                      color: star ? AppTheme.primaryColor : AppTheme.dividerColor,
                      size: 40,
                    ),
                  );
                }),
              ),
              const SizedBox(height: 28),
              SizedBox(
                height: 52,
                child: FilledButton(
                  onPressed: _submitting ? null : _submit,
                  style: FilledButton.styleFrom(
                    backgroundColor: AppTheme.secondaryColor,
                    foregroundColor: AppTheme.primaryColor,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppTheme.radiusMd)),
                  ),
                  child: _submitting
                      ? const SizedBox(
                          width: 22,
                          height: 22,
                          child: CircularProgressIndicator(strokeWidth: 2, color: AppTheme.primaryColor),
                        )
                      : const Text('Tamam', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SummaryCard extends StatelessWidget {
  const _SummaryCard({
    required this.distance,
    required this.duration,
    required this.amountLabel,
  });

  final String distance;
  final String duration;
  final String amountLabel;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(AppTheme.radiusMd),
        boxShadow: [
          BoxShadow(
            color: AppTheme.secondaryColor.withValues(alpha: 0.06),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Row(
        children: [
          Expanded(
            child: _MiniStat(icon: Icons.route_rounded, label: 'Mesafe', value: distance),
          ),
          Container(width: 1, height: 44, color: AppTheme.dividerColor),
          Expanded(
            child: _MiniStat(icon: Icons.schedule_rounded, label: 'Süre', value: duration),
          ),
          Container(width: 1, height: 44, color: AppTheme.dividerColor),
          Expanded(
            child: _MiniStat(
              icon: Icons.payments_rounded,
              label: 'Tutar',
              value: amountLabel,
              emphasize: true,
            ),
          ),
        ],
      ),
    );
  }
}

class _MiniStat extends StatelessWidget {
  const _MiniStat({
    required this.icon,
    required this.label,
    required this.value,
    this.emphasize = false,
  });

  final IconData icon;
  final String label;
  final String value;
  final bool emphasize;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Icon(icon, size: 20, color: emphasize ? AppTheme.primaryColor : AppTheme.textSecondary),
        const SizedBox(height: 4),
        Text(label, style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
        const SizedBox(height: 2),
        Text(
          value,
          textAlign: TextAlign.center,
          style: TextStyle(
            fontSize: emphasize ? 16 : 13,
            fontWeight: FontWeight.w700,
            color: emphasize ? AppTheme.secondaryColor : AppTheme.textPrimary,
          ),
        ),
      ],
    );
  }
}

class _PaymentChip extends StatelessWidget {
  const _PaymentChip({
    required this.label,
    required this.icon,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final IconData icon;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? AppTheme.primaryColor.withValues(alpha: 0.2) : AppTheme.surfaceColor,
      borderRadius: BorderRadius.circular(AppTheme.radiusMd),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppTheme.radiusMd),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 14),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(AppTheme.radiusMd),
            border: Border.all(
              color: selected ? AppTheme.primaryColor : AppTheme.dividerColor,
              width: selected ? 2 : 1,
            ),
          ),
          child: Column(
            children: [
              Icon(icon, color: selected ? AppTheme.secondaryColor : AppTheme.textSecondary),
              const SizedBox(height: 6),
              Text(
                label,
                style: TextStyle(
                  fontWeight: FontWeight.w600,
                  color: selected ? AppTheme.secondaryColor : AppTheme.textSecondary,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
