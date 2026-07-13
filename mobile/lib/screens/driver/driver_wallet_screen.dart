import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/constants/app_constants.dart';
import '../../core/theme/app_theme.dart';
import '../../providers/providers.dart';

/// Sürücü T Coin bakiyesi; operasyon ile yükleme (WhatsApp / arama).
class DriverWalletScreen extends ConsumerStatefulWidget {
  const DriverWalletScreen({super.key});

  @override
  ConsumerState<DriverWalletScreen> createState() => _DriverWalletScreenState();
}

class _DriverWalletScreenState extends ConsumerState<DriverWalletScreen> {
  final _customAmountCtrl = TextEditingController();
  bool _refreshing = false;

  static const List<double> _presetAmounts = [50, 100, 200, 500];

  @override
  void initState() {
    super.initState();
    Future.microtask(_refresh);
  }

  @override
  void dispose() {
    _customAmountCtrl.dispose();
    super.dispose();
  }

  Future<void> _refresh() async {
    setState(() => _refreshing = true);
    await Future.wait([
      ref.read(currentUserProvider.notifier).refreshProfileFromApi(),
      ref.read(platformConfigProvider.notifier).refresh(),
    ]);
    if (mounted) setState(() => _refreshing = false);
  }

  String _digitsOnly(String s) {
    final buf = StringBuffer();
    for (final c in s.runes) {
      final ch = String.fromCharCode(c);
      if (ch == '+') {
        buf.write(ch);
      } else if (RegExp(r'[0-9]').hasMatch(ch)) {
        buf.write(ch);
      }
    }
    return buf.toString();
  }

