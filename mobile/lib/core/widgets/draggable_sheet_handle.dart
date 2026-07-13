import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

/// Üst çekme çubuğu — hafif gradient ve gölge ile daha “ürün” görünümü.
class DraggableSheetHandle extends StatelessWidget {
  const DraggableSheetHandle({super.key});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Container(
        width: 44,
        height: 5,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(100),
          gradient: LinearGradient(
            colors: [
              AppTheme.dividerColor,
              AppTheme.textSecondary.withOpacity(0.35),
              AppTheme.dividerColor,
            ],
          ),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.06),
              blurRadius: 4,
              offset: const Offset(0, 1),
            ),
          ],
        ),
      ),
    );
  }
}
