import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

/// Wordmark: sabit çerçeve + [BoxFit.cover] ile PNG’deki fazla boşluk kırpılır;
/// hafif yuvarlatılmış köşe.
class BrandLogo extends StatelessWidget {
  const BrandLogo({
    super.key,
    required this.width,
    required this.height,
    this.borderRadius = 12,
  });

  final double width;
  final double height;

  /// Köşe yuvarlaklığı (px).
  final double borderRadius;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(borderRadius),
      child: SizedBox(
        width: width,
        height: height,
        child: Image.asset(
          AppTheme.brandLogoAsset,
          fit: BoxFit.contain,
          alignment: Alignment.center,
          filterQuality: FilterQuality.high,
          gaplessPlayback: true,
        ),
      ),
    );
  }
}
