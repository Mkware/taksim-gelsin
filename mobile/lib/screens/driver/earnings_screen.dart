import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../../core/theme/app_theme.dart';
import '../../models/ride_model.dart';
import '../../providers/providers.dart';

/// Sürücü kazanç ekranı — tamamlanan yolculukların toplam kazancı ve listesi
class EarningsScreen extends ConsumerStatefulWidget {
  const EarningsScreen({super.key});

  @override
  ConsumerState<EarningsScreen> createState() => _EarningsScreenState();
}

class _EarningsScreenState extends ConsumerState<EarningsScreen> {
  List<RideModel> _completedRides = [];
  bool _isLoading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadEarnings();
  }

  /// Tamamlanmış yolculukları yükle
  Future<void> _loadEarnings() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final api = ref.read(apiServiceProvider);
      final response = await api.listRides(page: 1, limit: 50);

      if (response.data['success'] == true) {
        final payload = response.data['data'];
        final all = _ridesFromResponseData(payload);

        // Sadece tamamlanan yolculuklar
        final completed = all.where((r) => r.status == RideStatus.completed).toList();

        setState(() {
          _completedRides = completed;
          _isLoading = false;
        });
      }
    } catch (e) {
      setState(() {
        _error = 'Veriler yüklenemedi: $e';
        _isLoading = false;
      });
    }
  }

  List<RideModel> _ridesFromResponseData(dynamic data) {
    List<dynamic> raw;
    if (data is List) {
      raw = data;
    } else if (data is Map) {
      raw = (data['items'] as List?) ?? [];
    } else {
      raw = [];
    }
    return raw
        .map((e) => RideModel.fromJson(Map<String, dynamic>.from(e as Map)))
        .toList();
  }

  /// Toplam kazanç hesapla
  double get _totalEarnings {
    return _completedRides.fold(0.0, (sum, ride) => sum + ride.displayPrice);
  }

  /// Bugünkü kazanç hesapla
  double get _todayEarnings {
    final today = DateTime.now();
    return _completedRides.where((ride) {
      if (ride.completedAt == null) return false;
      final rideDate = DateTime.parse(ride.completedAt!);
      return rideDate.year == today.year &&
          rideDate.month == today.month &&
          rideDate.day == today.day;
    }).fold(0.0, (sum, ride) => sum + ride.displayPrice);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Kazançlarım'),
        backgroundColor: AppTheme.primaryColor,
        foregroundColor: AppTheme.secondaryColor,
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: AppTheme.primaryColor))
          : _error != null
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Icon(Icons.error_outline, size: 64, color: AppTheme.textSecondary),
                      const SizedBox(height: 16),
                      Text(_error!, style: const TextStyle(color: AppTheme.textSecondary)),
                      const SizedBox(height: 16),
                      ElevatedButton(onPressed: _loadEarnings, child: const Text('Tekrar Dene')),
                    ],
                  ),
                )
              : RefreshIndicator(
                  color: AppTheme.primaryColor,
                  onRefresh: _loadEarnings,
                  child: ListView(
                    padding: const EdgeInsets.all(20),
                    children: [
                      // Kazanç özet kartları
                      Row(
                        children: [
                          Expanded(child: _buildSummaryCard(
                            title: 'Bugün',
                            amount: _todayEarnings,
                            icon: Icons.today,
                            color: AppTheme.accentColor,
                          )),
                          const SizedBox(width: 12),
                          Expanded(child: _buildSummaryCard(
                            title: 'Toplam',
                            amount: _totalEarnings,
                            icon: Icons.account_balance_wallet,
                            color: AppTheme.primaryDark,
                          )),
                        ],
                      ),
                      const SizedBox(height: 12),
                      // Toplam yolculuk sayısı
                      _buildSummaryCard(
                        title: 'Tamamlanan Yolculuk',
                        amount: _completedRides.length.toDouble(),
                        icon: Icons.local_taxi,
                        color: Colors.blue,
                        isCount: true,
                      ),
                      const SizedBox(height: 24),

                      // Yolculuk listesi başlığı
                      const Text(
                        'Son Yolculuklar',
                        style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                      ),
                      const SizedBox(height: 12),

                      if (_completedRides.isEmpty)
                        const Padding(
                          padding: EdgeInsets.only(top: 40),
                          child: Center(
                            child: Column(
                              children: [
                                Icon(Icons.directions_car, size: 64, color: AppTheme.textSecondary),
                                SizedBox(height: 12),
                                Text(
                                  'Henüz tamamlanmış yolculuk yok.',
                                  style: TextStyle(color: AppTheme.textSecondary),
                                ),
                              ],
                            ),
                          ),
                        )
                      else
                        ..._completedRides.map(_buildRideItem),
                    ],
                  ),
                ),
    );
  }

  /// Özet kartı
  Widget _buildSummaryCard({
    required String title,
    required double amount,
    required IconData icon,
    required Color color,
    bool isCount = false,
  }) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: color.withOpacity(0.08),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: color.withOpacity(0.2)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: color, size: 22),
              const SizedBox(width: 8),
              Text(title, style: TextStyle(fontSize: 13, color: color, fontWeight: FontWeight.w600)),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            isCount ? '${amount.toInt()} yolculuk' : '${amount.toStringAsFixed(0)} ₺',
            style: TextStyle(
              fontSize: isCount ? 18 : 24,
              fontWeight: FontWeight.bold,
              color: color,
            ),
          ),
        ],
      ),
    );
  }

  /// Yolculuk satır öğesi
  Widget _buildRideItem(RideModel ride) {
    final dateStr = ride.completedAt != null
        ? DateFormat('dd.MM.yyyy HH:mm').format(DateTime.parse(ride.completedAt!))
        : '—';

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.dividerColor.withOpacity(0.5)),
      ),
      child: Row(
        children: [
          // Sol: nokta çizgisi
          Column(
            children: [
              const Icon(Icons.circle, color: AppTheme.accentColor, size: 8),
              Container(width: 1, height: 16, color: AppTheme.textSecondary.withOpacity(0.3)),
              const Icon(Icons.circle, color: AppTheme.errorColor, size: 8),
            ],
          ),
          const SizedBox(width: 10),
          // Orta: adres bilgileri
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(ride.pickupAddress, style: const TextStyle(fontSize: 12), overflow: TextOverflow.ellipsis),
                const SizedBox(height: 6),
                Text(ride.dropoffAddress, style: const TextStyle(fontSize: 12), overflow: TextOverflow.ellipsis),
              ],
            ),
          ),
          const SizedBox(width: 8),
          // Sağ: ücret ve tarih
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                '${ride.displayPrice.toStringAsFixed(0)} ₺',
                style: const TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.bold,
                  color: AppTheme.primaryDark,
                ),
              ),
              const SizedBox(height: 4),
              Text(dateStr, style: const TextStyle(fontSize: 10, color: AppTheme.textSecondary)),
            ],
          ),
        ],
      ),
    );
  }
}
