import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../core/constants/app_constants.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/top_overlay_toast.dart';
import '../../models/ride_model.dart';
import '../../models/driver_info_model.dart';
import '../../providers/providers.dart';
import 'ride_searching_progress_card.dart';

/// Aktif yolculuk — sürüklenebilir panel; özet üstte, güzergah genişletilebilir.
class RideTrackingSheet extends ConsumerStatefulWidget {
  final RideModel ride;
  final ScrollController? sheetScrollController;

  const RideTrackingSheet({
    super.key,
    required this.ride,
    this.sheetScrollController,
  });

  @override
  ConsumerState<RideTrackingSheet> createState() => _RideTrackingSheetState();
}

class _RideTrackingSheetState extends ConsumerState<RideTrackingSheet>
    with SingleTickerProviderStateMixin {
  late final AnimationController _arrivedPulseCtrl;

  @override
  void initState() {
    super.initState();
    _arrivedPulseCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 950),
    )..repeat(reverse: true);
  }

  @override
  void dispose() {
    _arrivedPulseCtrl.dispose();
    super.dispose();
  }

  Future<void> _callDriver(String phone) async {
    final normalized = phone.replaceAll(' ', '');
    final uri = Uri.parse('tel:$normalized');
    final ok = await launchUrl(uri);
    if (!ok && mounted) {
      showTopOverlayToast(context, 'Arama başlatılamadı.', AppTheme.errorColor);
    }
  }

  /// `AppConstants.driverWalletSupportPhone` (örn. 05xx…) → wa.me uluslararası numara.
  Future<void> _openWhatsAppSupport() async {
    final digits = AppConstants.driverWalletSupportPhone.replaceAll(RegExp(r'\D'), '');
    if (digits.isEmpty) return;
    final String intl =
        digits.startsWith('90') ? digits : (digits.startsWith('0') ? '90${digits.substring(1)}' : '90$digits');
    final uri = Uri.parse('https://wa.me/$intl');
    final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!ok && mounted) {
      showTopOverlayToast(context, 'WhatsApp açılamadı.', AppTheme.errorColor);
    }
  }

  bool _showPickupCode(RideModel ride) {
    final code = ride.pickupVerificationCode;
    if (code == null || code.isEmpty) return false;
    if (ride.pickupCodeVerified) return false;
    if (ride.status == RideStatus.searching) return false;
    return true;
  }

  bool _waitingForPickupCode(RideModel ride) {
    if (ride.pickupCodeVerified) return false;
    if (ride.status == RideStatus.searching) return false;
    final c = ride.pickupVerificationCode?.trim() ?? '';
    if (c.isNotEmpty) return false;
    return ride.status == RideStatus.accepted || ride.status == RideStatus.arriving;
  }

  @override
  Widget build(BuildContext context) {
    // Her zaman provider — temp_ → gerçek id veya PIN güncellemesi kaçırılmasın.
    final ride = ref.watch(activeRideProvider) ?? widget.ride;
    final driver = ref.watch(assignedDriverProvider);
    final bottomInset = MediaQuery.paddingOf(context).bottom;
    const double edge = 16;

    final showCancel = ride.status == RideStatus.searching ||
        ride.status == RideStatus.accepted ||
        ride.status == RideStatus.arriving;

    return Container(
      decoration: const BoxDecoration(
        color: Color(0xFFF2F3F5),
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppTheme.radiusLg)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SizedBox(height: 8),
          Center(
            child: Container(
              width: 42,
              height: 4,
              decoration: BoxDecoration(
                color: const Color(0xFFBFC4CC),
                borderRadius: BorderRadius.circular(999),
              ),
            ),
          ),
          const SizedBox(height: 6),
          Expanded(
            child: SingleChildScrollView(
              controller: widget.sheetScrollController,
              physics: const ClampingScrollPhysics(),
              padding: EdgeInsets.fromLTRB(edge, 10, edge, 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (ride.status == RideStatus.searching)
                    _sectionCard(
                      child: const RideSearchingProgressCard(),
                    ),
                  if (driver != null && ride.status != RideStatus.searching)
                    _driverHeaderCard(driver, ride.status),
                  if (_waitingForPickupCode(ride))
                    _sectionCard(
                      child: Row(
                        children: [
                          const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(strokeWidth: 2.2),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              'Eşleşme kodu hazırlanıyor...',
                              style: GoogleFonts.inter(
                                fontSize: 14,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  if (_showPickupCode(ride))
                    _sectionCard(child: _pickupCodePanel(ride.pickupVerificationCode!)),
                  _sectionCard(
                    child: _morePanel(
                      showCancel: showCancel,
                      onCancel: () => _showCancelDialog(context, ref, ride),
                    ),
                  ),
                  _sectionCard(child: _paymentPanel(ride)),
                  _sectionCard(child: _routePanel(ride)),
                  SizedBox(height: 8 + bottomInset * 0.25),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _sectionCard({required Widget child}) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
      ),
      child: child,
    );
  }

  Widget _driverHeaderCard(DriverInfoModel driver, RideStatus status) {
    final compactName = _shortNameWithSurnameInitial(driver.fullName);
    return _sectionCard(
      child: Column(
        children: [
          if (status == RideStatus.arriving) ...[
            FadeTransition(
              opacity: Tween<double>(begin: 0.45, end: 1).animate(
                CurvedAnimation(parent: _arrivedPulseCtrl, curve: Curves.easeInOut),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.location_on_rounded, color: const Color(0xFF0EA5E9), size: 16),
                  const SizedBox(width: 6),
                  Flexible(
                    child: Text(
                      'Sürücünüz geldi sizi bekliyor.',
                      textAlign: TextAlign.center,
                      style: GoogleFonts.inter(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        color: const Color(0xFF0EA5E9),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 7),
          ],
          Row(
            children: [
              const Icon(Icons.star_rounded, color: AppTheme.primaryColor, size: 18),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  '${driver.rating.toStringAsFixed(1)} $compactName',
                  style: GoogleFonts.inter(fontSize: 12, fontWeight: FontWeight.w600),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              Text(
                driver.vehiclePlate.isNotEmpty ? driver.vehiclePlate : 'Plaka',
                style: GoogleFonts.inter(fontSize: 12, fontWeight: FontWeight.w700),
              ),
              const SizedBox(width: 4),
              IconButton(
                onPressed: driver.phone.trim().isEmpty
                    ? null
                    : () => _callDriver(driver.phone),
                icon: const Icon(Icons.call_rounded, size: 18),
                tooltip: 'Sürücüyü Ara',
              ),
            ],
          ),
        ],
      ),
    );
  }

  String _contextHint(RideModel ride) {
    switch (ride.status) {
      case RideStatus.searching:
        return 'Yakın sürücüler aranıyor. Atanınca bildirileceksiniz.';
      case RideStatus.accepted:
        return 'Sürücü size doğru geliyor. Biniş kodunuzu hazır bulundurun.';
      case RideStatus.arriving:
        if (_showPickupCode(ride)) {
          return 'Aracınızda olduğunuzda sürücüye aşağıdaki kodu okuyun.';
        }
        return 'Sürücü biniş noktasında.';
      case RideStatus.inProgress:
        return 'İyi yolculuklar. Varış adresinize gidiliyor.';
      default:
        return '';
    }
  }

  Widget _heroStatus(RideModel ride) {
    final cfg = _statusConfig(ride.status);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(cfg.icon, color: cfg.color, size: 28),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                ride.status.displayText,
                style: GoogleFonts.inter(
                  fontSize: 20,
                  fontWeight: FontWeight.w800,
                  color: AppTheme.ink,
                  height: 1.15,
                  letterSpacing: -0.4,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                cfg.subtitle,
                style: GoogleFonts.inter(
                  fontSize: 14,
                  fontWeight: FontWeight.w500,
                  color: AppTheme.textSecondary,
                  height: 1.3,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(width: 8),
        Text(
          ride.customerFareLabel,
          style: GoogleFonts.inter(
            fontSize: 22,
            fontWeight: FontWeight.w800,
            color: AppTheme.primaryDark,
            letterSpacing: -0.5,
          ),
        ),
      ],
    );
  }

  static const _stepLabels = [
    'Aranıyor',
    'Kabul',
    'Biniş',
    'Yol',
    'Bitti',
  ];

  Widget _stepDots(RideModel ride) {
    final idx = ride.status.index.clamp(0, _stepLabels.length - 1);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: List.generate(_stepLabels.length, (i) {
            final done = i <= idx;
            return Expanded(
              child: Padding(
                padding: EdgeInsets.only(right: i < _stepLabels.length - 1 ? 6 : 0),
                child: Container(
                  height: 4,
                  decoration: BoxDecoration(
                    color: done ? AppTheme.info : AppTheme.dividerColor,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
            );
          }),
        ),
        const SizedBox(height: 6),
        Text(
          _stepLabels[idx],
          style: GoogleFonts.inter(
            fontSize: 12,
            fontWeight: FontWeight.w700,
            color: AppTheme.info,
          ),
        ),
      ],
    );
  }

  Widget _driverCard(DriverInfoModel driver) {
    final plate = driver.vehiclePlate;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppTheme.subtle,
        borderRadius: BorderRadius.circular(AppTheme.radiusSm),
        border: Border.all(color: AppTheme.border),
      ),
      child: Row(
        children: [
          CircleAvatar(
            radius: 24,
            backgroundColor: AppTheme.primaryColor,
            child: Text(
              driver.fullName.isNotEmpty
                  ? driver.fullName[0].toUpperCase()
                  : '?',
              style: GoogleFonts.inter(
                fontSize: 20,
                fontWeight: FontWeight.w800,
                color: AppTheme.secondaryColor,
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Sürücünüz',
                  style: GoogleFonts.inter(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    color: AppTheme.textMuted,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  driver.fullName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: GoogleFonts.inter(
                    fontSize: 16,
                    fontWeight: FontWeight.w800,
                    color: AppTheme.ink,
                  ),
                ),
                const SizedBox(height: 4),
                Row(
                  children: [
                    const Icon(Icons.star_rounded,
                        color: AppTheme.primaryColor, size: 18),
                    const SizedBox(width: 4),
                    Text(
                      driver.rating.toStringAsFixed(1),
                      style: GoogleFonts.inter(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: AppTheme.textSecondary,
                      ),
                    ),
                    if (plate.isNotEmpty) ...[
                      Text(
                        ' · ',
                        style: GoogleFonts.inter(color: AppTheme.textMuted),
                      ),
                      Expanded(
                        child: Text(
                          plate,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: GoogleFonts.inter(
                            fontSize: 13,
                            fontWeight: FontWeight.w700,
                            color: AppTheme.ink,
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _pickupCodePanel(String code) {
    return Container(
      padding: const EdgeInsets.all(9),
      decoration: BoxDecoration(
        color: const Color(0xFF2563EB),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              'Eşleşme Kodu',
              style: GoogleFonts.inter(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                color: Colors.white,
              ),
            ),
          ),
          ...code.split('').map((c) => Container(
                margin: const EdgeInsets.only(left: 4),
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
                decoration: BoxDecoration(
                  color: const Color(0xFF1E293B),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  c,
                  style: GoogleFonts.inter(
                    color: Colors.white,
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              )),
        ],
      ),
    );
  }

  Widget _routePanel(RideModel ride) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Konum', style: GoogleFonts.inter(fontSize: 12.5, fontWeight: FontWeight.w700)),
        const SizedBox(height: 10),
        _addressLine(
          icon: Icons.trip_origin,
          iconColor: AppTheme.accentColor,
          label: '',
          text: ride.pickupAddress,
        ),
        const SizedBox(height: 4),
        _routeDashedConnector(),
        const SizedBox(height: 4),
        _addressLine(
          icon: Icons.adjust,
          iconColor: AppTheme.ink,
          label: '',
          text: ride.dropoffAddress,
        ),
      ],
    );
  }

  Widget _paymentPanel(RideModel ride) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Ücret', style: GoogleFonts.inter(fontSize: 12.5, fontWeight: FontWeight.w700)),
        const SizedBox(height: 10),
        Row(
          children: [
            const Icon(Icons.payments_outlined, color: AppTheme.success),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                'Nakit / Banka Havalesi',
                style: GoogleFonts.inter(fontSize: 11, fontWeight: FontWeight.w600),
              ),
            ),
            Text(
              ride.customerFareLabel,
              style: GoogleFonts.inter(fontSize: 13.5, fontWeight: FontWeight.w800),
            ),
          ],
        ),
      ],
    );
  }

  Widget _morePanel({required bool showCancel, required VoidCallback onCancel}) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('İşlemler', style: GoogleFonts.inter(fontSize: 12.5, fontWeight: FontWeight.w700)),
        const SizedBox(height: 10),
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: const Icon(Icons.support_agent_rounded, color: AppTheme.textSecondary),
          title: Text('Canlı Destek', style: GoogleFonts.inter(fontSize: 12.5, fontWeight: FontWeight.w600)),
          trailing: const Icon(Icons.chevron_right_rounded),
          onTap: () => _openWhatsAppSupport(),
        ),
        if (showCancel)
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.cancel_outlined, color: AppTheme.textSecondary),
            title: Text('Yolculuğu İptal Et', style: GoogleFonts.inter(fontSize: 12.5, fontWeight: FontWeight.w600)),
            trailing: const Icon(Icons.chevron_right_rounded),
            onTap: onCancel,
          ),
      ],
    );
  }

  Widget _routeExpansion(BuildContext context, RideModel ride) {
    return Material(
      color: AppTheme.backgroundColor,
      borderRadius: BorderRadius.circular(AppTheme.radiusSm),
      clipBehavior: Clip.antiAlias,
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          key: PageStorageKey<String>('route-${ride.id}'),
          tilePadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
          childrenPadding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
          title: Row(
            children: [
              Icon(Icons.route_rounded, size: 20, color: AppTheme.info),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Güzergah ve adresler',
                  style: GoogleFonts.inter(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: AppTheme.ink,
                  ),
                ),
              ),
            ],
          ),
          subtitle: Text(
            'Biniş · varış · ${_formatKm(ride)}',
            style: GoogleFonts.inter(
              fontSize: 12,
              fontWeight: FontWeight.w500,
              color: AppTheme.textSecondary,
            ),
          ),
          children: [
            _addressLine(
              icon: Icons.trip_origin,
              iconColor: AppTheme.accentColor,
              label: 'Yolcu konumu',
              text: ride.pickupAddress,
            ),
            const SizedBox(height: 10),
            _addressLine(
              icon: Icons.flag_rounded,
              iconColor: AppTheme.errorColor,
              label: 'Varış konumu',
              text: ride.dropoffAddress,
            ),
          ],
        ),
      ),
    );
  }

  String _formatKm(RideModel ride) {
    if (ride.distanceKm == null) return 'mesafe —';
    return '${ride.distanceKm!.toStringAsFixed(1)} km';
  }

  Widget _addressLine({
    required IconData icon,
    required Color iconColor,
    required String label,
    required String text,
  }) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 18, color: iconColor),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: GoogleFonts.inter(
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  color: AppTheme.textMuted,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                text,
                style: GoogleFonts.inter(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: AppTheme.textPrimary,
                  height: 1.35,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Future<void> _showCancelDialog(BuildContext context, WidgetRef ref, RideModel ride) async {
    final reasons = <String>[
      'Bekleme süresi uzun',
      'Planım değişti',
      'Konumu yanlış seçtim',
      'Fiyatı yüksek buldum',
      'Diğer',
    ];

    final selected = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: AppTheme.surfaceColor,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) {
        String? picked;
        return StatefulBuilder(
          builder: (ctx, setModalState) => SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'İptal sebebini seç',
                    style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800),
                  ),
                  const SizedBox(height: 10),
                  DropdownButtonFormField<String>(
                    value: picked,
                    isExpanded: true,
                    hint: const Text('Sebep seçiniz', style: TextStyle(fontSize: 13)),
                    items: reasons
                        .map((r) => DropdownMenuItem<String>(
                              value: r,
                              child: Text(r, style: const TextStyle(fontSize: 13)),
                            ))
                        .toList(),
                    onChanged: (v) => setModalState(() => picked = v),
                  ),
                  const SizedBox(height: 12),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton(
                      onPressed: picked == null ? null : () => Navigator.pop(ctx, picked),
                      child: const Text('Onayla', style: TextStyle(fontSize: 13)),
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );

    if (selected == null) return;
    if (!context.mounted) return;
    ref.read(socketServiceProvider).cancelRide(ride.id, reason: selected);
    ref.read(activeRideProvider.notifier).clear();
    ref.read(assignedDriverProvider.notifier).clear();
  }

  Widget _routeDashedConnector() {
    return Padding(
      padding: const EdgeInsets.only(left: 8),
      child: SizedBox(
        height: 22,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: List.generate(
            5,
            (_) => Container(
              width: 2,
              height: 3,
              color: const Color(0xFF9CA3AF),
            ),
          ),
        ),
      ),
    );
  }

  String _nameInitials(String fullName) {
    final parts = fullName
        .trim()
        .split(RegExp(r'\s+'))
        .where((p) => p.isNotEmpty)
        .toList();
    if (parts.length >= 2) {
      return '${parts[0][0].toUpperCase()}. ${parts[1][0].toUpperCase()}.';
    }
    if (parts.isNotEmpty) {
      return '${parts[0][0].toUpperCase()}.';
    }
    return 'S.';
  }

  String _shortNameWithSurnameInitial(String fullName) {
    final parts = fullName
        .trim()
        .split(RegExp(r'\s+'))
        .where((p) => p.isNotEmpty)
        .toList();
    if (parts.length >= 2) {
      return '${parts.first} ${parts[1][0].toUpperCase()}.';
    }
    if (parts.isNotEmpty) return parts.first;
    return 'Sürücü';
  }

  _StatusConfig _statusConfig(RideStatus status) {
    switch (status) {
      case RideStatus.searching:
        return _StatusConfig(
          icon: Icons.radar_rounded,
          color: AppTheme.primaryDark,
          subtitle: 'Sürücülerle eşleştiriliyor',
        );
      case RideStatus.accepted:
        return _StatusConfig(
          icon: Icons.local_taxi_rounded,
          color: AppTheme.info,
          subtitle: 'Sürücü yola çıktı — haritadan takip edin',
        );
      case RideStatus.arriving:
        return _StatusConfig(
          icon: Icons.person_pin_circle_rounded,
          color: AppTheme.ink,
          subtitle: 'Biniş noktasına gelindi veya geliniyor',
        );
      case RideStatus.inProgress:
        return _StatusConfig(
          icon: Icons.navigation_rounded,
          color: AppTheme.info,
          subtitle: 'Varış adresine gidiliyor',
        );
      case RideStatus.completed:
        return _StatusConfig(
          icon: Icons.check_circle_rounded,
          color: AppTheme.success,
          subtitle: 'Yolculuk tamamlandı',
        );
      case RideStatus.cancelled:
        return _StatusConfig(
          icon: Icons.cancel_rounded,
          color: AppTheme.errorColor,
          subtitle: 'Bu talep iptal edildi',
        );
    }
  }
}

class _StatusConfig {
  final IconData icon;
  final Color color;
  final String subtitle;
  const _StatusConfig({
    required this.icon,
    required this.color,
    required this.subtitle,
  });
}
