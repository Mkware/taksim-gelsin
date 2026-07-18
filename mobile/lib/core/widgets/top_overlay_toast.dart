import 'dart:async';

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

OverlayEntry? _topToastEntry;
Timer? _topToastTimer;

/// Alt SnackBar yerine güvenli alanın altında, dokunuşları geçiren üst bildirim.
void showTopOverlayToast(
  BuildContext context,
  String message,
  Color color, {
  double belowStatusBar = 56,
}) {
  if (!context.mounted) return;
  dismissTopOverlayToast();

  final overlay = Overlay.of(context);
  final top = MediaQuery.paddingOf(context).top + belowStatusBar;

  _topToastEntry = OverlayEntry(
    builder: (_) => Positioned(
      top: top,
      left: 16,
      right: 16,
      child: IgnorePointer(
        ignoring: true,
        child: Material(
          color: Colors.transparent,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.94),
              borderRadius: BorderRadius.circular(12),
              boxShadow: const [
                BoxShadow(
                  color: Color(0x55000000),
                  blurRadius: 14,
                  offset: Offset(0, 6),
                ),
              ],
            ),
            child: Row(
              children: [
                const Icon(LucideIcons.info,
                    color: Colors.white, size: 18),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    message,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w700,
                      fontSize: 13.5,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    ),
  );

  overlay.insert(_topToastEntry!);
  _topToastTimer = Timer(const Duration(seconds: 3), dismissTopOverlayToast);
}

void dismissTopOverlayToast() {
  _topToastTimer?.cancel();
  _topToastTimer = null;
  _topToastEntry?.remove();
  _topToastEntry = null;
}
