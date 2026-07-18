import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:shimmer/shimmer.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/animated_entry.dart';
import '../../core/widgets/glass_card.dart';
import '../../models/ride_model.dart';
import '../../providers/providers.dart';

/// Yolculuk geçmişi — tarih başlıklı, timeline tarzı kartlar.
class RideHistoryScreen extends ConsumerStatefulWidget {
  const RideHistoryScreen({super.key});

  @override
  ConsumerState<RideHistoryScreen> createState() => _RideHistoryScreenState();
}

class _RideHistoryScreenState extends ConsumerState<RideHistoryScreen> {
  List<RideModel> _rides = [];
  bool _isLoading = true;
  String? _error;
  int _page = 1;
  int _totalPages = 1;
  bool _hasMore = true;
  final _scrollController = ScrollController();

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

  int _totalPagesFromResponseData(dynamic data) {
    if (data is Map && data['totalPages'] != null) {
      final tp = data['totalPages'];
      if (tp is num) return tp.toInt().clamp(1, 999999);
    }
    return 1;
  }

  @override
  void initState() {
    super.initState();
    _loadRides();
    _scrollController.addListener(() {
      if (_scrollController.position.pixels >=
          _scrollController.position.maxScrollExtent - 100) {
        if (!_isLoading && _hasMore) _loadMoreRides();
      }
    });
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _loadRides() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final api = ref.read(apiServiceProvider);
      final response = await api.listRides(page: 1, limit: 15);
      if (response.data['success'] == true) {
        final payload = response.data['data'];
        final list = _ridesFromResponseData(payload);
        final tp = _totalPagesFromResponseData(payload);
        setState(() {
          _rides = list;
          _page = 1;
          _totalPages = tp;
          _hasMore = _page < _totalPages;
          _isLoading = false;
        });
      } else {
        setState(() {
          _error = 'Yolculuklar yüklenemedi.';
          _isLoading = false;
        });
      }
    } catch (e) {
      setState(() {
        _error = 'Bağlantı hatası.';
        _isLoading = false;
      });
    }
  }

  Future<void> _loadMoreRides() async {
    if (_isLoading) return;
    setState(() => _isLoading = true);
    try {
      final api = ref.read(apiServiceProvider);
      final response = await api.listRides(page: _page + 1, limit: 15);
      if (response.data['success'] == true) {
        final payload = response.data['data'];
        final list = _ridesFromResponseData(payload);
        final tp = _totalPagesFromResponseData(payload);
        setState(() {
          _rides.addAll(list);
          _page++;
          _totalPages = tp;
          _hasMore = _page < _totalPages;
          _isLoading = false;
        });
      }
    } catch (_) {
      setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.backgroundColor,
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(LucideIcons.chevronLeft),
          onPressed: () => Navigator.of(context).maybePop(),
        ),
        title: const Text('Yolculuk Geçmişi'),
      ),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_error != null && _rides.isEmpty) return _errorState();
    if (_isLoading && _rides.isEmpty) return _loadingSkeleton();
    if (_rides.isEmpty) return _emptyState();

    final grouped = _groupByDate(_rides);

    return RefreshIndicator(
      color: AppTheme.primaryColor,
      onRefresh: _loadRides,
      child: ListView.builder(
        controller: _scrollController,
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
        itemCount: grouped.length + (_hasMore ? 1 : 0),
        itemBuilder: (context, index) {
          if (index >= grouped.length) {
            return const Padding(
              padding: EdgeInsets.all(16),
              child: Center(
                child: CircularProgressIndicator(color: AppTheme.primaryColor),
              ),
            );
          }
          final group = grouped[index];
          return AnimatedEntry(
            order: index,
            step: const Duration(milliseconds: 40),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(4, 16, 4, 10),
                  child: Text(
                    group.label,
                    style: const TextStyle(
                      fontSize: 12,
                      color: AppTheme.textMuted,
                      fontWeight: FontWeight.w700,
                      letterSpacing: 1.2,
                    ),
                  ),
                ),
                for (final r in group.rides) ...[
                  _RideCard(ride: r),
                  const SizedBox(height: 10),
                ],
              ],
            ),
          );
        },
      ),
    );
  }

  // ---------- States ----------
  Widget _errorState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(LucideIcons.cloudOff, size: 64, color: AppTheme.textMuted),
          const SizedBox(height: 16),
          Text(_error!, style: const TextStyle(color: AppTheme.textSecondary)),
          const SizedBox(height: 16),
          ElevatedButton(onPressed: _loadRides, child: const Text('Tekrar Dene')),
        ],
      ),
    );
  }

  Widget _loadingSkeleton() {
    return Shimmer.fromColors(
      baseColor: AppTheme.subtle,
      highlightColor: Colors.white,
      child: ListView.separated(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
        itemCount: 6,
        separatorBuilder: (_, __) => const SizedBox(height: 10),
        itemBuilder: (_, __) => Container(
          height: 128,
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(AppTheme.radiusLg),
          ),
        ),
      ),
    );
  }

  Widget _emptyState() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: 96,
              height: 96,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppTheme.primaryColor.withOpacity(0.12),
              ),
              child: const Icon(
                LucideIcons.history,
                size: 44,
                color: AppTheme.primaryColor,
              ),
            ),
            const SizedBox(height: 20),
            const Text(
              'Henüz yolculuk yok',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w700,
                color: AppTheme.textPrimary,
              ),
            ),
            const SizedBox(height: 6),
            const Text(
              'İlk yolculuğunu yaptığında burada görünecek.',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 13, color: AppTheme.textSecondary),
            ),
          ],
        ),
      ),
    );
  }

  // ---------- Grouping ----------
  List<_RideGroup> _groupByDate(List<RideModel> rides) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final yesterday = today.subtract(const Duration(days: 1));

    final Map<String, List<RideModel>> map = {};
    final Map<String, DateTime> keyDate = {};

    for (final r in rides) {
      final date = _bestDate(r) ?? DateTime(1970);
      final d = DateTime(date.year, date.month, date.day);
      String key;
      if (d == today) {
        key = 'Bugün';
      } else if (d == yesterday) {
        key = 'Dün';
      } else {
        key = DateFormat('dd MMMM yyyy', 'tr_TR').format(d);
      }
      map.putIfAbsent(key, () => []).add(r);
      keyDate.putIfAbsent(key, () => d);
    }

    final entries = map.entries.toList();
    entries.sort((a, b) => keyDate[b.key]!.compareTo(keyDate[a.key]!));
    return entries.map((e) => _RideGroup(e.key, e.value)).toList();
  }

  DateTime? _bestDate(RideModel r) {
    if (r.requestedAt != null) {
      try {
        return DateTime.parse(r.requestedAt!).toLocal();
      } catch (_) {}
    }
    return null;
  }
}

