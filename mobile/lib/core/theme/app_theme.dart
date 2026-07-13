import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';

/// Taksim Gelsin — premium tasarım sistemi (Material 3).
///
/// Palet: wordmark’taki altın `primary` + gece laciverdi `ink` / `brandMidnight` + açık yüzeylerde off-white.
/// Tüm ekranlar bu tek dosyadaki token'ları kullanır.
class AppTheme {
  AppTheme._();

  // ============================================================
  // MARKA / ANA RENKLER
  // ============================================================
  /// Wordmark “Gelsin” sarısı — logo ile hizalı ana aksiyon rengi
  static const Color primaryColor = Color(0xFFF5B915);
  static const Color primaryDark = Color(0xFFD4A008);
  static const Color primaryLight = Color(0xFFFFD54A);

  /// Derin gece (metin ve yüksek kontrast buton zemini)
  static const Color ink = Color(0xFF0B1020);
  static const Color inkSoft = Color(0xFF1A2135);

  /// Logo kanvası — çok koyu lacivert/siyah
  static const Color brandMidnight = Color(0xFF05070A);
  static const Color brandMidnightElevated = Color(0xFF0C1219);
  /// Koyu arayüz yüzeyi (giriş alanları)
  static const Color brandSurface = Color(0xFF141A24);
  static const Color brandBorderSubtle = Color(0xFF2A3444);

  /// Eski isim uyumluluğu (kod tabanının tamamı secondaryColor kullanıyor)
  static const Color secondaryColor = ink;

  // ============================================================
  // YÜZEY / ARKAPLAN
  // ============================================================
  static const Color surfaceColor = Colors.white;
  static const Color backgroundColor = Color(0xFFF5F6FA);
  static const Color subtle = Color(0xFFEEF0F6);
  static const Color border = Color(0xFFE4E7EE);
  static const Color dividerColor = border;

  // ============================================================
  // TİPOGRAFİ / DURUM
  // ============================================================
  static const Color textPrimary = Color(0xFF0B1020);
  static const Color textSecondary = Color(0xFF6B7280);
  static const Color textMuted = Color(0xFF9AA3B2);

  static const Color success = Color(0xFF10B981);
  static const Color info = Color(0xFF3B82F6);
  static const Color warning = Color(0xFFF59E0B);
  static const Color errorColor = Color(0xFFEF4444);

  /// Eski isim alias'ları
  static const Color accentColor = success;
  static const Color onlineColor = success;
  static const Color offlineColor = Color(0xFF9CA3AF);
  static const Color cancelColor = errorColor;

  // ============================================================
  // KÖŞE YARIÇAPLARI
  // ============================================================
  static const double radiusSm = 10;
  static const double radiusMd = 16;
  static const double radiusLg = 22;
  static const double radiusXl = 28;
  static const double radiusXxl = 36;

