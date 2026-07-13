import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../core/theme/app_theme.dart';
import '../../models/ride_model.dart';
import '../../providers/providers.dart';

/// Sürücü aktif yolculuk — kenarlardan boşluklu yüzer kart, üstte durum, altta net CTA.
class ActiveRidePanel extends ConsumerStatefulWidget {
  final RideModel ride;

  const ActiveRidePanel({super.key, required this.ride});

  @override
  ConsumerState<ActiveRidePanel> createState() => _ActiveRidePanelState();
}

class _ActiveRidePanelState extends ConsumerState<ActiveRidePanel> {
  static const _panelBg = Color(0xFF0A0B0E);
  late final TextEditingController _pinController;
  bool _autoVerifyingPin = false;
  String? _lastSubmittedPin;

  @override
  void initState() {
    super.initState();
    _pinController = TextEditingController()
      ..addListener(() {
        if (mounted) setState(() {});
      });
  }

  @override
  void dispose() {
    _pinController.dispose();
    super.dispose();
  }

  @override
  void didUpdateWidget(ActiveRidePanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.ride.id != widget.ride.id) {
      _pinController.clear();
    }
  }

  Future<void> _openGoogleDirections(double lat, double lng) async {
    final uri = Uri.parse(
      'https://www.google.com/maps/dir/?api=1&destination=$lat,$lng&travelmode=driving',
    );
    final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!ok && mounted) {
      ScaffoldMessenger.maybeOf(context)?.showSnackBar(
        const SnackBar(content: Text('Google Haritalar açılamadı.')),
      );
    }
  }

  Future<void> _callPhone(String phone) async {
    final normalized = phone.replaceAll(' ', '');
    final uri = Uri.parse('tel:$normalized');
    final ok = await launchUrl(uri);
    if (!ok && mounted) {
      ScaffoldMessenger.maybeOf(context)?.showSnackBar(
        const SnackBar(content: Text('Arama başlatılamadı.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final ride = widget.ride;
    final bottomInset = MediaQuery.paddingOf(context).bottom;
    const double edge = 12;

    return Padding(
      padding: EdgeInsets.fromLTRB(edge, 0, edge, edge + bottomInset),
      child: Material(
        color: _panelBg,
        elevation: 8,
        shadowColor: Colors.black54,
        borderRadius: BorderRadius.circular(26),
        clipBehavior: Clip.antiAlias,
        child: SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 12),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _compactStatusAndPrice(ride),
                const SizedBox(height: 12),
                _navAndPinSection(context, ride),
                const SizedBox(height: 12),
                _buildActionButtons(context, ref, ride),
                const SizedBox(height: 10),
                Text(
                  'Yolculuk sırasında uygulamayı açık tutun.',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: const Color(0xFF94A3B8).withOpacity(0.65),
                    fontSize: 10,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  bool _showNavPinSection(RideModel ride) {
    return ride.status == RideStatus.accepted ||
        ride.status == RideStatus.arriving ||
        ride.status == RideStatus.inProgress;
  }

  Widget _compactStatusAndPrice(RideModel ride) {
    final initials = _customerInitials(ride.customerName);
    final ratingText = ride.customerRating != null
        ? ride.customerRating!.toStringAsFixed(2)
        : null;
    return Column(
      children: [
        Row(
        children: [
          Expanded(
            child: Text(
              ratingText != null ? '$initials ($ratingText⭐)' : initials,
              style: const TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w700,
                fontSize: 16,
              ),
            ),
          ),
          const SizedBox(width: 8),
          Text(
            '${ride.displayPrice.toStringAsFixed(0)} TL',
            style: const TextStyle(
              fontSize: 21,
              fontWeight: FontWeight.w800,
              color: Colors.white,
            ),
          ),
        ],
        ),
        const SizedBox(height: 10),
        Row(
          children: const [
            Text(
              'Ödeme Yöntemi',
              style: TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w700,
                fontSize: 13,
              ),
            ),
            Spacer(),
            Icon(Icons.payments_outlined, size: 20, color: Colors.white),
            SizedBox(width: 8),
            Text(
              'Nakit',
              style: TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w700,
                fontSize: 13,
              ),
            ),
          ],
        ),
        Divider(
          color: Colors.white.withOpacity(0.14),
          thickness: 1,
          height: 20,
        ),
      ],
    );
  }

  Widget _navAndPinSection(BuildContext context, RideModel ride) {
    final isAccepted = ride.status == RideStatus.accepted;
    final isArriving = ride.status == RideStatus.arriving;
    final isTrip = ride.status == RideStatus.inProgress;
    final customerPhone = ride.customerPhone?.trim();
    final targetAddress =
        isTrip ? ride.dropoffAddress : ride.pickupAddress;
    final km = ride.distanceKm;
    final eta = km != null ? (km * 1.4).clamp(1, 60).round() : 2;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Padding(
              padding: EdgeInsets.only(top: 2),
              child: Icon(Icons.location_on, color: Colors.white, size: 34),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    km != null
                        ? '$eta dk (${km.toStringAsFixed(1)} km) uzaklıkta'
                        : '$eta dk uzaklıkta',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 17,
                      fontWeight: FontWeight.w800,
                      height: 1.1,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    targetAddress,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: Colors.white.withOpacity(0.9),
                      fontSize: 13.5,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        if (customerPhone != null && customerPhone.isNotEmpty) ...[
          const SizedBox(height: 10),
          SizedBox(
            height: 42,
            child: OutlinedButton.icon(
              onPressed: () => _callPhone(customerPhone),
              icon: const Icon(Icons.call_rounded, size: 18),
              label: const Text(
                'Yolcuyu Ara',
                style: TextStyle(fontWeight: FontWeight.w700),
              ),
              style: OutlinedButton.styleFrom(
                foregroundColor: Colors.white,
                side: BorderSide(color: Colors.white.withOpacity(0.55)),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(AppTheme.radiusSm),
                ),
              ),
            ),
          ),
        ],
        if (isArriving && !ride.pickupCodeVerified) ...[
          const SizedBox(height: 12),
          Text(
            'Biniş kodu',
            style: TextStyle(
              fontSize: 11.5,
              fontWeight: FontWeight.w700,
              color: Colors.white.withOpacity(0.8),
            ),
          ),
          const SizedBox(height: 6),
          TextField(
            controller: _pinController,
            keyboardType: TextInputType.number,
            maxLength: 4,
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w800,
              letterSpacing: 6,
              height: 1.2,
              color: Colors.white,
            ),
            cursorColor: Colors.white,
            onChanged: (value) {
              final pin = value.trim();
              if (pin.length == 4 &&
                  !_autoVerifyingPin &&
                  _lastSubmittedPin != pin) {
                _autoVerifyingPin = true;
                _lastSubmittedPin = pin;
                ref.read(socketServiceProvider).verifyPickupCode(ride.id, pin);
                Future<void>.delayed(const Duration(milliseconds: 700), () {
                  if (mounted) _autoVerifyingPin = false;
                });
              }
            },
            decoration: InputDecoration(
              counterText: '',
              hintText: '••••',
              hintStyle: TextStyle(
                letterSpacing: 6,
                fontSize: 14,
                color: Colors.white.withOpacity(0.4),
                fontWeight: FontWeight.w700,
              ),
              filled: true,
              fillColor: const Color(0xFF171A20),
              isDense: true,
              contentPadding:
                  const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(AppTheme.radiusSm),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(AppTheme.radiusSm),
                borderSide: BorderSide(color: Colors.white.withOpacity(0.24)),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(AppTheme.radiusSm),
                borderSide: const BorderSide(color: Colors.white, width: 1.2),
              ),
            ),
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
          ),
          const SizedBox(height: 8),
          Text(
            '4 haneli kod otomatik doğrulanır.',
            style: TextStyle(
              color: Colors.white.withOpacity(0.7),
              fontSize: 11,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ],
    );
  }

  Widget _buildActionButtons(
    BuildContext context,
    WidgetRef ref,
    RideModel ride,
  ) {
    final pickup = ride.pickupCoord;
    final dropoff = ride.dropoffCoord;
    final canNavigate = ride.status == RideStatus.inProgress ? dropoff != null : pickup != null;

    switch (ride.status) {
      case RideStatus.accepted:
      case RideStatus.arriving:
      case RideStatus.inProgress:
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: SizedBox(
                    height: 50,
                    child: OutlinedButton(
                      onPressed: canNavigate
                          ? () {
                              final target = ride.status == RideStatus.inProgress ? dropoff! : pickup!;
                              _openGoogleDirections(target.lat, target.lng);
                            }
                          : null,
                      style: OutlinedButton.styleFrom(
                        foregroundColor: Colors.white,
                        side: const BorderSide(color: Colors.white70, width: 1.4),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(AppTheme.radiusSm),
                        ),
                        disabledForegroundColor: Colors.white38,
                      ),
                      child: const Text(
                        'Yol Tarifi',
                        style: TextStyle(fontWeight: FontWeight.w800, fontSize: 14),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: SizedBox(
                    height: 50,
                    child: ElevatedButton(
                      onPressed: ride.status == RideStatus.arriving
                          ? null
                          : () {
                        if (ride.status == RideStatus.accepted) {
                          _arrivedAtPickup(ref, ride);
                        } else if (ride.status == RideStatus.inProgress) {
                          _completeRide(ref, ride);
                        }
                      },
                      child: Text(
                        ride.status == RideStatus.accepted
                            ? 'Binişteyim'
                            : ride.status == RideStatus.arriving
                                ? 'Kod Bekleniyor'
                                : 'Bitir',
                        style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14),
                      ),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFFD1D5DB),
                        foregroundColor: const Color(0xFF0A0B0E),
                        elevation: 0,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(AppTheme.radiusSm),
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            SizedBox(
              height: 44,
              child: OutlinedButton.icon(
                onPressed: () => _cancelRide(context, ref, ride),
                icon: const Icon(Icons.cancel_rounded, size: 18),
                label: const Text(
                  'Yolculuğu İptal Et',
                  style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13),
                ),
                style: OutlinedButton.styleFrom(
                  foregroundColor: const Color(0xFFFCA5A5),
                  side: const BorderSide(color: Color(0xFFB91C1C), width: 1.2),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(AppTheme.radiusSm),
                  ),
                ),
              ),
            ),
          ],
        );

      // Kod doğrulaması sonrası sürücü ekranında otomatik start çalışır.

      default:
        return const SizedBox.shrink();
    }
  }

  void _arrivedAtPickup(WidgetRef ref, RideModel ride) {
    ref.read(socketServiceProvider).arrivedAtPickup(ride.id);
    ref.read(activeRideProvider.notifier).updateStatus(RideStatus.arriving);
  }

  void _startRide(WidgetRef ref, RideModel ride) {
    ref.read(socketServiceProvider).startRide(ride.id);
  }

  void _completeRide(WidgetRef ref, RideModel ride) {
    ref.read(socketServiceProvider).completeRide(ride.id, finalPrice: ride.estimatedPrice);
    ref.read(activeRideProvider.notifier).clear();
  }

  Future<void> _cancelRide(BuildContext context, WidgetRef ref, RideModel ride) async {
    final reasons = <String>[
      'Yolcuya ulaşamıyorum',
      'Araç arızası',
      'Trafik/konum nedeniyle yetişemiyorum',
      'Güvenlik nedeniyle',
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
  }

  String _customerInitials(String? customerName) {
    if (customerName != null && customerName.trim().isNotEmpty) {
      final parts = customerName
          .trim()
          .split(RegExp(r'\s+'))
          .where((p) => p.isNotEmpty)
          .toList();
      if (parts.length >= 2) {
        return '${parts[0][0].toUpperCase()}. ${parts[1][0].toUpperCase()}.';
      }
      return '${parts.first[0].toUpperCase()}.';
    }
    return 'Y.';
  }
}
