import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import '../../core/theme/app_theme.dart';
import '../../providers/providers.dart';

/// Uygulama dili — MaterialApp locale ile senkron.
class LanguageSettingsScreen extends ConsumerWidget {
  const LanguageSettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = ref.watch(appLocaleProvider);
    final notifier = ref.read(appLocaleProvider.notifier);

    return Scaffold(
      backgroundColor: AppTheme.backgroundColor,
      appBar: AppBar(
        title: Text('Dil', style: GoogleFonts.inter(fontWeight: FontWeight.w700)),
        backgroundColor: AppTheme.surfaceColor,
        foregroundColor: AppTheme.ink,
        elevation: 0,
      ),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Text(
            'Arayüz dilini seç. Tarih ve sayı biçimleri seçime göre güncellenir.',
            style: GoogleFonts.inter(
              color: AppTheme.textSecondary,
              fontSize: 14,
              height: 1.35,
            ),
          ),
          const SizedBox(height: 16),
          RadioListTile<Locale>(
            title: Text('Türkçe', style: GoogleFonts.inter(fontWeight: FontWeight.w600)),
            value: const Locale('tr', 'TR'),
            groupValue: locale,
            activeColor: AppTheme.primaryDark,
            onChanged: (v) {
              if (v != null) notifier.setLocale(v);
            },
          ),
        ],
      ),
    );
  }
}
