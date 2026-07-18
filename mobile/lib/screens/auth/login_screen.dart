import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:google_fonts/google_fonts.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/brand_logo.dart';
import '../../core/widgets/animated_entry.dart';
import '../../core/widgets/primary_gradient_button.dart';
import '../../models/user_model.dart';
import '../../providers/providers.dart';

class _CountryOption {
  const _CountryOption({
    required this.name,
    required this.dialCode,
    required this.flag,
  });
  final String name;
  final String dialCode;
  final String flag;
}

/// Giriş ekranı — bayraklı ülke kodu, telefon ve şifre.
class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  static const _countries = <_CountryOption>[
    _CountryOption(name: 'Türkiye', dialCode: '+90', flag: '🇹🇷'),
  ];

  final _passwordController = TextEditingController();
  final _phoneController = TextEditingController();

  _CountryOption _selectedCountry = _countries.first;

  bool _isLoading = false;
  bool _obscurePassword = true;
  String? _errorMessage;

  @override
  void dispose() {
    _passwordController.dispose();
    _phoneController.dispose();
    super.dispose();
  }

  String get _nationalNumber => _phoneController.text;

  String get _e164Phone => '${_selectedCountry.dialCode}$_nationalNumber';

  String? _validatePhoneField() {
    final raw = _nationalNumber;
    if (raw.length != 10) {
      return '10 haneli cep numaranızı girin.';
    }
    if (!RegExp(r'^5[0-9]{9}$').hasMatch(raw)) {
      return 'Geçerli bir Türkiye cep numarası girin (5 ile başlar).';
    }
    return null;
  }

  Future<void> _pickCountry() async {
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppTheme.surfaceColor,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppTheme.radiusLg)),
      ),
      builder: (ctx) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Center(
                  child: Container(
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(
                      color: AppTheme.border,
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                Text(
                  'Ülke / bölge',
                  style: GoogleFonts.inter(
                    fontSize: 18,
                    fontWeight: FontWeight.w800,
                    color: AppTheme.ink,
                  ),
                ),
                const SizedBox(height: 12),
                ..._countries.map((c) {
                  final selected = c.dialCode == _selectedCountry.dialCode;
                  return ListTile(
                    leading: Text(c.flag, style: const TextStyle(fontSize: 26)),
                    title: Text(c.name, style: GoogleFonts.inter(fontWeight: FontWeight.w600)),
                    trailing: selected
                        ? const Icon(LucideIcons.circleCheck, color: AppTheme.success)
                        : Icon(
                            LucideIcons.circle,
                            color: AppTheme.textMuted.withValues(alpha: 0.5),
                          ),
                    onTap: () {
                      setState(() => _selectedCountry = c);
                      Navigator.pop(ctx);
                    },
                  );
                }),
              ],
            ),
          ),
        );
      },
    );
  }

  Future<void> _login() async {
    final phoneErr = _validatePhoneField();
    if (phoneErr != null) {
      setState(() => _errorMessage = phoneErr);
      return;
    }
    if (!_formKey.currentState!.validate()) return;

    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final api = ref.read(apiServiceProvider);
      final response = await api.login(
        phone: _e164Phone,
        password: _passwordController.text,
      );

      if (response.statusCode == 200 && response.data['success'] == true) {
        final data = response.data['data'];
        final user = UserModel.fromJson(data['user']);
        final tokens = data['tokens'];

        await ref.read(currentUserProvider.notifier).setUser(
              user,
              tokens['access_token'],
              tokens['refresh_token'],
            );

        if (!mounted) return;
        context.go(user.isDriver ? '/driver' : '/customer');
      } else {
        setState(() {
          _errorMessage = response.data['error'] ?? 'Giriş başarısız.';
        });
      }
    } catch (e) {
      setState(() => _errorMessage = _extractError(e));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  String _extractError(dynamic e) {
    if (e is Exception) {
      try {
        final dynamic dioError = e;
        if (dioError.response?.data != null) {
          return dioError.response.data['error'] ?? 'Bir hata oluştu.';
        }
      } catch (_) {}
    }
    return 'Bağlantı hatası. Lütfen tekrar deneyin.';
  }

  @override
  Widget build(BuildContext context) {
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.dark.copyWith(statusBarColor: Colors.transparent),
      child: Scaffold(
        backgroundColor: AppTheme.backgroundColor,
        body: Stack(
          children: [
            Positioned(
              top: -120,
              right: -100,
              child: _orb(260, AppTheme.primaryColor.withValues(alpha: 0.18)),
            ),
            Positioned(
              top: 220,
              left: -80,
              child: _orb(180, AppTheme.info.withValues(alpha: 0.1)),
            ),
            SafeArea(
              child: SingleChildScrollView(
                padding: const EdgeInsets.symmetric(horizontal: 22),
                keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                child: Form(
                  key: _formKey,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                    const SizedBox(height: 28),
                    AnimatedEntry(
                      order: 0,
                      child: const Center(
                        child: Hero(
                          tag: AppTheme.brandHeroTag,
                          child: Material(
                            type: MaterialType.transparency,
                            child: BrandLogo(
                              width: 130,
                              height: 130,
                              borderRadius: 24,
                            ),
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 20),
                    AnimatedEntry(
                      order: 1,
                      child: Text(
                        'Tekrar hoş geldin',
                        textAlign: TextAlign.center,
                        style: GoogleFonts.inter(
                          fontSize: 26,
                          fontWeight: FontWeight.w800,
                          color: AppTheme.ink,
                          letterSpacing: -0.6,
                        ),
                      ),
                    ),
                    const SizedBox(height: 8),
                    AnimatedEntry(
                      order: 2,
                      child: Text(
                        'Kırıkkale’de saniyeler içinde taksi çağır.',
                        textAlign: TextAlign.center,
                        style: GoogleFonts.inter(
                          fontSize: 15,
                          fontWeight: FontWeight.w500,
                          color: AppTheme.textSecondary,
                          height: 1.35,
                        ),
                      ),
                    ),
                    const SizedBox(height: 32),

                    if (_errorMessage != null)
                      AnimatedEntry(
                        order: 3,
                        child: Container(
                          padding: const EdgeInsets.all(14),
                          margin: const EdgeInsets.only(bottom: 16),
                          decoration: BoxDecoration(
                            color: AppTheme.errorColor.withValues(alpha: 0.08),
                            borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                            border: Border.all(
                              color: AppTheme.errorColor.withValues(alpha: 0.28),
                            ),
                          ),
                          child: Row(
                            children: [
                              const Icon(LucideIcons.circleAlert,
                                  color: AppTheme.errorColor, size: 20),
                              const SizedBox(width: 10),
                              Expanded(
                                child: Text(
                                  _errorMessage!,
                                  style: GoogleFonts.inter(
                                    color: AppTheme.errorColor,
                                    fontSize: 13,
                                    fontWeight: FontWeight.w500,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),

                    AnimatedEntry(
                      order: 4,
                      child: Text(
                        'Telefon',
                        style: GoogleFonts.inter(
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                          color: AppTheme.textSecondary,
                        ),
                      ),
                    ),
                    const SizedBox(height: 8),
                    AnimatedEntry(
                      order: 5,
                      child: IntrinsicHeight(
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Material(
                              color: Colors.transparent,
                              child: InkWell(
                                onTap: _pickCountry,
                                borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                                child: Ink(
                                  decoration: BoxDecoration(
                                    color: AppTheme.surfaceColor,
                                    borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                                    border: Border.all(color: AppTheme.border),
                                    boxShadow: AppTheme.softShadow(opacity: 0.05, blur: 12),
                                  ),
                                  child: Padding(
                                    padding: const EdgeInsets.symmetric(horizontal: 12),
                                    child: Center(
                                      child: Row(
                                        mainAxisSize: MainAxisSize.min,
                                        children: [
                                          Text(
                                            _selectedCountry.flag,
                                            style: const TextStyle(fontSize: 22),
                                          ),
                                          const SizedBox(width: 8),
                                          Text(
                                            _selectedCountry.dialCode,
                                            style: GoogleFonts.inter(
                                              fontWeight: FontWeight.w700,
                                              fontSize: 16,
                                              color: AppTheme.ink,
                                            ),
                                          ),
                                          const SizedBox(width: 2),
                                          const Icon(
                                            LucideIcons.chevronDown,
                                            color: AppTheme.textMuted,
                                            size: 22,
                                          ),
                                        ],
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: TextFormField(
                                key: const Key('login_phone_field'),
                                controller: _phoneController,
                                keyboardType: TextInputType.phone,
                                style: GoogleFonts.inter(
                                  fontSize: 16,
                                  fontWeight: FontWeight.w500,
                                  color: AppTheme.ink,
                                ),
                                inputFormatters: [
                                  FilteringTextInputFormatter.digitsOnly,
                                  LengthLimitingTextInputFormatter(10),
                                ],
                                decoration: InputDecoration(
                                  hintText: '5XX XXX XX XX',
                                  hintStyle: GoogleFonts.inter(
                                    color: AppTheme.textMuted.withValues(alpha: 0.45),
                                    fontWeight: FontWeight.w500,
                                    fontSize: 16,
                                  ),
                                  filled: true,
                                  fillColor: AppTheme.surfaceColor,
                                  contentPadding: const EdgeInsets.symmetric(
                                    horizontal: 18,
                                    vertical: 18,
                                  ),
                                  border: OutlineInputBorder(
                                    borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                                    borderSide: const BorderSide(color: AppTheme.border),
                                  ),
                                  enabledBorder: OutlineInputBorder(
                                    borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                                    borderSide: const BorderSide(color: AppTheme.border),
                                  ),
                                  focusedBorder: OutlineInputBorder(
                                    borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                                    borderSide: const BorderSide(
                                      color: AppTheme.primaryColor,
                                      width: 2,
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: 18),

                    AnimatedEntry(
                      order: 6,
                      child: TextFormField(
                        key: const Key('login_password_field'),
                        controller: _passwordController,
                        obscureText: _obscurePassword,
                        style: GoogleFonts.inter(
                          fontWeight: FontWeight.w500,
                          color: AppTheme.ink,
                        ),
                        decoration: InputDecoration(
                          labelText: 'Şifre',
                          labelStyle: GoogleFonts.inter(color: AppTheme.textSecondary),
                          filled: true,
                          fillColor: AppTheme.surfaceColor,
                          contentPadding: const EdgeInsets.symmetric(
                            horizontal: 18,
                            vertical: 18,
                          ),
                          prefixIcon:
                              const Icon(LucideIcons.lock, color: AppTheme.textSecondary),
                          suffixIcon: IconButton(
                            icon: AnimatedSwitcher(
                              duration: const Duration(milliseconds: 180),
                              child: Icon(
                                _obscurePassword
                                    ? LucideIcons.eyeOff
                                    : LucideIcons.eye,
                                key: ValueKey(_obscurePassword),
                                color: AppTheme.textSecondary,
                              ),
                            ),
                            onPressed: () =>
                                setState(() => _obscurePassword = !_obscurePassword),
                          ),
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                            borderSide: const BorderSide(color: AppTheme.border),
                          ),
                          enabledBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                            borderSide: const BorderSide(color: AppTheme.border),
                          ),
                          focusedBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                            borderSide: const BorderSide(
                              color: AppTheme.primaryColor,
                              width: 2,
                            ),
                          ),
                        ),
                        validator: (value) {
                          if (value == null || value.isEmpty) return 'Şifre gerekli.';
                          if (value.length < 6) return 'Şifre en az 6 karakter olmalı.';
                          return null;
                        },
                      ),
                    ),
                    const SizedBox(height: 24),

                    AnimatedEntry(
                      order: 7,
                      child: PrimaryGradientButton(
                        label: 'Giriş Yap',
                        icon: LucideIcons.logIn,
                        loading: _isLoading,
                        height: 56,
                        variant: PrimaryGradientButtonVariant.brandSolid,
                        onPressed: _isLoading ? null : _login,
                      ),
                    ),
                    const SizedBox(height: 28),

                    AnimatedEntry(
                      order: 8,
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Text(
                            'Hesabınız yok mu? ',
                            style: GoogleFonts.inter(color: AppTheme.textSecondary),
                          ),
                          GestureDetector(
                            onTap: () => context.push('/auth/register'),
                            child: Text(
                              'Kayıt Olun',
                              style: GoogleFonts.inter(
                                color: AppTheme.primaryDark,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 20),
                    AnimatedEntry(
                      order: 9,
                      child: Center(
                        child: TextButton(
                          onPressed: () => context.push('/legal'),
                          child: Text(
                            'KVKK, gizlilik ve kullanım koşulları',
                            textAlign: TextAlign.center,
                            style: GoogleFonts.inter(
                              fontSize: 12.5,
                              fontWeight: FontWeight.w600,
                              color: AppTheme.textSecondary,
                              decoration: TextDecoration.underline,
                              decorationColor: AppTheme.textSecondary.withValues(alpha: 0.45),
                            ),
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 20),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _orb(double size, Color color) {
    return IgnorePointer(
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          gradient: RadialGradient(
            colors: [color, color.withValues(alpha: 0)],
          ),
        ),
      ),
    );
  }
}
