import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

/// Düğüm stili: [gradient] varsayılan; [brandSolid] logo sarısı düz dolgu + koyu metin.
enum PrimaryGradientButtonVariant {
  gradient,
  brandSolid,
}

/// Ana aksiyon — gradient veya marka solid, gölge, yükleme durumu.
class PrimaryGradientButton extends StatelessWidget {
  const PrimaryGradientButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.icon,
    this.loading = false,
    this.height = 52,
    this.variant = PrimaryGradientButtonVariant.gradient,
  });

  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final bool loading;
  final double height;
  final PrimaryGradientButtonVariant variant;

  static const Color _labelOnGold = AppTheme.ink;

  @override
  Widget build(BuildContext context) {
    final disabled = onPressed == null || loading;
    final radius = variant == PrimaryGradientButtonVariant.brandSolid ? 18.0 : 16.0;

    return AnimatedOpacity(
      opacity: disabled && !loading ? 0.55 : 1,
      duration: const Duration(milliseconds: 200),
      child: Material(
        color: Colors.transparent,
        elevation: 0,
        child: InkWell(
          onTap: disabled ? null : onPressed,
          borderRadius: BorderRadius.circular(radius),
          child: Ink(
            height: height,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(radius),
              gradient: variant == PrimaryGradientButtonVariant.brandSolid
                  ? null
                  : LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: disabled
                          ? [
                              AppTheme.primaryColor.withValues(alpha: 0.65),
                              AppTheme.primaryDark.withValues(alpha: 0.65),
                            ]
                          : [
                              AppTheme.primaryColor,
                              AppTheme.primaryDark,
                            ],
                    ),
              color: variant == PrimaryGradientButtonVariant.brandSolid
                  ? (disabled
                      ? AppTheme.primaryColor.withValues(alpha: 0.5)
                      : AppTheme.primaryColor)
                  : null,
              boxShadow: [
                if (!disabled)
                  BoxShadow(
                    color: AppTheme.primaryColor.withValues(
                      alpha: variant == PrimaryGradientButtonVariant.brandSolid ? 0.38 : 0.42,
                    ),
                    blurRadius:
                        variant == PrimaryGradientButtonVariant.brandSolid ? 20 : 16,
                    offset: const Offset(0, 8),
                  ),
              ],
            ),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  if (loading)
                    SizedBox(
                      width: 24,
                      height: 24,
                      child: CircularProgressIndicator(
                        strokeWidth: 2.5,
                        color: variant == PrimaryGradientButtonVariant.brandSolid
                            ? _labelOnGold
                            : AppTheme.secondaryColor,
                      ),
                    )
                  else ...[
                    if (icon != null) ...[
                      Icon(
                        icon,
                        color: variant == PrimaryGradientButtonVariant.brandSolid
                            ? _labelOnGold
                            : AppTheme.secondaryColor,
                        size: 22,
                      ),
                      const SizedBox(width: 10),
                    ],
                    Text(
                      label,
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 0.2,
                        color: variant == PrimaryGradientButtonVariant.brandSolid
                            ? _labelOnGold
                            : AppTheme.secondaryColor,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
