import 'package:flutter/material.dart';
import '../theme/app_theme.dart';
import 'pressable_scale.dart';

/// Harita üzeri yuvarlak aksiyon — gölge + basma animasyonu.
class MapFab extends StatelessWidget {
  const MapFab({
    super.key,
    required this.icon,
    required this.onTap,
    this.tooltip,
    /// Ride-app referansı: tek yumuşak gölge, sarı vurgu yok
    this.minimalStyle = false,
  });

  final IconData icon;
  final VoidCallback onTap;
  final String? tooltip;
  final bool minimalStyle;

  @override
  Widget build(BuildContext context) {
    final btn = PressableScale(
      onTap: onTap,
      child: Container(
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: AppTheme.surfaceColor,
          boxShadow: minimalStyle
              ? [
                  BoxShadow(
                    color: AppTheme.secondaryColor.withOpacity(0.14),
                    blurRadius: 16,
                    offset: const Offset(0, 4),
                  ),
                ]
              : [
                  BoxShadow(
                    color: AppTheme.secondaryColor.withOpacity(0.12),
                    blurRadius: 14,
                    offset: const Offset(0, 4),
                  ),
                  BoxShadow(
                    color: AppTheme.primaryColor.withOpacity(0.18),
                    blurRadius: 10,
                    offset: const Offset(0, 2),
                  ),
                ],
        ),
        padding: const EdgeInsets.all(13),
        child: Icon(icon, color: AppTheme.secondaryColor, size: 22),
      ),
    );

    if (tooltip != null) {
      return Tooltip(message: tooltip!, child: btn);
    }
    return btn;
  }
}
