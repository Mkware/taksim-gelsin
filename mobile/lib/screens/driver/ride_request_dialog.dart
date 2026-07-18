import 'dart:async';
import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:google_fonts/google_fonts.dart';
import '../../core/constants/app_constants.dart';

/// Gelen talep — Uber tarzı: büyük ücret, net iki aksiyon, geri sayım.
class RideRequestDialog extends StatefulWidget {
  final Map<String, dynamic> data;
  final VoidCallback onAccept;
  final VoidCallback onReject;

  const RideRequestDialog({
    super.key,
    required this.data,
    required this.onAccept,
    required this.onReject,
  });

  @override
  State<RideRequestDialog> createState() => _RideRequestDialogState();
}

class _RideRequestDialogState extends State<RideRequestDialog> {
  late DateTime _expiresAt;
  int _remainingSeconds = 0;
  Timer? _countdownTimer;

  @override
  void initState() {
    super.initState();
    final deadlineMs = (widget.data['responseDeadlineMs'] as num?)?.toInt();
    if (deadlineMs != null && deadlineMs > 0) {
      _expiresAt = DateTime.fromMillisecondsSinceEpoch(deadlineMs, isUtc: false);
    } else {
      final serverSec = (widget.data['responseTimeoutSeconds'] as num?)?.round();
      final sec = serverSec != null && serverSec > 0
          ? serverSec
          : AppConstants.driverResponseTimeoutSeconds;
      _expiresAt = DateTime.now().add(Duration(seconds: sec));
    }
    _syncRemainingSeconds();
    if (_remainingSeconds <= 0) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        widget.onReject();
      });
      return;
    }
    _countdownTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      _syncRemainingSeconds();
      if (_remainingSeconds <= 0) {
        timer.cancel();
        widget.onReject();
      }
    });
  }

  void _syncRemainingSeconds() {
    final now = DateTime.now();
    final seconds = _expiresAt.difference(now).inSeconds;
    final next = seconds < 0 ? 0 : seconds;
    if (!mounted) return;
    setState(() => _remainingSeconds = next);
  }

  @override
  void dispose() {
    _countdownTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final pickupAddress = widget.data['pickupAddress'] as String? ??
        widget.data['pickup']?['address'] as String? ??
        'Biniş';
    final dropoffAddress = widget.data['dropoffAddress'] as String? ??
        widget.data['dropoff']?['address'] as String? ??
        'Varış';
    final price = (widget.data['estimatedPrice'] as num?)?.toDouble() ??
        (widget.data['price'] as num?)?.toDouble() ??
        0.0;
    final distanceKm = (widget.data['distanceKm'] as num?)?.toDouble();
    final customerName = widget.data['customerInfo']?['fullName'] as String? ??
        widget.data['customerName'] as String? ??
        'Yolcu';
    final customerInitials = customerName
        .trim()
        .split(RegExp(r'\s+'))
        .where((p) => p.isNotEmpty)
        .take(2)
        .map((p) => '${p[0].toUpperCase()}.')
        .join('');
    final customerRating =
        (widget.data['customerInfo']?['rating'] as num?)?.toDouble() ?? 5.0;
    final paymentMethod = (widget.data['paymentMethod'] as String?) ?? 'Nakit';
    final pickupEtaText = (widget.data['pickupEtaText'] as String?) ??
        (distanceKm != null ? '${(distanceKm * 2).clamp(1, 12).round()} dk uzakta' : 'Yakında');
    final dropoffEtaText = (widget.data['dropoffEtaText'] as String?) ?? 'Varış noktası';
    final acceptFeeTcoin =
        (widget.data['acceptFeeTcoin'] as num?)?.toDouble();
    final balanceTcoin = (widget.data['balanceTcoin'] as num?)?.toDouble();
    final pickupMasked = widget.data['pickupMasked'] == true;
    final uncertaintyM =
        (widget.data['pickupUncertaintyM'] as num?)?.toDouble();

    final urgent = _remainingSeconds <= 3;
    final canAccept = acceptFeeTcoin == null ||
        balanceTcoin == null ||
        balanceTcoin >= acceptFeeTcoin;

    return Align(
      alignment: Alignment.bottomCenter,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 12, 12, 12),
        child: Material(
          color: const Color(0xFF0A0B0E),
          borderRadius: BorderRadius.circular(26),
          clipBehavior: Clip.antiAlias,
          child: SafeArea(
            top: false,
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 520),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(18, 10, 18, 14),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Text(
                            '$customerInitials (${customerRating.toStringAsFixed(2)}⭐)',
                            style: GoogleFonts.inter(
                              fontSize: 17,
                              fontWeight: FontWeight.w700,
                              color: Colors.white,
                            ),
                          ),
                        ),
                        const SizedBox(width: 10),
                        Text(
                          '${price.toStringAsFixed(0)} TL',
                          style: GoogleFonts.inter(
                            fontSize: 30,
                            fontWeight: FontWeight.w800,
                            letterSpacing: -1.2,
                            color: Colors.white,
                            height: 0.95,
                          ),
                        ),
                      ],
                    ),
                    if (acceptFeeTcoin != null) ...[
                      const SizedBox(height: 10),
                      Text(
                        balanceTcoin != null
                            ? 'Kabul: ${acceptFeeTcoin.toStringAsFixed(0)} T Coin · Bakiye: ${balanceTcoin.toStringAsFixed(0)} T'
                            : 'Kabul ücreti: ${acceptFeeTcoin.toStringAsFixed(0)} T Coin',
                        style: GoogleFonts.inter(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          color: balanceTcoin != null &&
                                  balanceTcoin < acceptFeeTcoin
                              ? const Color(0xFFF87171)
                              : Colors.white.withOpacity(0.88),
                        ),
                      ),
                    ],
                    if (pickupMasked && uncertaintyM != null) ...[
                      const SizedBox(height: 6),
                      Text(
                        'Biniş yaklaşık ±${uncertaintyM.toStringAsFixed(0)} m',
                        style: GoogleFonts.inter(
                          fontSize: 12,
                          fontWeight: FontWeight.w500,
                          color: Colors.white.withOpacity(0.55),
                        ),
                      ),
                    ],
                    const SizedBox(height: 14),
                    Row(
                      children: [
                        Text(
                          'Ödeme Yöntemi',
                          style: GoogleFonts.inter(
                            fontSize: 14,
                            color: Colors.white.withOpacity(0.86),
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const Spacer(),
                        const Icon(LucideIcons.banknote,
                            size: 22, color: Colors.white),
                        const SizedBox(width: 8),
                        Text(
                          paymentMethod,
                          style: GoogleFonts.inter(
                            fontSize: 14,
                            color: Colors.white,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
                    Divider(
                      color: Colors.white.withOpacity(0.28),
                      thickness: 1,
                      height: 18,
                    ),
                    const SizedBox(height: 6),
                    _stepLine(
                      icon: LucideIcons.mapPin,
                      iconColor: const Color(0xFF22C55E),
                      title: pickupEtaText,
                      subtitle: pickupAddress,
                    ),
                    Padding(
                      padding: const EdgeInsets.only(left: 15),
                      child: Container(
                        width: 2,
                        height: 22,
                        color: Colors.white.withOpacity(0.25),
                      ),
                    ),
                    _stepLine(
                      icon: LucideIcons.route,
                      iconColor: const Color(0xFF22C55E),
                      title: distanceKm != null
                          ? '${distanceKm.toStringAsFixed(1)} km uzaklıkta'
                          : 'Yolculuk bilgisi',
                      subtitle: dropoffAddress,
                    ),
                    Padding(
                      padding: const EdgeInsets.only(left: 15),
                      child: Container(
                        width: 2,
                        height: 22,
                        color: Colors.white.withOpacity(0.25),
                      ),
                    ),
                    _stepLine(
                      icon: LucideIcons.mapPin,
                      iconColor: Colors.white,
                      title: dropoffEtaText,
                      subtitle: dropoffAddress,
                    ),
                    const SizedBox(height: 16),
                    GestureDetector(
                      onTap: canAccept ? widget.onAccept : null,
                      child: Container(
                        height: 64,
                        decoration: BoxDecoration(
                          color: canAccept
                              ? Colors.white.withOpacity(0.72)
                              : Colors.white.withOpacity(0.28),
                          borderRadius: BorderRadius.circular(18),
                        ),
                        child: Row(
                          children: [
                            const SizedBox(width: 18),
                            Expanded(
                              child: Text(
                                'Kabul et',
                                style: GoogleFonts.inter(
                                  fontSize: 19,
                                  fontWeight: FontWeight.w700,
                                  color: const Color(0xFF0A0B0E),
                                ),
                              ),
                            ),
                            Container(
                              width: 90,
                              height: double.infinity,
                              decoration: BoxDecoration(
                                color: Colors.white.withOpacity(0.38),
                                borderRadius: const BorderRadius.horizontal(
                                  right: Radius.circular(18),
                                ),
                              ),
                              alignment: Alignment.center,
                              child: Container(
                                width: 44,
                                height: 44,
                                decoration: BoxDecoration(
                                  color: urgent
                                      ? const Color(0xFFB91C1C).withOpacity(0.9)
                                      : Colors.black.withOpacity(0.24),
                                  shape: BoxShape.circle,
                                ),
                                alignment: Alignment.center,
                                child: Text(
                                  '$_remainingSeconds',
                                  style: GoogleFonts.inter(
                                    color: Colors.white,
                                    fontSize: 19,
                                    fontWeight: FontWeight.w800,
                                  ),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextButton(
                      onPressed: widget.onReject,
                      child: Text(
                        'Reddet',
                        style: GoogleFonts.inter(
                          color: const Color(0xFFEF4444),
                          fontWeight: FontWeight.w800,
                          fontSize: 14,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _stepLine({
    required IconData icon,
    required Color iconColor,
    required String title,
    required String subtitle,
  }) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 30,
          height: 30,
          decoration: BoxDecoration(
            color: iconColor == Colors.white
                ? Colors.white.withOpacity(0.14)
                : iconColor,
            shape: BoxShape.circle,
          ),
          child: Icon(
            icon,
            size: 19,
            color: iconColor == Colors.white ? Colors.white : const Color(0xFF07130A),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: GoogleFonts.inter(
                  fontSize: 17,
                  fontWeight: FontWeight.w800,
                  color: Colors.white,
                  height: 1.05,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                subtitle,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: GoogleFonts.inter(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                  color: Colors.white.withOpacity(0.9),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
