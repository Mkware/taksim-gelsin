import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/animated_entry.dart';
import '../../core/widgets/primary_gradient_button.dart';
import '../../models/user_model.dart';
import '../../providers/providers.dart';

/// Sürücü kayıt ekranı — Kişisel bilgiler + araç bilgileri
class DriverRegisterScreen extends ConsumerStatefulWidget {
  const DriverRegisterScreen({super.key});

  @override
  ConsumerState<DriverRegisterScreen> createState() => _DriverRegisterScreenState();
}

class _DriverRegisterScreenState extends ConsumerState<DriverRegisterScreen> {
  final _formKey = GlobalKey<FormState>();
  final _phoneController = TextEditingController(text: '+90');
  final _nameController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();
  final _plateController = TextEditingController();
  final _modelController = TextEditingController();
  final _colorController = TextEditingController();
  bool _isLoading = false;
  bool _obscurePassword = true;
  String? _errorMessage;
  int _currentStep = 0; // 0: kişisel bilgiler, 1: araç bilgileri

  @override
  void dispose() {
    _phoneController.dispose();
    _nameController.dispose();
    _passwordController.dispose();
    _confirmPasswordController.dispose();
    _plateController.dispose();
    _modelController.dispose();
    _colorController.dispose();
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
      final response = await api.registerDriver(
        phone: _phoneController.text.trim(),
        fullName: _nameController.text.trim(),
        password: _passwordController.text,
        vehiclePlate: _plateController.text.trim().toUpperCase(),
        vehicleModel: _modelController.text.trim(),
        vehicleColor: _colorController.text.trim(),
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
        context.go('/driver');
      } else {
        setState(() {
          _errorMessage = response.data['error'] ?? 'Kayıt başarısız.';
        });
      }
    } catch (e) {
      setState(() {
        _errorMessage = _extractError(e);
      });
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

  void _nextStep() {
    // İlk adımdaki alanları doğrula
    if (_nameController.text.trim().isEmpty ||
        _phoneController.text.trim().length < 13 ||
        _passwordController.text.length < 6 ||
        _passwordController.text != _confirmPasswordController.text) {
      if (!_formKey.currentState!.validate()) return;
    }
    setState(() => _currentStep = 1);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.backgroundColor,
      appBar: AppBar(
        title: const Text('Sürücü Kaydı'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded),
          onPressed: () {
            if (_currentStep == 1) {
              setState(() => _currentStep = 0);
            } else {
              context.pop();
            }
          },
        ),
      ),
      body: SafeArea(
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
                    'Yola çıkalım',
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
                    'Sürücü hesabını iki adımda oluştur.',
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: AppTheme.textSecondary,
                        ),
                  ),
                ),
                const SizedBox(height: 20),

                // Adım göstergesi
                Row(
                  children: [
                    _buildStepIndicator(0, 'Kişisel Bilgiler', Icons.person),
                    Expanded(child: Container(height: 2, color: _currentStep >= 1 ? AppTheme.primaryColor : AppTheme.dividerColor)),
                    _buildStepIndicator(1, 'Araç Bilgileri', Icons.directions_car),
                  ],
                ),
                const SizedBox(height: 32),

                // Hata mesajı
                if (_errorMessage != null)
                  Container(
                    padding: const EdgeInsets.all(12),
                    margin: const EdgeInsets.only(bottom: 16),
                    decoration: BoxDecoration(
                      color: AppTheme.errorColor.withOpacity(0.1),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: AppTheme.errorColor.withOpacity(0.3)),
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.error_outline, color: AppTheme.errorColor, size: 20),
                        const SizedBox(width: 8),
                        Expanded(child: Text(_errorMessage!, style: const TextStyle(color: AppTheme.errorColor, fontSize: 13))),
                      ],
                    ),
                  ),

                // ADIM 1: Kişisel Bilgiler
                if (_currentStep == 0) ...[
                  const Text(
                    'Kişisel Bilgileriniz',
                    style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: AppTheme.textPrimary),
                  ),
                  const SizedBox(height: 24),

                  TextFormField(
                    controller: _nameController,
                    textCapitalization: TextCapitalization.words,
                    decoration: const InputDecoration(
                      labelText: 'Ad Soyad',
                      hintText: 'Mehmet Kaya',
                      prefixIcon: Icon(Icons.person),
                    ),
                    validator: (v) {
                      if (v == null || v.trim().isEmpty) return 'Ad soyad gerekli.';
                      if (v.trim().length < 2) return 'En az 2 karakter.';
                      return null;
                    },
                  ),
                  const SizedBox(height: 16),

                  TextFormField(
                    controller: _phoneController,
                    keyboardType: TextInputType.phone,
                    decoration: const InputDecoration(
                      labelText: 'Telefon Numarası',
                      hintText: '+905551112233',
                      prefixIcon: Icon(Icons.phone),
                    ),
                    validator: (v) {
                      if (v == null || v.isEmpty) return 'Telefon gerekli.';
                      if (!RegExp(r'^\+90[0-9]{10}$').hasMatch(v)) return 'Geçerli numara girin.';
                      return null;
                    },
                  ),
                  const SizedBox(height: 16),

                  TextFormField(
                    controller: _passwordController,
                    obscureText: _obscurePassword,
                    decoration: InputDecoration(
                      labelText: 'Şifre',
                      prefixIcon: const Icon(Icons.lock),
                      suffixIcon: IconButton(
                        icon: Icon(_obscurePassword ? Icons.visibility_off : Icons.visibility),
                        onPressed: () => setState(() => _obscurePassword = !_obscurePassword),
                      ),
                    ),
                    validator: (v) {
                      if (v == null || v.isEmpty) return 'Şifre gerekli.';
                      if (v.length < 6) return 'En az 6 karakter.';
                      return null;
                    },
                  ),
                  const SizedBox(height: 16),

                  TextFormField(
                    controller: _confirmPasswordController,
                    obscureText: _obscurePassword,
                    decoration: const InputDecoration(
                      labelText: 'Şifre Tekrar',
                      prefixIcon: Icon(Icons.lock_outline),
                    ),
                    validator: (v) {
                      if (v != _passwordController.text) return 'Şifreler eşleşmiyor.';
                      return null;
                    },
                  ),
                  const SizedBox(height: 32),

                  PrimaryGradientButton(
                    label: 'Devam Et',
                    icon: Icons.arrow_forward_rounded,
                    onPressed: _nextStep,
                  ),
                ],

                // ADIM 2: Araç Bilgileri
                if (_currentStep == 1) ...[
                  const Text(
                    'Araç Bilgileriniz',
                    style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: AppTheme.textPrimary),
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'Yolcuların sizi tanıyabilmesi için araç bilgilerinizi girin.',
                    style: TextStyle(fontSize: 14, color: AppTheme.textSecondary),
                  ),
                  const SizedBox(height: 24),

                  TextFormField(
                    controller: _plateController,
                    textCapitalization: TextCapitalization.characters,
                    decoration: const InputDecoration(
                      labelText: 'Araç Plakası',
                      hintText: '71 ABC 123',
                      prefixIcon: Icon(Icons.credit_card),
                    ),
                    validator: (v) {
                      if (v == null || v.trim().isEmpty) return 'Plaka gerekli.';
                      if (v.trim().length < 5) return 'Geçerli bir plaka girin.';
                      return null;
                    },
                  ),
                  const SizedBox(height: 16),

                  TextFormField(
                    controller: _modelController,
                    textCapitalization: TextCapitalization.words,
                    decoration: const InputDecoration(
                      labelText: 'Araç Modeli',
                      hintText: 'Fiat Egea',
                      prefixIcon: Icon(Icons.directions_car),
                    ),
                    validator: (v) {
                      if (v == null || v.trim().isEmpty) return 'Araç modeli gerekli.';
                      return null;
                    },
                  ),
                  const SizedBox(height: 16),

                  TextFormField(
                    controller: _colorController,
                    textCapitalization: TextCapitalization.words,
                    decoration: const InputDecoration(
                      labelText: 'Araç Rengi',
                      hintText: 'Sarı',
                      prefixIcon: Icon(Icons.palette),
                    ),
                    validator: (v) {
                      if (v == null || v.trim().isEmpty) return 'Araç rengi gerekli.';
                      return null;
                    },
                  ),
                  const SizedBox(height: 32),

                  PrimaryGradientButton(
                    label: 'Sürücü Olarak Kayıt Ol',
                    icon: Icons.check_circle_rounded,
                    loading: _isLoading,
                    onPressed: _isLoading ? null : _register,
                  ),
                ],

                const SizedBox(height: 40),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildStepIndicator(int step, String label, IconData icon) {
    final isActive = _currentStep >= step;
    return Column(
      children: [
        Container(
          width: 44,
          height: 44,
          decoration: BoxDecoration(
            color: isActive ? AppTheme.primaryColor : AppTheme.dividerColor,
            shape: BoxShape.circle,
          ),
          child: Icon(icon, color: isActive ? AppTheme.secondaryColor : AppTheme.textSecondary, size: 22),
        ),
        const SizedBox(height: 4),
        Text(
          label,
          style: TextStyle(
            fontSize: 11,
            fontWeight: isActive ? FontWeight.w600 : FontWeight.normal,
            color: isActive ? AppTheme.textPrimary : AppTheme.textSecondary,
          ),
        ),
      ],
    );
  }
}
