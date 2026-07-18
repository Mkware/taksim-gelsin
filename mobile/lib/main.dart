import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:intl/intl.dart';
import 'core/theme/app_theme.dart';
import 'core/router/app_router.dart';
import 'fcm_background_handler.dart';
import 'firebase_options.dart';
import 'providers/providers.dart';

/// Hot restart / bazı simülatörlerde Pigeon kanalı kopunca `path_provider` çağrısı hata verir.
/// `google_fonts` fontu ağdan aldıktan sonra diske yazarken bu hatayı verir; font yine de yüklenir.
bool _isIgnorablePathProviderChannelNoise(Object? error) {
  if (error is! PlatformException) return false;
  if (error.code != 'channel-error') return false;
  final msg = '${error.message}'.toLowerCase();
  return msg.contains('path_provider') ||
      msg.contains('pathproviderapi') ||
      msg.contains('getdirectorypath');
}

void _installFontDiskCacheErrorFilter() {
  FlutterError.onError = (FlutterErrorDetails details) {
    if (_isIgnorablePathProviderChannelNoise(details.exception)) {
      if (kDebugMode) {
        debugPrint(
          'google_fonts disk önbelleği atlandı (hot restart sonrası sık görülür): '
          '${details.exception}',
        );
      }
      return;
    }
    FlutterError.presentError(details);
  };
}

Future<void> main() async {
  await runZonedGuarded(() async {
    WidgetsFlutterBinding.ensureInitialized();
    // Yalnızca dikey — harita/yolculuk ekranları yatay için tasarlanmadı.
    await SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);
    try {
      await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
      FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);
    } catch (e, st) {
      if (kDebugMode) {
        debugPrint(
          'Firebase başlatılamadı (google-services / flutterfire configure): $e\n$st',
        );
      }
    }
    PlatformDispatcher.instance.onError = (Object error, StackTrace stack) {
      if (_isIgnorablePathProviderChannelNoise(error)) {
        if (kDebugMode) {
          debugPrint('path_provider Pigeon (yutuldu): $error');
        }
        return true;
      }
      return false;
    };
    _installFontDiskCacheErrorFilter();
    // Türkçe tarih/gün adları için locale verilerini yükle — yoksa
    // DateFormat('..', 'tr_TR').format(...) LocaleDataException fırlatır.
    await initializeDateFormatting('tr_TR', null);
    Intl.defaultLocale = 'tr_TR';
    runApp(const ProviderScope(child: TaksimGelsinApp()));
  }, (Object error, StackTrace stack) {
    if (_isIgnorablePathProviderChannelNoise(error)) {
      if (kDebugMode) {
        debugPrint(
          'google_fonts arka plan disk yazımı (yok sayıldı): $error',
        );
      }
      return;
    }
    debugPrint('Unhandled zone error: $error');
    debugPrintStack(stackTrace: stack);
  });
}

class TaksimGelsinApp extends ConsumerStatefulWidget {
  const TaksimGelsinApp({super.key});

  @override
  ConsumerState<TaksimGelsinApp> createState() => _TaksimGelsinAppState();
}

class _TaksimGelsinAppState extends ConsumerState<TaksimGelsinApp> {
  @override
  Widget build(BuildContext context) {
    final router = ref.watch(appRouterProvider);

    ref.listen<String?>(sessionKickMessageProvider, (prev, next) {
      if (next != null && next.isNotEmpty) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (!context.mounted) return;
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(next, style: const TextStyle(color: Colors.white)),
              backgroundColor: const Color(0xFF1A237E),
              behavior: SnackBarBehavior.floating,
            ),
          );
          ref.read(sessionKickMessageProvider.notifier).state = null;
        });
      }
    });

    final locale = ref.watch(appLocaleProvider);

    return MaterialApp.router(
      title: 'Taksim Gelsin',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.lightTheme,
      routerConfig: router,
      locale: locale,
      supportedLocales: const [Locale('tr', 'TR'), Locale('en', 'US')],
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
    );
  }
}
