import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../providers/providers.dart';
import 'ride_searching_animation.dart';

/// Alt panel — yalnızca bekleme süresi ve ilerleme çubuğu (animasyon harita balonunda).
class RideSearchingProgressCard extends ConsumerStatefulWidget {
  const RideSearchingProgressCard({super.key});

  @override
  ConsumerState<RideSearchingProgressCard> createState() =>
      _RideSearchingProgressCardState();
}

class _RideSearchingProgressCardState extends ConsumerState<RideSearchingProgressCard> {
  Timer? _tick;
  double _visualFill = 0;

  @override
  void initState() {
    super.initState();
    _tick = Timer.periodic(const Duration(milliseconds: 80), (_) => _onTick());
  }

  void _onTick() {
    if (!mounted) return;
    final progress = ref.read(rideMatchingProgressProvider);
    final target = progress?.waitProgressFraction() ?? 0;
    final next = _visualFill + (target - _visualFill) * 0.14;
    if ((next - _visualFill).abs() > 0.001) {
      setState(() => _visualFill = next.clamp(0.0, 1.0));
    }
  }

  @override
  void dispose() {
    _tick?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final progress = ref.watch(rideMatchingProgressProvider);
    final hasQueue = progress != null && progress.driversQueued > 0;
    final maxWait = progress?.displayMaxWaitSeconds() ?? 0;
    final barValue = hasQueue ? _visualFill.clamp(0.04, 1.0) : null;
    final waitLabel = hasQueue && maxWait > 0 ? '~$maxWait sn' : 'Bekleniyor';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'Eşleştirme devam ediyor',
          style: GoogleFonts.inter(
            fontSize: 13,
            fontWeight: FontWeight.w600,
            color: const Color(0xFF6B7280),
          ),
        ),
        const SizedBox(height: 10),
        Stack(
          clipBehavior: Clip.none,
          children: [
            Padding(
              padding: const EdgeInsets.only(top: 18),
              child: RideSearchingShimmerBar(value: barValue),
            ),
            Positioned(
              top: 0,
              right: 0,
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    waitLabel,
                    style: GoogleFonts.inter(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: const Color(0xFF6B7280),
                    ),
                  ),
                  if (!hasQueue || maxWait <= 0) ...[
                    const SizedBox(width: 2),
                    const RideSearchingDots(),
                  ],
                ],
              ),
            ),
          ],
        ),
      ],
    );
  }
}