  Future<void> _launchTopUpRequest(double amountTl) async {
    final phone = AppConstants.driverWalletSupportPhone.trim();
    final msg =
        'Merhaba, Taksim Gelsin sürücü hesabıma ${amountTl.toStringAsFixed(0)} T Coin yüklemek istiyorum.';

    if (phone.isEmpty) {
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('T Coin yükleme'),
          content: Text(
            '${amountTl.toStringAsFixed(0)} T Coin tutarında yükleme talebiniz için '
            'operasyon veya yönetiminizle iletişime geçin.\n\n'
            'Uygulama ayarlarında operasyon telefonu tanımlandığında buradan doğrudan arama yapılabilir.',
            style: TextStyle(color: AppTheme.textSecondary, height: 1.35),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Tamam')),
          ],
        ),
      );
      return;
    }

    final tel = _digitsOnly(phone);
    final waDigits = tel.startsWith('+')
        ? tel.substring(1)
        : (tel.startsWith('0') ? '90${tel.substring(1)}' : tel);

    if (!mounted) return;
    final choice = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                '${amountTl.toStringAsFixed(0)} T Coin yükleme',
                style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 8),
              Text(
                'Operasyon ekibi bakiye yüklemenize yardımcı olur.',
                style: TextStyle(color: AppTheme.textSecondary, fontSize: 13),
              ),
              const SizedBox(height: 16),
              FilledButton.icon(
                style: FilledButton.styleFrom(
                  backgroundColor: AppTheme.primaryColor,
                  foregroundColor: AppTheme.ink,
                  minimumSize: const Size.fromHeight(48),
                ),
                onPressed: () => Navigator.pop(ctx, 'call'),
                icon: const Icon(Icons.call_rounded),
                label: const Text('Operasyonu ara'),
              ),
              const SizedBox(height: 10),
              OutlinedButton.icon(
                onPressed: () => Navigator.pop(ctx, 'wa'),
                icon: const Icon(Icons.chat_rounded),
                label: const Text('WhatsApp ile yaz'),
              ),
            ],
          ),
        ),
      ),
    );

    if (choice == 'call') {
      final uri = Uri.parse('tel:$tel');
      if (await canLaunchUrl(uri)) {
        await launchUrl(uri);
      }
      return;
    }
    if (choice == 'wa') {
      final encoded = Uri.encodeComponent(msg);
      final uri = Uri.parse('https://wa.me/$waDigits?text=$encoded');
      if (await canLaunchUrl(uri)) {
        await launchUrl(uri, mode: LaunchMode.externalApplication);
      }
    }
  }

  Future<void> _pickPreset(double amount) async {
    await _launchTopUpRequest(amount);
  }

  Future<void> _pickCustom() async {
    _customAmountCtrl.clear();
    if (!mounted) return;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Tutar girin'),
        content: TextField(
          controller: _customAmountCtrl,
          keyboardType: TextInputType.number,
          autofocus: true,
          decoration: const InputDecoration(
            hintText: 'Örn. 250',
            suffixText: 'T Coin',
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('İptal')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Devam'),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    final raw = _customAmountCtrl.text.trim().replaceAll(',', '.');
    final v = double.tryParse(raw);
    if (v == null || v <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Geçerli bir tutar girin.')),
      );
      return;
    }
    await _launchTopUpRequest(v);
  }



  @override
  Widget build(BuildContext context) {
    final user = ref.watch(currentUserProvider);
    final balance = user?.balanceTcoin;

    final nf = NumberFormat.decimalPattern('tr_TR');

    return Scaffold(
      backgroundColor: AppTheme.backgroundColor,
      appBar: AppBar(
        title: const Text('T Coin cüzdanım'),
        backgroundColor: AppTheme.primaryColor,
        foregroundColor: AppTheme.secondaryColor,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded),
          onPressed: () => context.pop(),
        ),
      ),
      body: RefreshIndicator(
        color: AppTheme.primaryColor,
        onRefresh: _refresh,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(20),
          children: [
            Container(
              padding: const EdgeInsets.all(22),
              decoration: BoxDecoration(
                gradient: AppTheme.inkGradient,
                borderRadius: BorderRadius.circular(AppTheme.radiusLg),
                boxShadow: [
                  BoxShadow(
                    color: AppTheme.ink.withOpacity(0.2),
                    blurRadius: 20,
                    offset: const Offset(0, 8),
                  ),
                ],
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: AppTheme.primaryColor.withOpacity(0.18),
                          borderRadius: BorderRadius.circular(14),
                        ),
                        child: Icon(Icons.currency_exchange_rounded,
                            color: AppTheme.primaryColor, size: 28),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          'Mevcut bakiye',
                          style: TextStyle(
                            color: Colors.white.withOpacity(0.85),
                            fontWeight: FontWeight.w600,
                            fontSize: 14,
                          ),
                        ),
                      ),
                      if (_refreshing)
                        const SizedBox(
                          width: 22,
                          height: 22,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: AppTheme.primaryColor,
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: 18),
                  Text(
                    balance != null ? '${nf.format(balance)} T' : '—',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 36,
                      fontWeight: FontWeight.w800,
                      letterSpacing: -0.5,
                    ),
                  ),
                  const SizedBox(height: 10),
                  Text(
                    '1 T Coin ≈ 1 TL birimiyle talep kabul ücreti için kullanılır.',
                    style: TextStyle(
                      color: Colors.white.withOpacity(0.72),
                      fontSize: 13,
                      height: 1.35,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Kabul ücreti: tahmini yolculuk ücretinin %'
                    '${ref.watch(platformConfigProvider).rideAcceptFeePercent.toStringAsFixed(0)}’si.',
                    style: TextStyle(
                      color: Colors.white.withOpacity(0.58),
                      fontSize: 12,
                      height: 1.35,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),
            const Text(
              'T Coin yükle',
              style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 6),
            Text(
              'Tutarı seçin, ardından operasyonu arayın veya WhatsApp ile yazın.',
              style: TextStyle(color: AppTheme.textSecondary, fontSize: 13),
            ),
            const SizedBox(height: 14),
            Wrap(
              spacing: 10,
              runSpacing: 10,
              children: [
                for (final a in _presetAmounts)
                  ActionChip(
                    label: Text('${a.toStringAsFixed(0)} T'),
                    onPressed: () => _pickPreset(a),
                    backgroundColor: AppTheme.primaryColor.withOpacity(0.14),
                    side: BorderSide(color: AppTheme.primaryColor.withOpacity(0.4)),
                  ),
                ActionChip(
                  label: const Text('Diğer tutar'),
                  avatar: const Icon(Icons.edit_rounded, size: 18),
                  onPressed: _pickCustom,
                  backgroundColor: AppTheme.primaryColor.withOpacity(0.08),
                  side: BorderSide(color: AppTheme.primaryColor.withOpacity(0.28)),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