class _RideGroup {
  final String label;
  final List<RideModel> rides;
  _RideGroup(this.label, this.rides);
}

// ============================================================
// RIDE CARD (timeline style)
// ============================================================

class _RideCard extends StatelessWidget {
  const _RideCard({required this.ride});

  final RideModel ride;

  @override
  Widget build(BuildContext context) {
    final statusColor = _statusColor(ride.status);
    final timeStr = ride.requestedAt != null
        ? DateFormat('HH:mm', 'tr_TR')
            .format(DateTime.parse(ride.requestedAt!).toLocal())
        : '—';

    return GlassCard(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Üst: saat + durum + fiyat
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: AppTheme.subtle,
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(LucideIcons.clock,
                        size: 12, color: AppTheme.textSecondary),
                    const SizedBox(width: 4),
                    Text(
                      timeStr,
                      style: const TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                        color: AppTheme.textSecondary,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: statusColor.withOpacity(0.12),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  ride.status.displayText,
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    color: statusColor,
                  ),
                ),
              ),
              const Spacer(),
              Text(
                ride.customerFareLabel,
                style: const TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w800,
                  color: AppTheme.textPrimary,
                  letterSpacing: -0.3,
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),

          // Timeline: origin — line — destination
          _Timeline(
            pickup: ride.pickupAddress,
            dropoff: ride.dropoffAddress,
          ),

          if (ride.distanceKm != null) ...[
            const SizedBox(height: 12),
            Container(height: 1, color: AppTheme.border),
            const SizedBox(height: 10),
            Row(
              children: [
                const Icon(LucideIcons.route,
                    size: 14, color: AppTheme.textSecondary),
                const SizedBox(width: 6),
                Text(
                  '${ride.distanceKm!.toStringAsFixed(1)} km',
                  style: const TextStyle(
                    fontSize: 12,
                    color: AppTheme.textSecondary,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Color _statusColor(RideStatus status) {
    switch (status) {
      case RideStatus.completed:
        return AppTheme.success;
      case RideStatus.cancelled:
        return AppTheme.errorColor;
      case RideStatus.inProgress:
      case RideStatus.arriving:
      case RideStatus.accepted:
        return AppTheme.info;
      default:
        return AppTheme.textSecondary;
    }
  }
}

class _Timeline extends StatelessWidget {
  const _Timeline({required this.pickup, required this.dropoff});
  final String pickup;
  final String dropoff;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Dots + connector
        Column(
          children: [
            Container(
              width: 10,
              height: 10,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppTheme.success.withOpacity(0.15),
                border: Border.all(color: AppTheme.success, width: 2),
              ),
            ),
            Container(
              width: 2,
              height: 26,
              margin: const EdgeInsets.symmetric(vertical: 2),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(1),
                color: AppTheme.border,
              ),
            ),
            Container(
              width: 10,
              height: 10,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppTheme.errorColor.withOpacity(0.15),
                border: Border.all(color: AppTheme.errorColor, width: 2),
              ),
            ),
          ],
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _line(pickup),
              const SizedBox(height: 18),
              _line(dropoff),
            ],
          ),
        ),
      ],
    );
  }

  Widget _line(String txt) {
    return Text(
      txt,
      maxLines: 2,
      overflow: TextOverflow.ellipsis,
      style: const TextStyle(
        fontSize: 13,
        fontWeight: FontWeight.w600,
        color: AppTheme.textPrimary,
        height: 1.3,
      ),
    );
  }
}
