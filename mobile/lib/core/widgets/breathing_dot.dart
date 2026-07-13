import 'package:flutter/material.dart';

/// Nefes alan nokta — çevrimiçi / canlı durumlar için.
/// İki eş merkezli daire; dış halka yavaşça büyüyüp solar.
class BreathingDot extends StatefulWidget {
  const BreathingDot({
    super.key,
    this.color = const Color(0xFF10B981),
    this.size = 10,
    this.pulse = true,
  });

  final Color color;
  final double size;

  /// false verilirse sadece statik nokta (çevrimdışı durumu için).
  final bool pulse;

  @override
  State<BreathingDot> createState() => _BreathingDotState();
}

class _BreathingDotState extends State<BreathingDot>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c;

  @override
  void initState() {
    super.initState();
    _c = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1800),
    );
    if (widget.pulse) _c.repeat();
  }

  @override
  void didUpdateWidget(covariant BreathingDot old) {
    super.didUpdateWidget(old);
    if (widget.pulse && !_c.isAnimating) _c.repeat();
    if (!widget.pulse && _c.isAnimating) _c.stop();
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final outer = widget.size * 2.4;
    return SizedBox(
      width: outer,
      height: outer,
      child: AnimatedBuilder(
        animation: _c,
        builder: (context, _) {
          final t = Curves.easeInOut.transform(_c.value);
          final scale = 0.6 + t * 0.9;
          final opacity = (1 - t) * 0.55;
          return Stack(
            alignment: Alignment.center,
            children: [
              if (widget.pulse)
                Transform.scale(
                  scale: scale,
                  child: Container(
                    width: outer,
                    height: outer,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: widget.color.withOpacity(opacity),
                    ),
                  ),
                ),
              Container(
                width: widget.size,
                height: widget.size,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: widget.color,
                  boxShadow: [
                    BoxShadow(
                      color: widget.color.withOpacity(0.45),
                      blurRadius: 8,
                    ),
                  ],
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}
