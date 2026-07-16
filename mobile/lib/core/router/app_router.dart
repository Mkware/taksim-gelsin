import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../providers/providers.dart';

// Ekran import'ları
import '../../screens/splash_screen.dart';
import '../../screens/onboarding/onboarding_screen.dart';
import '../../screens/auth/login_screen.dart';
import '../../screens/auth/register_screen.dart';
import '../../screens/customer/customer_home_screen.dart';
import '../../screens/customer/ride_history_screen.dart';
import '../../screens/driver/driver_home_screen.dart';
import '../../screens/driver/driver_wallet_screen.dart';
import '../../screens/profile/profile_screen.dart';
import '../../screens/profile/notification_settings_screen.dart';
import '../../screens/profile/language_settings_screen.dart';
import '../../screens/profile/edit_profile_screen.dart';
import '../../screens/legal/legal_information_screen.dart';

/// Oturum / rol değişince GoRouter'ı yeniden oluşturmadan redirect'i tetikler.
/// Aksi halde girişte yeni GoRouter oluşur, stack sıfırlanır, splash tekrar çalışır ve socket iki kez bağlanır.
class _GoRouterRefresh extends ChangeNotifier {
  _GoRouterRefresh(this._ref) {
    _ref.listen<bool>(isLoggedInProvider, (_, __) => notifyListeners());
    _ref.listen<String?>(userRoleProvider, (_, __) => notifyListeners());
  }

  final Ref _ref;
}

/// Uygulama yönlendirme (GoRouter + Riverpod)
final appRouterProvider = Provider<GoRouter>((ref) {
  final refresh = _GoRouterRefresh(ref);

  return GoRouter(
    refreshListenable: refresh,
    initialLocation: '/splash',
    debugLogDiagnostics: true,
    redirect: (context, state) {
      final isLoggedIn = ref.read(isLoggedInProvider);
      final userRole = ref.read(userRoleProvider);

      final isSplash = state.uri.path == '/splash';
      final isAuthRoute = state.uri.path.startsWith('/auth');
      final isLegalRoute = state.uri.path == '/legal';
      final isOnboardingRoute = state.uri.path == '/onboarding';

      // Splash ekranında yönlendirme yapma
      if (isSplash) return null;

      // Oturum açıkken tanıtım ekranına gerek yok
      if (isLoggedIn && isOnboardingRoute) {
        return userRole == 'driver' ? '/driver' : '/customer';
      }

      // Giriş yapmamış → yalnızca auth + yasal metinler + tanıtım açık
      if (!isLoggedIn && !isAuthRoute && !isLegalRoute && !isOnboardingRoute) {
        return '/auth/login';
      }

      // Giriş yapmış ve auth sayfasındaysa → ana ekrana yönlendir
      if (isLoggedIn && isAuthRoute) {
        return userRole == 'driver' ? '/driver' : '/customer';
      }

      return null;
    },
    routes: [
      // Splash ekranı
      GoRoute(
        path: '/splash',
        builder: (context, state) => const SplashScreen(),
      ),

      GoRoute(
        path: '/onboarding',
        builder: (context, state) => const OnboardingScreen(),
      ),

      // Auth route'ları
      GoRoute(
        path: '/auth/login',
        builder: (context, state) => const LoginScreen(),
      ),
      GoRoute(
        path: '/auth/register',
        builder: (context, state) => const RegisterScreen(),
      ),

      // KVKK / gizlilik / kullanım — giriş gerekmez
      GoRoute(
        path: '/legal',
        builder: (context, state) {
          final t = int.tryParse(state.uri.queryParameters['tab'] ?? '') ?? 0;
          return LegalInformationScreen(initialTab: t);
        },
      ),

      // Müşteri ana ekranı
      GoRoute(
        path: '/customer',
        builder: (context, state) => const CustomerHomeScreen(),
      ),

      // Müşteri yolculuk geçmişi
      GoRoute(
        path: '/customer/history',
        builder: (context, state) => const RideHistoryScreen(),
      ),

      // Sürücü ana ekranı
      GoRoute(
        path: '/driver',
        builder: (context, state) => const DriverHomeScreen(),
      ),

      GoRoute(
        path: '/driver/wallet',
        builder: (context, state) => const DriverWalletScreen(),
      ),

      // Profil ekranı (rol bağımsız — hem müşteri hem sürücü kullanır)
      GoRoute(
        path: '/profile',
        builder: (context, state) => const ProfileScreen(),
      ),
      GoRoute(
        path: '/profile/edit',
        builder: (context, state) => const EditProfileScreen(),
      ),
      GoRoute(
        path: '/profile/notifications',
        builder: (context, state) => const NotificationSettingsScreen(),
      ),
      GoRoute(
        path: '/profile/language',
        builder: (context, state) => const LanguageSettingsScreen(),
      ),
    ],
  );
});
