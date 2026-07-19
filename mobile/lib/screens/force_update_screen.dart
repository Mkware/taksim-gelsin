import 'dart:io' show Platform;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:url_launcher/url_launcher.dart';

import '../core/constants/app_constants.dart';

/// Zorunlu güncelleme kilidi — sunucunun `minSupportedAppVersion` değerinin
/// altındaki sürümler buraya yönlendirilir (bkz. app_router redirect +
/// `forceUpdateRequiredProvider`). Geri tuşu dahil hiçbir çıkış yolu yoktur;
/// tek aksiyon mağazaya gitmektir.
class ForceUpdateScreen extends StatelessWidget {
  const ForceUpdateScreen({super.key});

  Future<void> _openStore(BuildContext context) async {
    final url = !kIsWeb && Platform.isIOS
        ? AppConstants.appStoreUrl
        : AppConstants.playStoreUrl;
    if (url.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Lütfen uygulamayı mağazadan güncelleyin.'),
        ),
      );
      return;
    }
    try {
      await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
    } catch (e) {
      debugPrint('Mağaza açılamadı: $e');
    }
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      child: Scaffold(
        backgroundColor: const Color(0xFF031E5C),
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 32),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Container(
                  width: 96,
                  height: 96,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: Colors.white.withOpacity(0.08),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(
                    LucideIcons.cloudDownload,
                    size: 46,
                    color: Color(0xFFF6CF21),
                  ),
                ),
                const SizedBox(height: 28),
                Text(
                  'Güncelleme gerekli',
                  textAlign: TextAlign.center,
                  style: GoogleFonts.inter(
                    fontSize: 24,
                    fontWeight: FontWeight.w800,
                    color: Colors.white,
                  ),
                ),
                const SizedBox(height: 12),
                Text(
                  'Uygulamanın bu sürümü artık desteklenmiyor. '
                  'Devam etmek için lütfen en son sürüme güncelleyin.',
                  textAlign: TextAlign.center,
                  style: GoogleFonts.inter(
                    fontSize: 15,
                    height: 1.5,
                    color: Colors.white.withOpacity(0.75),
                  ),
                ),
                const SizedBox(height: 36),
                SizedBox(
                  height: 56,
                  child: FilledButton(
                    style: FilledButton.styleFrom(
                      backgroundColor: const Color(0xFFF6CF21),
                      foregroundColor: const Color(0xFF031E5C),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(16),
                      ),
                    ),
                    onPressed: () => _openStore(context),
                    child: Text(
                      'Şimdi güncelle',
                      style: GoogleFonts.inter(
                        fontSize: 17,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
