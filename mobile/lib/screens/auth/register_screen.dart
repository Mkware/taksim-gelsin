import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:google_fonts/google_fonts.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/animated_entry.dart';
import '../../core/widgets/primary_gradient_button.dart';
import '../../models/user_model.dart';
import '../../providers/providers.dart';

/// Müşteri kayıt ekranı.
class RegisterScreen extends ConsumerStatefulWidget {
  const RegisterScreen({super.key});

  @override
  ConsumerState<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends ConsumerState<RegisterScreen> {
  final _formKey = GlobalKey<FormState>();
  final _phoneController = TextEditingController(text: '+90');
  final _nameController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();
  bool _isLoading = false;
  bool _obscurePassword = true;
  String? _errorMessage;

  @override
  void dispose() {
    _phoneController.dispose();
    _nameController.dispose();
    _passwordController.dispose();
    _confirmPasswordController.dispose();
    super.dispose();
  }

  Future<void> _register() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final api = ref.read(apiServiceProvider);
      final response = await api.register(
        phone: _phoneController.text.trim(),
        fullName: _nameController.text.trim(),
        password: _passwordController.text,
      );

      if (response.statusCode == 201 && response.data['success'] == true) {
        final data = response.data['data'];
        final user = UserModel.fromJson(data['user']);
        final tokens = data['tokens'];

        await ref.read(currentUserProvider.notifier).setUser(
              user,
              tokens['access_token'],
              tokens['refresh_token'],
            );

        if (!mounted) return;
        context.go('/customer');
      } else {
        setState(() {
          _errorMessage = response.data['error'] ?? 'Kayıt başarısız.';
        });
      }
    } catch (e) {
      setState(() => _errorMessage = _extractError(e));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  String _extractError(dynamic e) {
    try {
      final dynamic dioError = e;
      if (dioError.response?.data != null) {
        return dioError.response.data['error'] ?? 'Bir hata oluştu.';
      }
    } catch (_) {}
    return 'Bağlantı hatası. Lütfen tekrar deneyin.';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.backgroundColor,
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(LucideIcons.chevronLeft),
          onPressed: () => context.pop(),
        ),
      ),
      body: Stack(
        children: [
          Positioned(
            top: -120,
            left: -100,
            child: _orb(240, AppTheme.primaryColor.withOpacity(0.18)),
          ),
          SafeArea(
            child: SingleChildScrollView(
              padding: const EdgeInsets.symmetric(horizontal: 24),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const SizedBox(height: 16),
                    AnimatedEntry(
                      order: 0,
                      child: Text(
                        'Hesabını oluştur',
                        style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                              fontWeight: FontWeight.w800,
                              letterSpacing: -0.4,
                            ),
                      ),
                    ),
                    const SizedBox(height: 6),
                    AnimatedEntry(
                      order: 1,
                      child: Text(
                        'Birkaç adımda taksi çağırmaya başla.',
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                              color: AppTheme.textSecondary,
                            ),
                      ),
                    ),
                    const SizedBox(height: 28),

                    if (_errorMessage != null)
                      AnimatedEntry(
                        order: 2,
                        child: Container(
                          padding: const EdgeInsets.all(14),
                          margin: const EdgeInsets.only(bottom: 16),
                          decoration: BoxDecoration(
                            color: AppTheme.errorColor.withOpacity(0.08),
                            borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                            border: Border.all(color: AppTheme.errorColor.withOpacity(0.3)),
                          ),
                          child: Row(
                            children: [
                              const Icon(LucideIcons.circleAlert,
                                  color: AppTheme.errorColor, size: 20),
                              const SizedBox(width: 10),
                              Expanded(
                                child: Text(_errorMessage!,
                                    style: const TextStyle(
                                        color: AppTheme.errorColor, fontSize: 13)),
                              ),
                            ],
                          ),
                        ),
                      ),

                    AnimatedEntry(
                      order: 3,
                      child: TextFormField(
                        controller: _nameController,
                        textCapitalization: TextCapitalization.words,
                        decoration: const InputDecoration(
                          labelText: 'Ad Soyad',
                          hintText: 'Ahmet Yılmaz',
                          prefixIcon: Icon(LucideIcons.user),
                        ),
                        validator: (value) {
                          if (value == null || value.trim().isEmpty) return 'Ad soyad gerekli.';
                          if (value.trim().length < 2) return 'Ad soyad en az 2 karakter olmalı.';
                          return null;
                        },
                      ),
                    ),
                    const SizedBox(height: 14),

                    AnimatedEntry(
                      order: 4,
                      child: TextFormField(
                        controller: _phoneController,
                        keyboardType: TextInputType.phone,
                        decoration: const InputDecoration(
                          labelText: 'Telefon Numarası',
                          hintText: '+905551112233',
                          prefixIcon: Icon(LucideIcons.smartphone),
                        ),
                        validator: (value) {
                          if (value == null || value.isEmpty) return 'Telefon numarası gerekli.';
                          final regex = RegExp(r'^\+90[0-9]{10}$');
                          if (!regex.hasMatch(value)) {
                            return 'Geçerli numara girin. Örn: +905551112233';
                          }
                          return null;
                        },
                      ),
                    ),
                    const SizedBox(height: 14),

                    AnimatedEntry(
                      order: 5,
                      child: TextFormField(
                        controller: _passwordController,
                        obscureText: _obscurePassword,
                        decoration: InputDecoration(
                          labelText: 'Şifre',
                          prefixIcon: const Icon(LucideIcons.lock),
                          suffixIcon: IconButton(
                            icon: Icon(_obscurePassword
                                ? LucideIcons.eyeOff
                                : LucideIcons.eye),
                            onPressed: () => setState(() => _obscurePassword = !_obscurePassword),
                          ),
                        ),
                        validator: (value) {
                          if (value == null || value.isEmpty) return 'Şifre gerekli.';
                          if (value.length < 6) return 'Şifre en az 6 karakter olmalı.';
                          return null;
                        },
                      ),
                    ),
                    const SizedBox(height: 14),

                    AnimatedEntry(
                      order: 6,
                      child: TextFormField(
                        controller: _confirmPasswordController,
                        obscureText: _obscurePassword,
                        decoration: const InputDecoration(
                          labelText: 'Şifre Tekrar',
                          prefixIcon: Icon(LucideIcons.shieldCheck),
                        ),
                        validator: (value) {
                          if (value != _passwordController.text) return 'Şifreler eşleşmiyor.';
                          return null;
                        },
                      ),
                    ),
                    const SizedBox(height: 20),

                    AnimatedEntry(
                      order: 7,
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 4),
                        child: Text.rich(
                          TextSpan(
                            style: GoogleFonts.inter(
                              fontSize: 12,
                              height: 1.45,
                              color: AppTheme.textSecondary,
                            ),
                            children: [
                              const TextSpan(text: 'Kayıt olarak '),
                              WidgetSpan(
                                alignment: PlaceholderAlignment.middle,
                                child: TextButton(
                                  onPressed: () => context.push('/legal'),
                                  style: TextButton.styleFrom(
                                    padding: const EdgeInsets.symmetric(horizontal: 4),
                                    minimumSize: Size.zero,
                                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                                  ),
                                  child: Text(
                                    'yasal metinleri',
                                    style: GoogleFonts.inter(
                                      fontSize: 12,
                                      fontWeight: FontWeight.w800,
                                      color: AppTheme.primaryDark,
                                      decoration: TextDecoration.underline,
                                    ),
                                  ),
                                ),
                              ),
                              TextSpan(
                                text:
                                    ' okuduğunuzu ve veri işlemenin hizmet için gerekli olduğunu kabul etmiş olursunuz.',
                                style: GoogleFonts.inter(
                                  fontSize: 12,
                                  height: 1.45,
                                  color: AppTheme.textSecondary,
                                ),
                              ),
                            ],
                          ),
                          textAlign: TextAlign.center,
                        ),
                      ),
                    ),
                    const SizedBox(height: 22),

                    AnimatedEntry(
                      order: 8,
                      child: PrimaryGradientButton(
                        label: 'Hesabı Oluştur',
                        icon: LucideIcons.circleCheck,
                        loading: _isLoading,
                        onPressed: _isLoading ? null : _register,
                      ),
                    ),
                    const SizedBox(height: 18),

                    AnimatedEntry(
                      order: 9,
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          const Text('Zaten hesabın var mı? ',
                              style: TextStyle(color: AppTheme.textSecondary)),
                          GestureDetector(
                            onTap: () => context.pop(),
                            child: const Text(
                              'Giriş Yap',
                              style: TextStyle(
                                color: AppTheme.ink,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 40),
                  ],
                ),
              ),
            ),
          ),
        ],
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
          gradient: RadialGradient(colors: [color, color.withOpacity(0)]),
        ),
      ),
    );
  }
}