  // ============================================================
  // GRADIENT'LER
  // ============================================================
  static const LinearGradient primaryGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [primaryColor, primaryDark],
  );

  static const LinearGradient inkGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [ink, inkSoft],
  );

  static const LinearGradient skyGradient = LinearGradient(
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
    colors: [Color(0xFFF5F6FA), Colors.white],
  );

  /// Marka Hero etiketi (splash/login ↔ profil; uç uca hero uyumu için aynı etiket)
  static const String brandHeroTag = 'tg_brand_logo';

  /// Wordmark logo (PNG)
  static const String brandLogoAsset = 'assets/images/brand_logo.png';

  // ============================================================
  // MARKA GÖLGELERİ
  // ============================================================
  static List<BoxShadow> softShadow({double opacity = 0.06, double blur = 24}) => [
        BoxShadow(
          color: ink.withOpacity(opacity),
          blurRadius: blur,
          offset: const Offset(0, 8),
        ),
      ];

  static List<BoxShadow> primaryGlow({double opacity = 0.35}) => [
        BoxShadow(
          color: primaryColor.withOpacity(opacity),
          blurRadius: 24,
          offset: const Offset(0, 10),
        ),
      ];

  // ============================================================
  // TEMA
  // ============================================================
  static ThemeData get lightTheme {
    final base = GoogleFonts.poppinsTextTheme();
    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.light,
      colorScheme: ColorScheme.fromSeed(
        seedColor: primaryColor,
        primary: primaryColor,
        onPrimary: ink,
        secondary: ink,
        onSecondary: Colors.white,
        error: errorColor,
        surface: surfaceColor,
        surfaceContainerHighest: subtle,
        outline: border,
        brightness: Brightness.light,
      ),
      scaffoldBackgroundColor: backgroundColor,
      splashFactory: InkSparkle.splashFactory,
      textTheme: base.apply(
        bodyColor: textPrimary,
        displayColor: textPrimary,
      ).copyWith(
        displayLarge: base.displayLarge?.copyWith(fontWeight: FontWeight.w800, letterSpacing: -0.5),
        displayMedium: base.displayMedium?.copyWith(fontWeight: FontWeight.w800, letterSpacing: -0.3),
        headlineLarge: base.headlineLarge?.copyWith(fontWeight: FontWeight.w700),
        headlineMedium: base.headlineMedium?.copyWith(fontWeight: FontWeight.w700),
        titleLarge: base.titleLarge?.copyWith(fontWeight: FontWeight.w700),
        titleMedium: base.titleMedium?.copyWith(fontWeight: FontWeight.w600),
        titleSmall: base.titleSmall?.copyWith(fontWeight: FontWeight.w600),
        bodyLarge: base.bodyLarge?.copyWith(height: 1.45),
        bodyMedium: base.bodyMedium?.copyWith(height: 1.45),
        labelLarge: base.labelLarge?.copyWith(fontWeight: FontWeight.w700, letterSpacing: 0.2),
      ),
      pageTransitionsTheme: PageTransitionsTheme(
        builders: {
          TargetPlatform.android: FadeUpwardsPageTransitionsBuilder(),
          TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
          TargetPlatform.macOS: CupertinoPageTransitionsBuilder(),
        },
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        elevation: 6,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(radiusMd)),
        backgroundColor: ink,
        contentTextStyle: GoogleFonts.poppins(color: Colors.white, fontWeight: FontWeight.w500),
      ),
      dialogTheme: DialogThemeData(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(radiusXl)),
        elevation: 12,
        backgroundColor: surfaceColor,
      ),
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: surfaceColor,
        surfaceTintColor: Colors.transparent,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(radiusXxl)),
        ),
        modalBarrierColor: ink.withOpacity(0.35),
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: surfaceColor,
        foregroundColor: ink,
        elevation: 0,
        scrolledUnderElevation: 0,
        surfaceTintColor: Colors.transparent,
        centerTitle: false,
        systemOverlayStyle: const SystemUiOverlayStyle(
          statusBarColor: Colors.transparent,
          statusBarIconBrightness: Brightness.dark,
          statusBarBrightness: Brightness.light,
        ),
        titleTextStyle: GoogleFonts.poppins(
          fontSize: 18,
          fontWeight: FontWeight.w700,
          color: ink,
          letterSpacing: -0.2,
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: primaryColor,
          foregroundColor: ink,
          elevation: 0,
          shadowColor: Colors.transparent,
          minimumSize: const Size(double.infinity, 56),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(radiusMd)),
          textStyle: GoogleFonts.poppins(fontSize: 16, fontWeight: FontWeight.w700, letterSpacing: 0.2),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: ink,
          minimumSize: const Size(double.infinity, 54),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(radiusMd)),
          side: const BorderSide(color: border, width: 1.4),
          textStyle: GoogleFonts.poppins(fontWeight: FontWeight.w600),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: ink,
          textStyle: GoogleFonts.poppins(fontWeight: FontWeight.w600),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: surfaceColor,
        isDense: false,
        contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 18),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(radiusMd),
          borderSide: const BorderSide(color: border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(radiusMd),
          borderSide: const BorderSide(color: border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(radiusMd),
          borderSide: const BorderSide(color: primaryColor, width: 2),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(radiusMd),
          borderSide: const BorderSide(color: errorColor, width: 1.4),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(radiusMd),
          borderSide: const BorderSide(color: errorColor, width: 2),
        ),
        labelStyle: GoogleFonts.poppins(color: textSecondary, fontSize: 14, fontWeight: FontWeight.w500),
        hintStyle: GoogleFonts.poppins(color: textMuted, fontSize: 14),
        prefixIconColor: textSecondary,
        suffixIconColor: textSecondary,
      ),
      cardTheme: CardThemeData(
        elevation: 0,
        color: surfaceColor,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusLg),
          side: const BorderSide(color: border, width: 1),
        ),
        margin: EdgeInsets.zero,
      ),
      chipTheme: ChipThemeData(
        backgroundColor: subtle,
        side: BorderSide.none,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(radiusSm)),
        labelStyle: GoogleFonts.poppins(fontSize: 12, fontWeight: FontWeight.w600, color: ink),
      ),
      iconTheme: const IconThemeData(color: ink, size: 24),
      iconButtonTheme: IconButtonThemeData(
        style: IconButton.styleFrom(
          foregroundColor: ink,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(radiusMd)),
        ),
      ),
      listTileTheme: const ListTileThemeData(
        iconColor: ink,
        textColor: textPrimary,
        contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      ),
      dividerTheme: const DividerThemeData(color: border, thickness: 1, space: 1),
      switchTheme: SwitchThemeData(
        trackColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) return primaryColor;
          return subtle;
        }),
        thumbColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) return ink;
          return Colors.white;
        }),
        trackOutlineColor: const WidgetStatePropertyAll(Colors.transparent),
      ),
      bottomNavigationBarTheme: const BottomNavigationBarThemeData(
        backgroundColor: surfaceColor,
        selectedItemColor: primaryColor,
        unselectedItemColor: textSecondary,
      ),
    );
  }
}
