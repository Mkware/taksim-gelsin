import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

/// Marka kartı — yumuşak gölge, beyaz zemin, ince çerçeve.
class GlassCard extends StatelessWidget {
  const GlassCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(18),
    this.radius = AppTheme.radiusLg,
    this.shadow,
    this.color,
    this.border,
    this.onTap,
  });

  final Widget child;
  final EdgeInsets padding;
  final double radius;
  final List<BoxShadow>? shadow;
  final Color? color;
  final BoxBorder? border;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final decoration = BoxDecoration(
      color: color ?? AppTheme.surfaceColor,
      borderRadius: BorderRadius.circular(radius),
      border: border ?? Border.all(color: AppTheme.border),
      boxShadow: shadow ?? AppTheme.softShadow(),
    );

    final content = Container(
      padding: padding,
      decoration: decoration,
      child: child,
    );

    if (onTap == null) return content;

    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(radius),
        onTap: onTap,
        child: content,
      ),
    );
  }
}
