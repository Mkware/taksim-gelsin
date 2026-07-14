import 'package:flutter/material.dart';

/// Ekranın en üstünde ince, sağa-sola sürekli kayan parlak bir çizgi —
/// sürücü çevrimiçiyken "canlı/aktif" hissi veren dekoratif tarayıcı bar.
class OnlineScanBar extends StatefulWidget {
  const OnlineScanBar({
    super.key,
    required this.active,
    this.color = const Color(0xFF10B981),
    this.height = 3,
  });

  /// false ise bar görünmez (fade ile kaybolur), animasyon durur.
  final bool active;
  final Color color;
  final double height;

  @override
  State<OnlineScanBar> createState() => _OnlineScanBarState();
}

class _OnlineScanBarState extends State<OnlineScanBar>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c;

  @override
  void initState() {
    super.initState();
    _c = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1700),
    );
    if (widget.active) _c.repeat(reverse: true);
  }

  @override
  void didUpdateWidget(covariant OnlineScanBar old) {
    super.didUpdateWidget(old);
    if (widget.active && !_c.isAnimating) _c.repeat(reverse: true);
    if (!widget.active && _c.isAnimating) _c.stop();
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: AnimatedOpacity(
        duration: const Duration(milliseconds: 320),
        opacity: widget.active ? 1 : 0,
        child: SizedBox(
          height: widget.height,
          width: double.infinity,
          child: Stack(
            children: [
              // Sönük taban çizgi
              Container(color: widget.color.withOpacity(0.14)),
              // Sağa-sola kayan parlak segment
              AnimatedBuilder(
                animation: _c,
                builder: (context, _) {
                  final t = Curves.easeInOut.transform(_c.value);
                  return Align(
                    alignment: Alignment(-1 + 2 * t, 0),
                    child: FractionallySizedBox(
                      widthFactor: 0.3,
                      child: Container(
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            colors: [
                              widget.color.withOpacity(0),
                              widget.color,
                              widget.color.withOpacity(0),
                            ],
                          ),
                          boxShadow: [
                            BoxShadow(
                              color: widget.color.withOpacity(0.65),
                              blurRadius: 6,
                            ),
                          ],
                        ),
                      ),
                    ),
                  );
                },
              ),
            ],
          ),
        ),
      ),
    );
  }
}
