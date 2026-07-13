import 'package:flutter/material.dart';

/// Sayfa açılırken fade + slide-up ile gelen sarmalayıcı.
///
/// `order` arttıkça giriş gecikmesi artar — stagger için kullan.
///
/// ```dart
/// AnimatedEntry(order: 0, child: Text('Başlık'))
/// AnimatedEntry(order: 1, child: Field())
/// AnimatedEntry(order: 2, child: Button())
/// ```
class AnimatedEntry extends StatefulWidget {
  const AnimatedEntry({
    super.key,
    required this.child,
    this.order = 0,
    this.step = const Duration(milliseconds: 70),
    this.duration = const Duration(milliseconds: 520),
    this.offsetY = 24,
    this.curve = Curves.easeOutCubic,
  });

  final Widget child;

  /// Stagger sırası (0, 1, 2, …). `order * step` kadar gecikir.
  final int order;
  final Duration step;
  final Duration duration;

  /// Başlangıç Y kayması (pixel).
  final double offsetY;
  final Curve curve;

  @override
  State<AnimatedEntry> createState() => _AnimatedEntryState();
}

class _AnimatedEntryState extends State<AnimatedEntry>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c;
  late final Animation<double> _opacity;
  late final Animation<Offset> _offset;

  @override
  void initState() {
    super.initState();
    _c = AnimationController(vsync: this, duration: widget.duration);
    final curved = CurvedAnimation(parent: _c, curve: widget.curve);
    _opacity = Tween<double>(begin: 0, end: 1).animate(curved);
    _offset = Tween<Offset>(
      begin: Offset(0, widget.offsetY / 100),
      end: Offset.zero,
    ).animate(curved);

    final delay = widget.step * widget.order;
    Future<void>.delayed(delay).then((_) {
      if (mounted) _c.forward();
    });
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FadeTransition(
      opacity: _opacity,
      child: SlideTransition(position: _offset, child: widget.child),
    );
  }
}
