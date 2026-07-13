import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import '../../core/theme/app_theme.dart';
import '../../providers/providers.dart';

/// Bildirim tercihleri — yerel kayıt (sunucu push henüz yoksa bile uygulama içi davranış için).
class NotificationSettingsScreen extends ConsumerStatefulWidget {
  const NotificationSettingsScreen({super.key});

  @override
  ConsumerState<NotificationSettingsScreen> createState() =>
      _NotificationSettingsScreenState();
}

class _NotificationSettingsScreenState extends ConsumerState<NotificationSettingsScreen> {
  bool _rideUpdates = true;
  bool _sound = true;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final storage = ref.read(storageServiceProvider);
    await storage.init();
    final p = await storage.getNotificationPrefs();
    if (mounted) {
      setState(() {
        _rideUpdates = p['ride_updates'] == true;
        _sound = p['sound'] == true;
        _loading = false;
      });
    }
  }

  Future<void> _save() async {
    final storage = ref.read(storageServiceProvider);
    await storage.setNotificationPrefs({
      'ride_updates': _rideUpdates,
      'sound': _sound,
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.backgroundColor,
      appBar: AppBar(
        title: Text('Bildirimler', style: GoogleFonts.inter(fontWeight: FontWeight.w700)),
        backgroundColor: AppTheme.surfaceColor,
        foregroundColor: AppTheme.ink,
        elevation: 0,
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(20),
              children: [
                Text(
                  'Yolculuk ve uygulama bildirimleri için tercihlerin cihazında saklanır.',
                  style: GoogleFonts.inter(
                    color: AppTheme.textSecondary,
                    fontSize: 14,
                    height: 1.35,
                  ),
                ),
                const SizedBox(height: 20),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(
                    'Yolculuk güncellemeleri',
                    style: GoogleFonts.inter(fontWeight: FontWeight.w700),
                  ),
                  subtitle: Text(
                    'Sürücü ataması, varış ve durum değişiklikleri',
                    style: GoogleFonts.inter(fontSize: 12, color: AppTheme.textSecondary),
                  ),
                  value: _rideUpdates,
                  activeThumbColor: AppTheme.ink,
                  activeTrackColor: AppTheme.primaryColor,
                  onChanged: (v) {
                    setState(() => _rideUpdates = v);
                    _save();
                  },
                ),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(
                    'Ses ve titreşim',
                    style: GoogleFonts.inter(fontWeight: FontWeight.w700),
                  ),
                  subtitle: Text(
                    'Eşleşme ve önemli olaylarda sesli uyarı',
                    style: GoogleFonts.inter(fontSize: 12, color: AppTheme.textSecondary),
                  ),
                  value: _sound,
                  activeThumbColor: AppTheme.ink,
                  activeTrackColor: AppTheme.primaryColor,
                  onChanged: (v) {
                    setState(() => _sound = v);
                    _save();
                  },
                ),
              ],
            ),
    );
  }
}
