
import 'dart:async';
import 'dart:ui';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import '../../core/constants/app_constants.dart';
import '../../core/theme/app_theme.dart';
import '../../providers/providers.dart';
import '../../services/api_service.dart';
import '../../services/driver_push_registration.dart';

const _bg = Color(0xFF090D14);
const _cardBg = Color(0x1AFFFFFF);
const _neonBlue = Color(0xFF00E5FF);
const _neonPurple = Color(0xFFB000FF);
const _textSecondary = Color(0xFFA0AEC0);

/// 0555… / 90555… / 555… → +905551112233
String? normalizeTrPhoneE164(String raw) {
  var s = raw.trim().replaceAll(RegExp(r'[\s\-()]'), '');
  if (s.isEmpty) return null;
  if (s.startsWith('0') && s.length == 11) {
    s = '+90${s.substring(1)}';
  } else if (s.startsWith('90') && s.length == 12) {
    s = '+$s';
  } else if (RegExp(r'^5[0-9]{9}$').hasMatch(s)) {
    s = '+90$s';
  }
  if (!RegExp(r'^\+90[0-9]{10}$').hasMatch(s)) return null;
  return s;
}

String adminApiErrorMessage(Object e, {String fallback = 'İstek başarısız'}) {
  if (e is DioException) {
    final d = e.response?.data;
    if (d is Map && d['error'] != null) return '${d['error']}';
  }
  return fallback;
}

class GlassCard extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry padding;
  final EdgeInsetsGeometry margin;
  final double borderRadius;
  
  const GlassCard({super.key, required this.child, this.padding = const EdgeInsets.all(16), this.margin = EdgeInsets.zero, this.borderRadius = 16});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: margin,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(borderRadius),
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 15, sigmaY: 15),
          child: Container(
            padding: padding,
            decoration: BoxDecoration(
              color: _cardBg,
              borderRadius: BorderRadius.circular(borderRadius),
              border: Border.all(color: Colors.white.withOpacity(0.1)),
            ),
            child: child,
          ),
        ),
      ),
    );
  }
}

class AdminHomeScreen extends ConsumerStatefulWidget {
  const AdminHomeScreen({super.key});

  @override
  ConsumerState<AdminHomeScreen> createState() => _AdminHomeScreenState();
}

class _AdminHomeScreenState extends ConsumerState<AdminHomeScreen> {
  static const int _liveTabIndex = 1;
  static const int _operationsTabIndex = 2;
  static const int _reviewsTabIndex = 3;
  static const int _ridesTabIndex = 4;
  static const int _logsTabIndex = 5;
  static const int _settingsTabIndex = 6;
  int _menuIndex = 0;
  bool _loading = true;

  Map<String, dynamic> _overview = {};
  Map<String, dynamic> _pricing = {};
  Map<String, dynamic> _platform = {};
  List<Map<String, dynamic>> _drivers = [];
  List<Map<String, dynamic>> _rides = [];
  String _rideStatusFilter = 'all';
  final _rideSearchController = TextEditingController();
  bool _ridesLoading = false;
  int _opsSegment = 0;
  List<Map<String, dynamic>> _customers = [];
  String _customerSuspendedFilter = 'all';
  final _customerSearchController = TextEditingController();
  bool _customersLoading = false;
  List<Map<String, dynamic>> _liveDrivers = [];
  List<Map<String, dynamic>> _liveRides = [];
  List<Map<String, dynamic>> _matchingItems = [];
  Map<String, dynamic> _opsHealth = {};
  bool _liveLoading = false;
  Timer? _liveTimer;
  List<Map<String, dynamic>> _reviews = [];
  Map<int, int> _reviewCounts = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0};
  int? _reviewStarFilter;
  bool _reviewsLoading = false;
  List<String> _outLogs = [];
  List<String> _errorLogs = [];
  Timer? _logTimer;
  bool _isLoadingAll = false;
  bool _isRefreshingOps = false;

  @override
  void initState() {
    super.initState();
    _loadAll();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      DriverPushRegistration.ensureRegisteredForAdmin(ref);
    });
    _logTimer = Timer.periodic(const Duration(seconds: 15), (_) {
      if (_menuIndex == _logsTabIndex) {
        _loadLogs();
      }
    });
    _liveTimer = Timer.periodic(const Duration(seconds: 20), (_) {
      if (_menuIndex == _liveTabIndex && mounted) {
        _loadLiveOps(silent: true);
      }
    });
  }

  @override
  void dispose() {
    _logTimer?.cancel();
    _liveTimer?.cancel();
    _rideSearchController.dispose();
    _customerSearchController.dispose();
    super.dispose();
  }

  Future<void> _loadAll() async {
    if (_isLoadingAll) return;
    _isLoadingAll = true;
    setState(() => _loading = true);
    var successCount = 0;
    try {
      final api = ref.read(apiServiceProvider);
      final results = await Future.wait([
        api.getAdminOverview().then((r) => {'ok': true, 'key': 'overview', 'data': r.data}).catchError((_) => {'ok': false, 'key': 'overview'}),
        api.getAdminPricingSettings().then((r) => {'ok': true, 'key': 'pricing', 'data': r.data}).catchError((_) => {'ok': false, 'key': 'pricing'}),
        api.getAdminPlatformSettings().then((r) => {'ok': true, 'key': 'platform', 'data': r.data}).catchError((_) => {'ok': false, 'key': 'platform'}),
        api.getAdminDrivers().then((r) => {'ok': true, 'key': 'drivers', 'data': r.data}).catchError((_) => {'ok': false, 'key': 'drivers'}),
        _fetchRides().then((r) => {'ok': true, 'key': 'rides', 'data': r}).catchError((_) => {'ok': false, 'key': 'rides'}),
      ]);

      for (final item in results) {
        final ok = item['ok'] == true;
        if (!ok) continue;
        successCount++;
        final key = item['key'] as String;
        final data = item['data'];
        if (key == 'overview') {
          _overview = (data as Map?)?['data'] as Map<String, dynamic>? ?? _overview;
        } else if (key == 'pricing') {
          _pricing = (data as Map?)?['data'] as Map<String, dynamic>? ?? _pricing;
        } else if (key == 'platform') {
          _platform = (data as Map?)?['data'] as Map<String, dynamic>? ?? _platform;
        } else if (key == 'drivers') {
          _drivers = ((data as Map?)?['data']?['items'] as List? ?? [])
              .map((e) => Map<String, dynamic>.from(e as Map))
              .toList();
        } else if (key == 'rides') {
          _rides = ((data as Map?)?['data']?['items'] as List? ?? [])
              .map((e) => Map<String, dynamic>.from(e as Map))
              .toList();
        }
      }

      if (mounted) {
        setState(() {});
      }
      if (_menuIndex == _logsTabIndex) {
        await _loadLogs();
      }
    } catch (_) {
    } finally {
      _isLoadingAll = false;
      if (mounted && successCount == 0) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Admin verileri yüklenemedi.')),
        );
      }
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _loadReviews() async {
    if (_reviewsLoading) return;
    setState(() => _reviewsLoading = true);
    try {
      final res = await ref.read(apiServiceProvider).getAdminReviews(
            rating: _reviewStarFilter,
            limit: 50,
          );
      final root = res.data;
      if (!mounted || root is! Map || root['success'] != true) return;
      final data = root['data'] as Map?;
      if (data == null) return;
      final items = (data['items'] as List? ?? [])
          .map((e) => Map<String, dynamic>.from(e as Map))
          .toList();
      final countsRaw = data['counts'] as Map?;
      final counts = <int, int>{1: 0, 2: 0, 3: 0, 4: 0, 5: 0};
      if (countsRaw != null) {
        for (var s = 1; s <= 5; s++) {
          counts[s] = (countsRaw['$s'] as num?)?.toInt() ?? 0;
        }
      }
      setState(() {
        _reviews = items;
        _reviewCounts = counts;
      });
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Değerlendirmeler yüklenemedi.')),
        );
      }
    } finally {
      if (mounted) setState(() => _reviewsLoading = false);
    }
  }

  Future<void> _loadLogs() async {
    try {
      final res = await ref.read(apiServiceProvider).getAdminLogs(lines: 100);
      final out = (res.data['data']?['out'] as List? ?? []).map((e) => '$e').toList();
      final error = (res.data['data']?['error'] as List? ?? []).map((e) => '$e').toList();
      if (!mounted) return;
      setState(() {
        _outLogs = out;
        _errorLogs = error;
      });
    } catch (_) {}
  }

  Future<Map<String, dynamic>> _fetchRides() async {
    final res = await ref.read(apiServiceProvider).getAdminRides(
      limit: 80,
      status: _rideStatusFilter,
      q: _rideSearchController.text,
    );
    return res.data as Map<String, dynamic>;
  }

  Future<void> _loadRides({bool silent = false}) async {
    if (!silent && mounted) setState(() => _ridesLoading = true);
    try {
      final data = await _fetchRides();
      _rides = (data['data']?['items'] as List? ?? [])
          .map((e) => Map<String, dynamic>.from(e as Map))
          .toList();
      if (mounted) setState(() {});
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Yolculuk listesi yüklenemedi.')),
      );
    } finally {
      if (!silent && mounted) setState(() => _ridesLoading = false);
    }
  }

  String _statusTr(String? status) {
    switch (status) {
      case 'searching':
        return 'Aranıyor';
      case 'accepted':
        return 'Kabul edildi';
      case 'arriving':
        return 'Geliyor';
      case 'in_progress':
        return 'Yolculukta';
      case 'completed':
        return 'Tamamlandı';
      case 'cancelled':
        return 'İptal';
      default:
        return status ?? '-';
    }
  }

  Color _statusColor(String? status) {
    switch (status) {
      case 'completed':
        return Colors.greenAccent;
      case 'cancelled':
        return Colors.redAccent;
      case 'searching':
        return Colors.orangeAccent;
      default:
        return _neonBlue;
    }
  }

  Future<void> _openRideDetail(Map<String, dynamic> r) async {
    final id = '${r['id'] ?? ''}';
    if (id.isEmpty) return;
    Map<String, dynamic> ride = Map<String, dynamic>.from(r);
    try {
      final res = await ref.read(apiServiceProvider).getAdminRide(id);
      if (res.data is Map && res.data['success'] == true) {
        ride = Map<String, dynamic>.from(res.data['data'] as Map);
      }
    } catch (_) {}

    if (!mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: _bg,
      isScrollControlled: true,
      builder: (ctx) {
        final canCancel = ride['can_cancel'] == true;
        final status = '${ride['status'] ?? ''}';
        final price = ride['final_price'] ?? ride['estimated_price'] ?? 0;
        return Padding(
          padding: EdgeInsets.only(
            left: 20,
            right: 20,
            top: 16,
            bottom: MediaQuery.of(ctx).viewInsets.bottom + 24,
          ),
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        'Yolculuk detayı',
                        style: GoogleFonts.inter(
                          color: Colors.white,
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(
                        color: _statusColor(status).withOpacity(0.2),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(
                        _statusTr(status),
                        style: GoogleFonts.inter(
                          color: _statusColor(status),
                          fontWeight: FontWeight.w700,
                          fontSize: 12,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                _detailRow('Yolcu', '${ride['customer_name'] ?? '-'}'),
                _detailRow('Tel', '${ride['customer_phone'] ?? '-'}'),
                _detailRow('Sürücü', '${ride['driver_name'] ?? '-'}'),
                _detailRow('Sürücü tel', '${ride['driver_phone'] ?? '-'}'),
                _detailRow('Ücret', '$price TL'),
                _detailRow('Mesafe', '${ride['distance_km'] ?? '-'} km'),
                _detailRow('Biniş', '${ride['pickup_address'] ?? '-'}'),
                _detailRow('İniş', '${ride['dropoff_address'] ?? '-'}'),
                if (ride['cancel_reason'] != null)
                  _detailRow('İptal nedeni', '${ride['cancel_reason']}'),
                _detailRow('Talep', _formatReviewDate('${ride['requested_at'] ?? ''}')),
                if (canCancel) ...[
                  const SizedBox(height: 16),
                  FilledButton.icon(
                    style: FilledButton.styleFrom(
                      backgroundColor: Colors.redAccent,
                      foregroundColor: Colors.white,
                    ),
                    onPressed: () async {
                      Navigator.pop(ctx);
                      await _confirmCancelRide(id);
                    },
                    icon: const Icon(Icons.cancel_outlined),
                    label: const Text('Yolculuğu iptal et'),
                  ),
                ],
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _detailRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 88,
            child: Text(label, style: GoogleFonts.inter(color: _textSecondary, fontSize: 12)),
          ),
          Expanded(
            child: Text(value, style: GoogleFonts.inter(color: Colors.white, fontSize: 13)),
          ),
        ],
      ),
    );
  }

  Future<void> _confirmCancelRide(String rideId) async {
    final reasonCtrl = TextEditingController(text: 'Yönetici tarafından iptal');
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: _bg,
        title: const Text('Yolculuğu iptal et', style: TextStyle(color: Colors.white)),
        content: TextField(
          controller: reasonCtrl,
          maxLines: 2,
          style: const TextStyle(color: Colors.white),
          decoration: const InputDecoration(
            labelText: 'İptal nedeni',
            labelStyle: TextStyle(color: _textSecondary),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Vazgeç', style: TextStyle(color: _textSecondary)),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Colors.redAccent),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('İptal et'),
          ),
        ],
      ),
    );
    final reasonText = reasonCtrl.text;
    reasonCtrl.dispose();
    if (ok != true || !mounted) return;
    try {
      final res = await ref.read(apiServiceProvider).cancelAdminRide(
        rideId,
        reason: reasonText,
      );
      if (!mounted) return;
      if (res.data is Map && res.data['success'] == true) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Yolculuk iptal edildi.'), backgroundColor: AppTheme.success),
        );
        await _loadRides();
        await _refreshOperationalData();
      } else {
        final err = (res.data is Map) ? (res.data['error'] as String? ?? 'İptal başarısız') : 'İptal başarısız';
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err)));
      }
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(adminApiErrorMessage(e, fallback: 'Yolculuk iptal edilemedi.'))),
      );
    }
  }

  Future<void> _loadLiveOps({bool silent = false}) async {
    if (!silent && mounted) setState(() => _liveLoading = true);
    try {
      final api = ref.read(apiServiceProvider);
      final results = await Future.wait([
        api.getAdminOpsLive(),
        api.getAdminOpsHealth(),
        api.getAdminOpsMatching(),
      ]);
      final live = results[0].data as Map?;
      final health = results[1].data as Map?;
      final matching = results[2].data as Map?;
      if (live?['success'] == true) {
        final d = live!['data'] as Map?;
        _liveDrivers = (d?['drivers'] as List? ?? [])
            .map((e) => Map<String, dynamic>.from(e as Map))
            .toList();
        _liveRides = (d?['rides'] as List? ?? [])
            .map((e) => Map<String, dynamic>.from(e as Map))
            .toList();
      }
      if (health?['success'] == true) {
        _opsHealth = Map<String, dynamic>.from(health!['data'] as Map);
      }
      if (matching?['success'] == true) {
        _matchingItems = (matching!['data']?['items'] as List? ?? [])
            .map((e) => Map<String, dynamic>.from(e as Map))
            .toList();
      }
      if (mounted) setState(() {});
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Canlı operasyon verisi yüklenemedi.')),
      );
    } finally {
      if (!silent && mounted) setState(() => _liveLoading = false);
    }
  }

  Future<void> _clearRideMatching(String rideId) async {
    try {
      final res = await ref.read(apiServiceProvider).postAdminOpsMatchingClear(rideId);
      if (!mounted) return;
      if (res.data is Map && res.data['success'] == true) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Eşleştirme kuyruğu temizlendi.'), backgroundColor: AppTheme.success),
        );
        await _loadLiveOps();
      }
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(adminApiErrorMessage(e))),
      );
    }
  }

  Future<void> _recoverStaleSearching() async {
    try {
      final res = await ref.read(apiServiceProvider).postAdminOpsStaleSearchingRecover();
      if (!mounted) return;
      final msg = (res.data is Map) ? (res.data['message'] as String? ?? 'Tamamlandı') : 'Tamamlandı';
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
      await _loadLiveOps();
      await _refreshOperationalData();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(adminApiErrorMessage(e))),
      );
    }
  }

  Future<void> _loadCustomers({bool silent = false}) async {
    if (!silent && mounted) setState(() => _customersLoading = true);
    try {
      final res = await ref.read(apiServiceProvider).getAdminCustomers(
        limit: 80,
        q: _customerSearchController.text,
        suspended: _customerSuspendedFilter,
      );
      _customers = (res.data['data']?['items'] as List? ?? [])
          .map((e) => Map<String, dynamic>.from(e as Map))
          .toList();
      if (mounted) setState(() {});
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Müşteri listesi yüklenemedi.')),
      );
    } finally {
      if (!silent && mounted) setState(() => _customersLoading = false);
    }
  }

  Future<void> _openCustomerDetail(Map<String, dynamic> c) async {
    final id = '${c['id'] ?? ''}';
    if (id.isEmpty) return;
    Map<String, dynamic> customer = Map<String, dynamic>.from(c);
    try {
      final res = await ref.read(apiServiceProvider).getAdminCustomer(id);
      if (res.data is Map && res.data['success'] == true) {
        customer = Map<String, dynamic>.from(res.data['data'] as Map);
      }
    } catch (_) {}

    if (!mounted) return;
    final suspended = customer['is_suspended'] == true;
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: _bg,
      isScrollControlled: true,
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(
          left: 20,
          right: 20,
          top: 16,
          bottom: MediaQuery.of(ctx).viewInsets.bottom + 24,
        ),
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                '${customer['full_name'] ?? 'Müşteri'}',
                style: GoogleFonts.inter(
                  color: Colors.white,
                  fontSize: 18,
                  fontWeight: FontWeight.bold,
                ),
              ),
              if (suspended)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(
                    'ASKIDA',
                    style: GoogleFonts.inter(color: Colors.redAccent, fontWeight: FontWeight.w800),
                  ),
                ),
              const SizedBox(height: 12),
              _detailRow('Telefon', '${customer['phone'] ?? '-'}'),
              _detailRow('Puan', '${customer['rating'] ?? 5} (${customer['rating_count'] ?? 0})'),
              _detailRow('Yolculuk', '${customer['completed_rides'] ?? 0} tamamlanan'),
              if (customer['has_active_ride'] == true)
                _detailRow('Durum', 'Aktif yolculuk var'),
              _detailRow('Kayıt', _formatReviewDate('${customer['created_at'] ?? ''}')),
              const SizedBox(height: 16),
              OutlinedButton.icon(
                onPressed: () async {
                  Navigator.pop(ctx);
                  await _setCustomerSuspended(id, !suspended);
                },
                icon: Icon(suspended ? Icons.check_circle_outline : Icons.block, color: _neonBlue),
                label: Text(
                  suspended ? 'Askıyı kaldır' : 'Hesabı askıya al',
                  style: GoogleFonts.inter(color: _neonBlue, fontWeight: FontWeight.w600),
                ),
              ),
              const SizedBox(height: 8),
              OutlinedButton.icon(
                onPressed: () async {
                  Navigator.pop(ctx);
                  await _revokeCustomerSessions(id);
                },
                icon: const Icon(Icons.logout, color: _textSecondary),
                label: Text(
                  'Oturumları kapat',
                  style: GoogleFonts.inter(color: _textSecondary, fontWeight: FontWeight.w600),
                ),
              ),
              const SizedBox(height: 8),
              OutlinedButton.icon(
                onPressed: () async {
                  Navigator.pop(ctx);
                  await _resetCustomerPassword(id);
                },
                icon: const Icon(Icons.lock_reset, color: _textSecondary),
                label: Text(
                  'Şifre sıfırla',
                  style: GoogleFonts.inter(color: _textSecondary, fontWeight: FontWeight.w600),
                ),
              ),
              const SizedBox(height: 8),
              FilledButton.icon(
                style: FilledButton.styleFrom(backgroundColor: Colors.redAccent),
                onPressed: () async {
                  Navigator.pop(ctx);
                  await _confirmDeleteCustomer(id, '${customer['full_name'] ?? id}');
                },
                icon: const Icon(Icons.delete_outline),
                label: const Text('Müşteriyi sil'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _setCustomerSuspended(String id, bool suspended) async {
    try {
      final res = await ref.read(apiServiceProvider).updateAdminCustomer(id, {
        'is_suspended': suspended,
      });
      if (!mounted) return;
      if (res.data is Map && res.data['success'] == true) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(suspended ? 'Hesap askıya alındı.' : 'Askı kaldırıldı.'),
            backgroundColor: AppTheme.success,
          ),
        );
        await _loadCustomers();
      } else {
        final err = (res.data is Map) ? (res.data['error'] as String? ?? 'İşlem başarısız') : 'İşlem başarısız';
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err)));
      }
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(adminApiErrorMessage(e))),
      );
    }
  }

  Future<void> _revokeCustomerSessions(String id) async {
    try {
      final res = await ref.read(apiServiceProvider).revokeAdminCustomerSessions(id);
      if (!mounted) return;
      if (res.data is Map && res.data['success'] == true) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Oturumlar kapatıldı.'), backgroundColor: AppTheme.success),
        );
      }
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(adminApiErrorMessage(e))),
      );
    }
  }

  Future<void> _resetCustomerPassword(String id) async {
    final passCtrl = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: _bg,
        title: const Text('Şifre sıfırla', style: TextStyle(color: Colors.white)),
        content: TextField(
          controller: passCtrl,
          obscureText: true,
          style: const TextStyle(color: Colors.white),
          decoration: const InputDecoration(
            labelText: 'Yeni şifre (min 6)',
            labelStyle: TextStyle(color: _textSecondary),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('İptal', style: TextStyle(color: _textSecondary)),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Kaydet'),
          ),
        ],
      ),
    );
    final password = passCtrl.text;
    passCtrl.dispose();
    if (ok != true || password.length < 6 || !mounted) return;
    try {
      final res = await ref.read(apiServiceProvider).resetAdminCustomerPassword(id, password);
      if (!mounted) return;
      if (res.data is Map && res.data['success'] == true) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Şifre güncellendi.'), backgroundColor: AppTheme.success),
        );
      }
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(adminApiErrorMessage(e))),
      );
    }
  }

  Future<void> _confirmDeleteCustomer(String id, String name) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: _bg,
        title: const Text('Müşteriyi sil', style: TextStyle(color: Colors.white)),
        content: Text(
          '$name kalıcı olarak silinecek. Emin misiniz?',
          style: GoogleFonts.inter(color: _textSecondary),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('İptal', style: TextStyle(color: _textSecondary)),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Colors.redAccent),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Sil'),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    try {
      final res = await ref.read(apiServiceProvider).deleteAdminCustomer(id);
      if (!mounted) return;
      if (res.data is Map && res.data['success'] == true) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Müşteri silindi.'), backgroundColor: AppTheme.success),
        );
        await _loadCustomers();
        await _refreshOperationalData();
      }
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(adminApiErrorMessage(e, fallback: 'Müşteri silinemedi.'))),
      );
    }
  }

  Future<void> _refreshOperationalData() async {
    if (_isRefreshingOps || _isLoadingAll) return;
    _isRefreshingOps = true;
    try {
      final api = ref.read(apiServiceProvider);
      try {
        final r = await api.getAdminOverview();
        _overview = r.data['data'] as Map<String, dynamic>? ?? _overview;
      } catch (_) {}
      try {
        final r = await api.getAdminDrivers();
        _drivers = (r.data['data']?['items'] as List? ?? [])
            .map((e) => Map<String, dynamic>.from(e as Map))
            .toList();
      } catch (_) {}
      if (_opsSegment == 1) {
        try {
          await _loadCustomers(silent: true);
        } catch (_) {}
      }
      try {
        await _loadRides(silent: true);
      } catch (_) {}
      if (!mounted) return;
      setState(() {});
    } catch (_) {
    } finally {
      _isRefreshingOps = false;
    }
  }

  Future<void> _toggleDriverAccess(String id, bool enabled) async {
    try {
      await ref.read(apiServiceProvider).setAdminDriverAccess(driverId: id, enabled: enabled);
      await _loadAll();
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Sürücü erişimi güncellenemedi.')),
      );
    }
  }

  Future<void> _addDriverBalance(String driverId, String driverName, double currentBalance) async {
    final amountCtrl = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => Theme(
        data: Theme.of(ctx).copyWith(
          textSelectionTheme: const TextSelectionThemeData(
            cursorColor: _neonBlue,
            selectionColor: Color(0x6600E5FF),
            selectionHandleColor: _neonBlue,
          ),
        ),
        child: AlertDialog(
        backgroundColor: _bg,
        title: const Text('T Coin yükle', style: TextStyle(color: Colors.white)),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                driverName,
                style: GoogleFonts.inter(fontWeight: FontWeight.w700, color: _neonBlue),
              ),
              const SizedBox(height: 6),
              Text(
                'Güncel bakiye: ${currentBalance.toStringAsFixed(0)} T Coin',
                style: GoogleFonts.inter(fontSize: 13, color: _textSecondary),
              ),
              const SizedBox(height: 14),
              TextField(
                controller: amountCtrl,
                autofocus: true,
                cursorColor: _neonBlue,
                style: GoogleFonts.inter(color: Colors.white, fontSize: 17, fontWeight: FontWeight.w600),
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: InputDecoration(
                  filled: true,
                  fillColor: const Color(0xFF151922),
                  labelText: 'Eklenecek tutar',
                  labelStyle: GoogleFonts.inter(color: _textSecondary),
                  floatingLabelStyle: GoogleFonts.inter(color: _neonBlue),
                  suffixText: 'T Coin',
                  suffixStyle: GoogleFonts.inter(color: _neonBlue, fontWeight: FontWeight.w600),
                  contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: const BorderSide(color: Color(0xFF30363D)),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: const BorderSide(color: _neonBlue, width: 1.5),
                  ),
                ),
              ),
              const SizedBox(height: 10),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [50, 100, 200, 500].map((v) {
                  return ActionChip(
                    backgroundColor: _cardBg,
                    labelStyle: const TextStyle(color: Colors.white),
                    label: Text('$v T'),
                    onPressed: () {
                      amountCtrl.text = '$v';
                    },
                  );
                }).toList(),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('İptal', style: TextStyle(color: _textSecondary))),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: _neonBlue, foregroundColor: Colors.black),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Bakiyeye ekle', style: TextStyle(fontWeight: FontWeight.bold)),
          ),
        ],
      ),
      ),
    );

    if (ok != true || !mounted) return;
    final raw = amountCtrl.text.trim().replaceAll(',', '.');
    final amt = double.tryParse(raw);
    if (amt == null || amt <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Geçerli pozitif bir tutar girin.')));
      return;
    }

    try {
      final res = await ref.read(apiServiceProvider).addAdminDriverBalance(driverId: driverId, amount: amt);
      if (!mounted) return;
      if (res.statusCode == 200 && res.data['success'] == true) {
        final newBal = (res.data['data']?['balance'] as num?)?.toDouble();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(newBal != null ? 'Yeni bakiye: ${newBal.toStringAsFixed(0)} T Coin' : 'Bakiye güncellendi.'),
            backgroundColor: AppTheme.success,
          ),
        );
        await _refreshOperationalData();
      } else {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Bakiye güncellenemedi.')));
      }
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Bakiye güncellenemedi.')));
    }
  }

  Future<void> _openCreateDriverDialog() async {
    final phone = TextEditingController();
    final fullName = TextEditingController();
    final password = TextEditingController();
    final plate = TextEditingController();
    final model = TextEditingController();
    final color = TextEditingController();

    try {
      final ok = await showDialog<bool>(
        context: context,
        builder: (ctx) => Theme(
          data: Theme.of(ctx).copyWith(
            textSelectionTheme: const TextSelectionThemeData(
              cursorColor: _neonBlue,
              selectionColor: Color(0x6600E5FF),
              selectionHandleColor: _neonBlue,
            ),
          ),
          child: AlertDialog(
            backgroundColor: _bg,
            title: const Text('Yeni sürücü', style: TextStyle(color: Colors.white)),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    'Telefon: +905…, 0555… veya 555… formatında girebilirsiniz.',
                    style: GoogleFonts.inter(fontSize: 12, color: _textSecondary),
                  ),
                  const SizedBox(height: 10),
                  _driverTextField('Telefon', phone),
                  _driverTextField('Ad soyad', fullName),
                  _driverTextField('Şifre (min 6)', password, obscure: true),
                  _driverTextField('Plaka', plate),
                  _driverTextField('Araç modeli', model),
                  _driverTextField('Renk', color),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('İptal', style: TextStyle(color: _textSecondary)),
              ),
              ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: _neonBlue,
                  foregroundColor: Colors.black,
                ),
                onPressed: () => Navigator.pop(ctx, true),
                child: const Text('Oluştur', style: TextStyle(fontWeight: FontWeight.bold)),
              ),
            ],
          ),
        ),
      );

      if (ok != true || !mounted) return;

      final normalizedPhone = normalizeTrPhoneE164(phone.text);
      if (normalizedPhone == null) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Geçerli telefon girin (ör. +905551112233 veya 05551112233).')),
        );
        return;
      }
      final pwd = password.text;
      if (pwd.length < 6) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Şifre en az 6 karakter olmalı.')),
        );
        return;
      }

      final res = await ref.read(apiServiceProvider).createAdminDriver({
        'phone': normalizedPhone,
        'full_name': fullName.text.trim(),
        'password': pwd,
        'vehicle_plate': plate.text.trim(),
        'vehicle_model': model.text.trim(),
        'vehicle_color': color.text.trim(),
      });
      if (!mounted) return;
      if (res.statusCode == 201 && res.data is Map && res.data['success'] == true) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Sürücü oluşturuldu.'), backgroundColor: AppTheme.success),
        );
        await _refreshOperationalData();
      } else {
        final err = (res.data is Map) ? (res.data['error'] as String? ?? 'Kayıt başarısız') : 'Kayıt başarısız';
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err)));
      }
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(adminApiErrorMessage(e, fallback: 'Sürücü oluşturulamadı.'))),
      );
    } finally {
      phone.dispose();
      fullName.dispose();
      password.dispose();
      plate.dispose();
      model.dispose();
      color.dispose();
    }
  }

  Future<void> _openEditDriverDialog(Map<String, dynamic> d) async {
    final id = '${d['id'] ?? ''}';
    if (id.isEmpty) return;
    final user = Map<String, dynamic>.from((d['users'] as Map?) ?? {});

    final phone = TextEditingController(text: '${user['phone'] ?? ''}');
    final fullName = TextEditingController(text: '${user['full_name'] ?? ''}');
    final newPassword = TextEditingController();
    final plate = TextEditingController(text: '${d['vehicle_plate'] ?? ''}');
    final model = TextEditingController(text: '${d['vehicle_model'] ?? ''}');
    final color = TextEditingController(text: '${d['vehicle_color'] ?? ''}');

    try {
      final ok = await showDialog<bool>(
        context: context,
        builder: (ctx) => Theme(
          data: Theme.of(ctx).copyWith(
            textSelectionTheme: const TextSelectionThemeData(
              cursorColor: _neonBlue,
              selectionColor: Color(0x6600E5FF),
              selectionHandleColor: _neonBlue,
            ),
          ),
          child: AlertDialog(
            backgroundColor: _bg,
            title: const Text('Sürücüyü düzenle', style: TextStyle(color: Colors.white)),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    'Şifreyi değiştirmek için yeni şifre yazın; boş bırakırsanız değişmez.',
                    style: GoogleFonts.inter(fontSize: 12, color: _textSecondary),
                  ),
                  const SizedBox(height: 10),
                  _driverTextField('Telefon', phone),
                  _driverTextField('Ad soyad', fullName),
                  _driverTextField('Yeni şifre (isteğe bağlı)', newPassword, obscure: true),
                  _driverTextField('Plaka', plate),
                  _driverTextField('Araç modeli', model),
                  _driverTextField('Renk', color),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('İptal', style: TextStyle(color: _textSecondary)),
              ),
              ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: _neonBlue,
                  foregroundColor: Colors.black,
                ),
                onPressed: () => Navigator.pop(ctx, true),
                child: const Text('Kaydet', style: TextStyle(fontWeight: FontWeight.bold)),
              ),
            ],
          ),
        ),
      );

      if (ok != true || !mounted) return;

      final origPhone = '${user['phone'] ?? ''}';
      final origName = '${user['full_name'] ?? ''}';
      final origPlate = '${d['vehicle_plate'] ?? ''}';
      final origModel = '${d['vehicle_model'] ?? ''}';
      final origColor = '${d['vehicle_color'] ?? ''}';

      final body = <String, dynamic>{};
      final normalizedPhone = normalizeTrPhoneE164(phone.text);
      if (normalizedPhone == null) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Geçerli telefon girin (ör. +905551112233 veya 05551112233).')),
        );
        return;
      }
      final n = fullName.text.trim();
      final pl = plate.text.trim();
      final m = model.text.trim();
      final c = color.text.trim();
      if (normalizedPhone != origPhone) body['phone'] = normalizedPhone;
      if (n != origName) body['full_name'] = n;
      if (pl != origPlate) body['vehicle_plate'] = pl;
      if (m != origModel) body['vehicle_model'] = m;
      if (c != origColor) body['vehicle_color'] = c;
      if (newPassword.text.isNotEmpty) body['password'] = newPassword.text;

      if (body.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Değişiklik yok.')),
        );
        return;
      }

      final res = await ref.read(apiServiceProvider).updateAdminDriver(id, body);
      if (!mounted) return;
      if (res.statusCode == 200 && res.data is Map && res.data['success'] == true) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Sürücü güncellendi.'), backgroundColor: AppTheme.success),
        );
        await _refreshOperationalData();
      } else {
        final err = (res.data is Map) ? (res.data['error'] as String? ?? 'Güncellenemedi') : 'Güncellenemedi';
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err)));
      }
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(adminApiErrorMessage(e, fallback: 'Sürücü güncellenemedi.'))),
      );
    } finally {
      phone.dispose();
      fullName.dispose();
      newPassword.dispose();
      plate.dispose();
      model.dispose();
      color.dispose();
    }
  }

  Future<void> _confirmDeleteDriver(Map<String, dynamic> d) async {
    final id = '${d['id'] ?? ''}';
    if (id.isEmpty) return;
    final user = (d['users'] as Map?) ?? {};
    final name = '${user['full_name'] ?? id}';

    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: _bg,
        title: const Text('Sürücüyü sil', style: TextStyle(color: Colors.white)),
        content: Text(
          '$name kalıcı olarak silinecek. Emin misiniz?',
          style: GoogleFonts.inter(color: _textSecondary),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('İptal', style: TextStyle(color: _textSecondary)),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Colors.redAccent, foregroundColor: Colors.white),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Sil'),
          ),
        ],
      ),
    );

    if (ok != true || !mounted) return;

    try {
      final res = await ref.read(apiServiceProvider).deleteAdminDriver(id);
      if (!mounted) return;
      if (res.statusCode == 200 && res.data is Map && res.data['success'] == true) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Sürücü silindi.'), backgroundColor: AppTheme.success),
        );
        await _refreshOperationalData();
      } else {
        final err = (res.data is Map) ? (res.data['error'] as String? ?? 'Silinemedi') : 'Silinemedi';
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err)));
      }
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(adminApiErrorMessage(e, fallback: 'Sürücü silinemedi.'))),
      );
    }
  }

  Future<void> _openPlatformSettingsDialog() async {
    final s = _platform;
    final rideAcceptPercent =
        TextEditingController(text: '${s['rideAcceptFeePercent'] ?? 7}');
    final minOnline = TextEditingController(text: '${s['minDriverOnlineBalanceTcoin'] ?? 20}');
    final pickupMask = TextEditingController(text: '${s['pickupMaskRadiusM'] ?? 300}');
    final matrix = TextEditingController(text: '${s['matchingRoadMatrixMaxDrivers'] ?? 10}');
    final cacheTtl = TextEditingController(text: '${s['drivingDistanceCacheTtlSec'] ?? 600}');
    final driverResponseSec =
        TextEditingController(text: '${s['driverResponseTimeoutSeconds'] ?? 10}');
    var walletSim = s['walletCardSimulationEnabled'] == true;

    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setLocal) {
          return Theme(
            data: Theme.of(ctx).copyWith(
              textSelectionTheme: const TextSelectionThemeData(
                cursorColor: _neonBlue,
                selectionColor: Color(0x6600E5FF),
                selectionHandleColor: _neonBlue,
              ),
            ),
            child: AlertDialog(
            backgroundColor: _bg,
            title: const Text('Operasyon', style: TextStyle(color: Colors.white)),
            content: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _numField('Kabul ücreti (%)', rideAcceptPercent),
                  _numField('Min bakiye (T)', minOnline),
                  _numField('Maske (m)', pickupMask),
                  _numField('Max Sürücü', matrix),
                  _numField('TTL (sn)', cacheTtl),
                  _numField('Kabul süresi (sn)', driverResponseSec),
                  SwitchListTile(
                    title: const Text('Cüzdan Sim.', style: TextStyle(color: Colors.white)),
                    value: walletSim,
                    onChanged: (v) => setLocal(() => walletSim = v),
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('İptal', style: TextStyle(color: _textSecondary)),
              ),
              ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: _neonBlue,
                  foregroundColor: Colors.black,
                ),
                onPressed: () => Navigator.pop(ctx, true),
                child: const Text('Kaydet', style: TextStyle(fontWeight: FontWeight.bold)),
              ),
            ],
          ),
          );
        },
      ),
    );

    if (ok != true) return;
    try {
      await ref.read(apiServiceProvider).updateAdminPlatformSettings({
        'rideAcceptFeePercent': num.tryParse(rideAcceptPercent.text) ?? 7,
        'minDriverOnlineBalanceTcoin': num.tryParse(minOnline.text) ?? 20,
        'pickupMaskRadiusM': num.tryParse(pickupMask.text) ?? 300,
        'matchingRoadMatrixMaxDrivers': num.tryParse(matrix.text) ?? 10,
        'drivingDistanceCacheTtlSec': num.tryParse(cacheTtl.text) ?? 600,
        'driverResponseTimeoutSeconds': num.tryParse(driverResponseSec.text) ?? 10,
        'walletCardSimulationEnabled': walletSim,
      });
      await _loadAll();
    } catch (_) {}
  }

  Future<void> _openPricingDialog() async {
    final entryDaily = TextEditingController(text: '${_pricing['entryDaily'] ?? 0}');
    final entryWeekly = TextEditingController(text: '${_pricing['entryWeekly'] ?? 0}');
    final entryMonthly = TextEditingController(text: '${_pricing['entryMonthly'] ?? 0}');
    final commissionPercent = TextEditingController(text: '${_pricing['commissionPercent'] ?? 0}');
    final commissionFlat = TextEditingController(text: '${_pricing['commissionFlat'] ?? 0}');
    final minCommission = TextEditingController(text: '${_pricing['minCommission'] ?? 0}');

    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) {
        return Theme(
          data: Theme.of(ctx).copyWith(
            textSelectionTheme: const TextSelectionThemeData(
              cursorColor: _neonBlue,
              selectionColor: Color(0x6600E5FF),
              selectionHandleColor: _neonBlue,
            ),
          ),
          child: AlertDialog(
            backgroundColor: _bg,
            title: const Text('Fiyatlar', style: TextStyle(color: Colors.white)),
            content: SingleChildScrollView(
              child: Column(
                children: [
                  _numField('Günlük giriş', entryDaily),
                  _numField('Haftalık giriş', entryWeekly),
                  _numField('Aylık giriş', entryMonthly),
                  _numField('Komisyon %', commissionPercent),
                  _numField('Sabit kom.', commissionFlat),
                  _numField('Min kom.', minCommission),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('İptal', style: TextStyle(color: _textSecondary)),
              ),
              ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: _neonBlue,
                  foregroundColor: Colors.black,
                ),
                onPressed: () => Navigator.pop(ctx, true),
                child: const Text('Kaydet', style: TextStyle(fontWeight: FontWeight.bold)),
              ),
            ],
          ),
        );
      },
    );

    if (ok != true) return;

    try {
      await ref.read(apiServiceProvider).updateAdminPricingSettings(
            entryDaily: num.tryParse(entryDaily.text) ?? 0,
            entryWeekly: num.tryParse(entryWeekly.text) ?? 0,
            entryMonthly: num.tryParse(entryMonthly.text) ?? 0,
            commissionPercent: num.tryParse(commissionPercent.text) ?? 0,
            commissionFlat: num.tryParse(commissionFlat.text) ?? 0,
            minCommission: num.tryParse(minCommission.text) ?? 0,
          );
      await _loadAll();
    } catch (_) {}
  }

  Future<void> _openBackendOriginDialog() async {
    final current = ref.read(backendOriginProvider);
    final controller = TextEditingController(text: current);
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => Theme(
        data: Theme.of(ctx).copyWith(
          textSelectionTheme: const TextSelectionThemeData(
            cursorColor: _neonBlue,
            selectionColor: Color(0x6600E5FF),
            selectionHandleColor: _neonBlue,
          ),
        ),
        child: AlertDialog(
          backgroundColor: _bg,
          title: const Text('Backend Sunucu Adresi', style: TextStyle(color: Colors.white)),
          content: TextField(
            controller: controller,
            autofocus: true,
            cursorColor: _neonBlue,
            style: GoogleFonts.inter(color: Colors.white),
            keyboardType: TextInputType.url,
            decoration: InputDecoration(
              labelText: 'Örn: http://109.122.21.84:3000',
              labelStyle: GoogleFonts.inter(color: _textSecondary),
              filled: true,
              fillColor: _inputFill,
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: const BorderSide(color: _inputBorder),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: const BorderSide(color: _neonBlue, width: 1.5),
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('İptal', style: TextStyle(color: _textSecondary)),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: _neonBlue,
                foregroundColor: Colors.black,
              ),
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Kaydet', style: TextStyle(fontWeight: FontWeight.bold)),
            ),
          ],
        ),
      ),
    );

    if (ok != true) return;
    final raw = controller.text.trim();
    if (raw.isEmpty) return;
    await ref.read(backendOriginProvider.notifier).setOrigin(raw);
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Backend adresi güncellendi.')),
    );
    await _loadAll();
  }

  static const _inputFill = Color(0xFF151922);
  static const _inputBorder = Color(0xFF30363D);

  Widget _numField(String label, TextEditingController c) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: TextField(
        controller: c,
        cursorColor: _neonBlue,
        style: GoogleFonts.inter(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w500),
        keyboardType: TextInputType.number,
        decoration: InputDecoration(
          filled: true,
          fillColor: _inputFill,
          labelText: label,
          labelStyle: GoogleFonts.inter(color: _textSecondary),
          floatingLabelStyle: GoogleFonts.inter(color: _neonBlue, fontWeight: FontWeight.w500),
          contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: _inputBorder),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: _neonBlue, width: 1.5),
          ),
        ),
      ),
    );
  }

  Widget _driverTextField(
    String label,
    TextEditingController c, {
    bool obscure = false,
    TextInputType keyboardType = TextInputType.text,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: TextField(
        controller: c,
        obscureText: obscure,
        cursorColor: _neonBlue,
        style: GoogleFonts.inter(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w500),
        keyboardType: keyboardType,
        decoration: InputDecoration(
          filled: true,
          fillColor: _inputFill,
          labelText: label,
          labelStyle: GoogleFonts.inter(color: _textSecondary),
          floatingLabelStyle: GoogleFonts.inter(color: _neonBlue, fontWeight: FontWeight.w500),
          contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: _inputBorder),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: _neonBlue, width: 1.5),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(currentUserProvider);
    final backendOrigin = ref.watch(backendOriginProvider);
    final pages = [
      _OverviewTab(overview: _overview, drivers: _drivers, loading: _loading, onRefresh: _loadAll),
      _LiveOpsTab(
        drivers: _liveDrivers,
        rides: _liveRides,
        matching: _matchingItems,
        health: _opsHealth,
        loading: _liveLoading,
        onRefresh: _loadLiveOps,
        onRecoverStale: _recoverStaleSearching,
        onClearMatching: _clearRideMatching,
        statusTr: _statusTr,
      ),
      _OperationsTab(
        segment: _opsSegment,
        onSegmentChanged: (i) async {
          setState(() => _opsSegment = i);
          if (i == 1) await _loadCustomers();
        },
        drivers: _drivers,
        customers: _customers,
        loading: _loading || (_opsSegment == 1 && _customersLoading),
        customerSearchController: _customerSearchController,
        customerSuspendedFilter: _customerSuspendedFilter,
        onCustomerSuspendedFilter: (s) async {
          setState(() => _customerSuspendedFilter = s);
          await _loadCustomers();
        },
        onCustomerSearch: _loadCustomers,
        onCustomerTap: _openCustomerDetail,
        onRefresh: () async {
          if (_opsSegment == 0) {
            await _loadAll();
          } else {
            await _loadCustomers();
          }
        },
        onToggleDriver: _toggleDriverAccess,
        onAddDriverBalance: _addDriverBalance,
        onCreateDriver: _openCreateDriverDialog,
        onEditDriver: _openEditDriverDialog,
        onDeleteDriver: _confirmDeleteDriver,
      ),
      _ReviewsTab(
        reviews: _reviews,
        counts: _reviewCounts,
        selectedRating: _reviewStarFilter,
        loading: _reviewsLoading,
        onRefresh: _loadReviews,
        onFilter: (rating) async {
          setState(() => _reviewStarFilter = rating);
          await _loadReviews();
        },
      ),
      _RidesTab(
        rides: _rides,
        loading: _loading || _ridesLoading,
        statusFilter: _rideStatusFilter,
        searchController: _rideSearchController,
        onStatusFilter: (s) async {
          setState(() => _rideStatusFilter = s);
          await _loadRides();
        },
        onSearch: _loadRides,
        onRefresh: _loadRides,
        onRideTap: _openRideDetail,
        statusTr: _statusTr,
        statusColor: _statusColor,
      ),
      _LogsTab(outLogs: _outLogs, errorLogs: _errorLogs, loading: _loading && _outLogs.isEmpty && _errorLogs.isEmpty, onRefresh: _loadLogs),
      _SettingsTab(
        pricing: _pricing,
        platform: _platform,
        backendOrigin: backendOrigin,
        onEditPricing: _openPricingDialog,
        onEditPlatform: _openPlatformSettingsDialog,
        onEditBackendOrigin: _openBackendOriginDialog,
        onLogout: () async => ref.read(currentUserProvider.notifier).logout(),
      ),
    ];

    return Scaffold(
      backgroundColor: _bg,
      extendBody: true, // For floating bottom bar
      body: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 20, 20, 10),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Hoş Geldin,', style: GoogleFonts.inter(color: _textSecondary, fontSize: 14)),
                      Text('${user?.fullName ?? 'Yönetici'}', style: GoogleFonts.inter(color: Colors.white, fontSize: 22, fontWeight: FontWeight.bold)),
                    ],
                  ),
                  const CircleAvatar(
                    backgroundColor: _neonBlue,
                    child: Icon(Icons.admin_panel_settings, color: Colors.black),
                  ),
                ],
              ),
            ),
            Expanded(child: pages[_menuIndex]),
          ],
        ),
      ),
      bottomNavigationBar: _GlassBottomBar(
        currentIndex: _menuIndex,
        onTap: (i) async {
          setState(() => _menuIndex = i);
          if (i == _liveTabIndex) await _loadLiveOps();
          else if (i == _reviewsTabIndex) await _loadReviews();
          else if (i == _ridesTabIndex) await _loadRides();
          else if (i == _logsTabIndex) await _loadLogs();
          else if (i == _operationsTabIndex && _opsSegment == 1) await _loadCustomers();
          else if (i != _settingsTabIndex) await _refreshOperationalData();
        },
      ),
    );
  }
}

class _GlassBottomBar extends StatelessWidget {
  final int currentIndex;
  final Function(int) onTap;

  const _GlassBottomBar({required this.currentIndex, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(left: 20, right: 20, bottom: 25),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(30),
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 20, sigmaY: 20),
          child: Container(
            height: 65,
            decoration: BoxDecoration(
              color: Colors.white.withOpacity(0.05),
              borderRadius: BorderRadius.circular(30),
              border: Border.all(color: Colors.white.withOpacity(0.1)),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                _navItem(0, Icons.dashboard_rounded),
                _navItem(1, Icons.radar_rounded),
                _navItem(2, Icons.local_taxi_rounded),
                _navItem(3, Icons.star_rate_rounded),
                _navItem(4, Icons.route_rounded),
                _navItem(5, Icons.terminal_rounded),
                _navItem(6, Icons.settings_rounded),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _navItem(int index, IconData icon) {
    final isSelected = currentIndex == index;
    return GestureDetector(
      onTap: () => onTap(index),
      behavior: HitTestBehavior.opaque,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: isSelected ? _neonBlue.withOpacity(0.15) : Colors.transparent,
          shape: BoxShape.circle,
        ),
        child: Icon(
          icon,
          color: isSelected ? _neonBlue : _textSecondary,
          size: isSelected ? 26 : 24,
        ),
      ),
    );
  }
}

class _LiveOpsTab extends StatelessWidget {
  const _LiveOpsTab({
    required this.drivers,
    required this.rides,
    required this.matching,
    required this.health,
    required this.loading,
    required this.onRefresh,
    required this.onRecoverStale,
    required this.onClearMatching,
    required this.statusTr,
  });

  final List<Map<String, dynamic>> drivers;
  final List<Map<String, dynamic>> rides;
  final List<Map<String, dynamic>> matching;
  final Map<String, dynamic> health;
  final bool loading;
  final Future<void> Function() onRefresh;
  final Future<void> Function() onRecoverStale;
  final Future<void> Function(String rideId) onClearMatching;
  final String Function(String? status) statusTr;

  Set<Marker> _buildMarkers() {
    final markers = <Marker>{};
    for (final d in drivers) {
      final lat = (d['lat'] as num?)?.toDouble();
      final lng = (d['lng'] as num?)?.toDouble();
      if (lat == null || lng == null) continue;
      markers.add(
        Marker(
          markerId: MarkerId('drv_${d['id']}'),
          position: LatLng(lat, lng),
          icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueAzure),
          infoWindow: InfoWindow(
            title: '${d['full_name'] ?? 'Sürücü'}',
            snippet: '${d['vehicle_plate'] ?? ''}',
          ),
        ),
      );
    }
    for (final r in rides) {
      final lat = (r['pickup_lat'] as num?)?.toDouble();
      final lng = (r['pickup_lng'] as num?)?.toDouble();
      if (lat == null || lng == null) continue;
      final status = '${r['status']}';
      final hue = status == 'searching'
          ? BitmapDescriptor.hueOrange
          : status == 'in_progress'
              ? BitmapDescriptor.hueGreen
              : BitmapDescriptor.hueYellow;
      markers.add(
        Marker(
          markerId: MarkerId('ride_${r['id']}'),
          position: LatLng(lat, lng),
          icon: BitmapDescriptor.defaultMarkerWithHue(hue),
          infoWindow: InfoWindow(
            title: statusTr(status),
            snippet: '${r['customer_name'] ?? 'Yolcu'} · ${r['pickup_address'] ?? ''}',
          ),
        ),
      );
    }
    return markers;
  }

  Widget _healthChip(String label, bool ok) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: (ok ? Colors.greenAccent : Colors.redAccent).withOpacity(0.15),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: ok ? Colors.greenAccent : Colors.redAccent, width: 0.8),
      ),
      child: Text(
        label,
        style: GoogleFonts.inter(
          color: ok ? Colors.greenAccent : Colors.redAccent,
          fontSize: 11,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (loading && drivers.isEmpty && rides.isEmpty) {
      return const Center(child: CircularProgressIndicator(color: _neonBlue));
    }

    final redisOk = health['redis'] == 'ok';
    final dbOk = health['database'] == 'ok';
    final markers = _buildMarkers();
    final initial = markers.isNotEmpty
        ? markers.first.position
        : const LatLng(AppConstants.defaultLat, AppConstants.defaultLng);

    return RefreshIndicator(
      color: _neonBlue,
      backgroundColor: _bg,
      onRefresh: onRefresh,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 10, 20, 100),
        children: [
          Text(
            'CANLI OPERASYON',
            style: GoogleFonts.inter(
              color: _textSecondary,
              fontSize: 12,
              fontWeight: FontWeight.w600,
              letterSpacing: 1.2,
            ),
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              _healthChip('Redis', redisOk),
              _healthChip('DB', dbOk),
              _healthChip(
                'Socket sürücü: ${health['onlineDriversSocket'] ?? 0}',
                true,
              ),
              _healthChip(
                'Aranan: ${health['searchingRides'] ?? 0}',
                (health['searchingRides'] as num? ?? 0) == 0,
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: loading ? null : onRefresh,
                  icon: const Icon(Icons.refresh, color: _neonBlue, size: 18),
                  label: Text('Yenile', style: GoogleFonts.inter(color: _neonBlue)),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: loading ? null : onRecoverStale,
                  icon: const Icon(Icons.cleaning_services, color: Colors.orangeAccent, size: 18),
                  label: Text(
                    'Eski arama',
                    style: GoogleFonts.inter(color: Colors.orangeAccent, fontSize: 12),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          ClipRRect(
            borderRadius: BorderRadius.circular(16),
            child: SizedBox(
              height: 280,
              child: GoogleMap(
                initialCameraPosition: CameraPosition(target: initial, zoom: 12),
                markers: markers,
                myLocationEnabled: false,
                zoomControlsEnabled: true,
                mapToolbarEnabled: false,
              ),
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Mavi: çevrimiçi sürücü · Turuncu: aranıyor · Sarı/yeşil: aktif yolculuk',
            style: GoogleFonts.inter(color: _textSecondary, fontSize: 11),
          ),
          const SizedBox(height: 16),
          Text(
            'EŞLEŞTİRME (searching)',
            style: GoogleFonts.inter(
              color: _textSecondary,
              fontSize: 12,
              fontWeight: FontWeight.w600,
              letterSpacing: 1.1,
            ),
          ),
          const SizedBox(height: 8),
          if (matching.isEmpty)
            Text(
              'Aranan yolculuk yok.',
              style: GoogleFonts.inter(color: _textSecondary),
            )
          else
            ...matching.map((item) {
              final m = (item['matching'] as Map?) ?? {};
              final rideId = '${item['id']}';
              return GlassCard(
                margin: const EdgeInsets.only(bottom: 10),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${item['customer_name'] ?? 'Yolcu'}',
                      style: GoogleFonts.inter(color: Colors.white, fontWeight: FontWeight.bold),
                    ),
                    Text(
                      '${item['pickup_address'] ?? ''}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: GoogleFonts.inter(color: _textSecondary, fontSize: 12),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'Kuyruk: ${m['driversQueued'] ?? 0} · Sorulan: ${m['driversAsked'] ?? 0} · Kalan: ${m['queueRemaining'] ?? 0}',
                      style: GoogleFonts.inter(color: _neonBlue, fontSize: 11),
                    ),
                    if (m['pendingDriverId'] != null)
                      Text(
                        'Bekleyen teklif: ${m['pendingDriverId']} · ${m['offerSecondsLeft'] ?? '-'} sn',
                        style: GoogleFonts.inter(color: Colors.orangeAccent, fontSize: 11),
                      ),
                    if ((m['rejectedDriverIds'] as List?)?.isNotEmpty == true)
                      Text(
                        'Red: ${(m['rejectedDriverIds'] as List).length} sürücü',
                        style: GoogleFonts.inter(color: _textSecondary, fontSize: 11),
                      ),
                    Align(
                      alignment: Alignment.centerRight,
                      child: TextButton(
                        onPressed: () => onClearMatching(rideId),
                        child: Text(
                          'Kuyruğu temizle',
                          style: GoogleFonts.inter(color: Colors.redAccent, fontWeight: FontWeight.w600),
                        ),
                      ),
                    ),
                  ],
                ),
              );
            }),
          const SizedBox(height: 8),
          Text(
            'AKTİF YOLCULUK (${rides.length})',
            style: GoogleFonts.inter(
              color: _textSecondary,
              fontSize: 12,
              fontWeight: FontWeight.w600,
              letterSpacing: 1.1,
            ),
          ),
          const SizedBox(height: 8),
          ...rides.take(15).map((r) {
            final status = '${r['status']}';
            return Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Text(
                '${statusTr(status)} · ${r['customer_name'] ?? '-'} → ${r['driver_name'] ?? '-'}',
                style: GoogleFonts.inter(color: Colors.white70, fontSize: 12),
              ),
            );
          }),
        ],
      ),
    );
  }
}

class _OverviewTab extends StatelessWidget {
  const _OverviewTab({required this.overview, required this.drivers, required this.loading, required this.onRefresh});
  final Map<String, dynamic> overview;
  final List<Map<String, dynamic>> drivers;
  final bool loading;
  final Future<void> Function() onRefresh;

  @override
  Widget build(BuildContext context) {
    if (loading) return const Center(child: CircularProgressIndicator(color: _neonBlue));
    final onlineDrivers = drivers.where((d) => d['is_online'] == true).toList();
    
    return RefreshIndicator(
      color: _neonBlue,
      backgroundColor: _bg,
      onRefresh: onRefresh,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 10, 20, 100),
        children: [
          Text('CANLI DURUM', style: GoogleFonts.inter(color: _textSecondary, fontSize: 12, fontWeight: FontWeight.w600, letterSpacing: 1.2)),
          const SizedBox(height: 12),
          GlassCard(
            padding: const EdgeInsets.all(20),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Bugünkü Ciro', style: GoogleFonts.inter(color: _textSecondary, fontSize: 13)),
                      const SizedBox(height: 6),
                      Text('${overview['revenueToday'] ?? 0} TL', style: GoogleFonts.inter(color: Colors.white, fontSize: 32, fontWeight: FontWeight.bold)),
                    ],
                  ),
                ),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: _neonPurple.withOpacity(0.1),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(Icons.payments_rounded, color: _neonPurple, size: 30),
                )
              ],
            ),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(child: _GradientCard(title: 'Aktif Sürüş', value: '${overview['activeRides'] ?? 0}', icon: Icons.route_rounded, color: _neonBlue)),
              const SizedBox(width: 16),
              Expanded(child: _GradientCard(title: 'Çevrimiçi Şoför', value: '${onlineDrivers.length}', icon: Icons.wifi_tethering_rounded, color: Colors.greenAccent)),
            ],
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(child: _MetricCardGlass(title: 'T. Yolcu', value: '${overview['users'] ?? 0}', icon: Icons.people)),
              const SizedBox(width: 16),
              Expanded(child: _MetricCardGlass(title: 'T. Sürücü', value: '${overview['drivers'] ?? 0}', icon: Icons.local_taxi)),
            ],
          )
        ],
      ),
    );
  }
}

class _GradientCard extends StatelessWidget {
  final String title;
  final String value;
  final IconData icon;
  final Color color;

  const _GradientCard({required this.title, required this.value, required this.icon, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(16),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [color.withOpacity(0.2), color.withOpacity(0.05)],
        ),
        border: Border.all(color: color.withOpacity(0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: color, size: 24),
          const SizedBox(height: 12),
          Text(value, style: GoogleFonts.inter(color: Colors.white, fontSize: 26, fontWeight: FontWeight.bold)),
          Text(title, style: GoogleFonts.inter(color: _textSecondary, fontSize: 13)),
        ],
      ),
    );
  }
}

class _MetricCardGlass extends StatelessWidget {
  final String title;
  final String value;
  final IconData icon;
  const _MetricCardGlass({required this.title, required this.value, required this.icon});

  @override
  Widget build(BuildContext context) {
    return GlassCard(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: _textSecondary, size: 22),
          const SizedBox(height: 12),
          Text(value, style: GoogleFonts.inter(color: Colors.white, fontSize: 22, fontWeight: FontWeight.bold)),
          Text(title, style: GoogleFonts.inter(color: _textSecondary, fontSize: 12)),
        ],
      ),
    );
  }
}

class _OperationsTab extends StatelessWidget {
  const _OperationsTab({
    required this.segment,
    required this.onSegmentChanged,
    required this.drivers,
    required this.customers,
    required this.loading,
    required this.customerSearchController,
    required this.customerSuspendedFilter,
    required this.onCustomerSuspendedFilter,
    required this.onCustomerSearch,
    required this.onCustomerTap,
    required this.onRefresh,
    required this.onToggleDriver,
    required this.onAddDriverBalance,
    required this.onCreateDriver,
    required this.onEditDriver,
    required this.onDeleteDriver,
  });

  final int segment;
  final ValueChanged<int> onSegmentChanged;
  final List<Map<String, dynamic>> drivers;
  final List<Map<String, dynamic>> customers;
  final bool loading;
  final TextEditingController customerSearchController;
  final String customerSuspendedFilter;
  final Future<void> Function(String filter) onCustomerSuspendedFilter;
  final Future<void> Function() onCustomerSearch;
  final Future<void> Function(Map<String, dynamic> customer) onCustomerTap;
  final Future<void> Function() onRefresh;
  final Future<void> Function(String id, bool enabled) onToggleDriver;
  final Future<void> Function(String driverId, String driverName, double currentBalance) onAddDriverBalance;
  final Future<void> Function() onCreateDriver;
  final Future<void> Function(Map<String, dynamic> driver) onEditDriver;
  final Future<void> Function(Map<String, dynamic> driver) onDeleteDriver;

  @override
  Widget build(BuildContext context) {
    if (loading && (segment == 0 ? drivers.isEmpty : customers.isEmpty)) {
      return const Center(child: CircularProgressIndicator(color: _neonBlue));
    }

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: Row(
            children: [
              Expanded(
                child: _segmentBtn(0, 'Sürücüler', segment == 0, onSegmentChanged),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _segmentBtn(1, 'Yolcular', segment == 1, onSegmentChanged),
              ),
            ],
          ),
        ),
        const SizedBox(height: 8),
        Expanded(
          child: segment == 0
              ? _buildDriversList(context)
              : _CustomersList(
                  customers: customers,
                  loading: loading,
                  searchController: customerSearchController,
                  suspendedFilter: customerSuspendedFilter,
                  onSuspendedFilter: onCustomerSuspendedFilter,
                  onSearch: onCustomerSearch,
                  onRefresh: onRefresh,
                  onTap: onCustomerTap,
                ),
        ),
      ],
    );
  }

  Widget _segmentBtn(int index, String label, bool selected, ValueChanged<int> onTap) {
    return Material(
      color: selected ? _neonBlue.withOpacity(0.2) : const Color(0xFF151922),
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => onTap(index),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 12),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: selected ? _neonBlue : const Color(0xFF30363D)),
          ),
          child: Text(
            label,
            style: GoogleFonts.inter(
              color: selected ? _neonBlue : _textSecondary,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildDriversList(BuildContext context) {
    return RefreshIndicator(
      color: _neonBlue,
      backgroundColor: _bg,
      onRefresh: onRefresh,
      child: ListView.builder(
        padding: const EdgeInsets.fromLTRB(20, 10, 20, 100),
        itemCount: drivers.length + 1,
        itemBuilder: (context, index) {
          if (index == 0) {
            return Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      'SÜRÜCÜ LİSTESİ',
                      style: GoogleFonts.inter(
                        color: _textSecondary,
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        letterSpacing: 1.2,
                      ),
                    ),
                  ),
                  TextButton.icon(
                    onPressed: onCreateDriver,
                    icon: const Icon(Icons.person_add_alt_1, color: _neonBlue, size: 20),
                    label: Text('Yeni sürücü', style: GoogleFonts.inter(color: _neonBlue, fontWeight: FontWeight.w700)),
                  ),
                ],
              ),
            );
          }
          final d = drivers[index - 1];
          final user = (d['users'] as Map?) ?? {};
          final enabled = d['is_available'] == true;
          final isOnline = d['is_online'] == true;
          final name = '${user['full_name'] ?? '-'}';
          final id = '${d['id'] ?? ''}';
          final balance = (d['balance'] as num?)?.toDouble() ?? 0;

          return GlassCard(
            margin: const EdgeInsets.only(bottom: 12),
            padding: const EdgeInsets.all(16),
            child: Column(
              children: [
                Row(
                  children: [
                    CircleAvatar(
                      backgroundColor: Colors.white.withOpacity(0.1),
                      child: Text(name.isNotEmpty ? name[0] : '?', style: const TextStyle(color: Colors.white)),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(name, style: GoogleFonts.inter(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16)),
                          const SizedBox(height: 2),
                          Row(
                            children: [
                              Container(
                                width: 8, height: 8,
                                decoration: BoxDecoration(
                                  shape: BoxShape.circle,
                                  color: isOnline ? Colors.greenAccent : Colors.redAccent,
                                  boxShadow: [
                                    if(isOnline) BoxShadow(color: Colors.greenAccent.withOpacity(0.5), blurRadius: 4)
                                  ]
                                ),
                              ),
                              const SizedBox(width: 6),
                              Text(d['vehicle_plate'] ?? '-', style: GoogleFonts.inter(color: _textSecondary, fontSize: 13)),
                            ],
                          )
                        ],
                      ),
                    ),
                    Switch(
                      value: enabled,
                      activeColor: _neonBlue,
                      onChanged: (v) => onToggleDriver(id, v),
                    )
                  ],
                ),
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  decoration: BoxDecoration(color: Colors.black.withOpacity(0.3), borderRadius: BorderRadius.circular(8)),
                  child: Row(
                    children: [
                      const Icon(Icons.account_balance_wallet, color: _neonBlue, size: 16),
                      const SizedBox(width: 8),
                      Text('${balance.toStringAsFixed(0)} T Coin', style: GoogleFonts.inter(color: Colors.white, fontWeight: FontWeight.bold)),
                      const Spacer(),
                      GestureDetector(
                        onTap: () => onAddDriverBalance(id, name, balance),
                        child: Text('+ Ekle', style: GoogleFonts.inter(color: _neonBlue, fontWeight: FontWeight.bold)),
                      )
                    ],
                  ),
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    TextButton(
                      onPressed: () => onEditDriver(d),
                      child: Text('Düzenle', style: GoogleFonts.inter(color: _neonBlue, fontWeight: FontWeight.w600)),
                    ),
                    TextButton(
                      onPressed: () => onDeleteDriver(d),
                      child: Text('Sil', style: GoogleFonts.inter(color: Colors.redAccent, fontWeight: FontWeight.w600)),
                    ),
                  ],
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _CustomersList extends StatelessWidget {
  const _CustomersList({
    required this.customers,
    required this.loading,
    required this.searchController,
    required this.suspendedFilter,
    required this.onSuspendedFilter,
    required this.onSearch,
    required this.onRefresh,
    required this.onTap,
  });

  final List<Map<String, dynamic>> customers;
  final bool loading;
  final TextEditingController searchController;
  final String suspendedFilter;
  final Future<void> Function(String filter) onSuspendedFilter;
  final Future<void> Function() onSearch;
  final Future<void> Function() onRefresh;
  final Future<void> Function(Map<String, dynamic> customer) onTap;

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      color: _neonBlue,
      backgroundColor: _bg,
      onRefresh: onRefresh,
      child: ListView.builder(
        padding: const EdgeInsets.fromLTRB(20, 10, 20, 100),
        itemCount: customers.isEmpty ? 2 : customers.length + 1,
        itemBuilder: (context, index) {
          if (index == 0) {
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'YOLCU LİSTESİ',
                  style: GoogleFonts.inter(
                    color: _textSecondary,
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    letterSpacing: 1.2,
                  ),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: searchController,
                  style: GoogleFonts.inter(color: Colors.white),
                  decoration: InputDecoration(
                    hintText: 'Ad veya telefon…',
                    hintStyle: GoogleFonts.inter(color: _textSecondary, fontSize: 13),
                    filled: true,
                    fillColor: const Color(0xFF151922),
                    suffixIcon: IconButton(
                      icon: const Icon(Icons.search, color: _neonBlue),
                      onPressed: onSearch,
                    ),
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  onSubmitted: (_) => onSearch(),
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    _chip('all', 'Tümü'),
                    const SizedBox(width: 8),
                    _chip('false', 'Aktif'),
                    const SizedBox(width: 8),
                    _chip('true', 'Askıda'),
                  ],
                ),
                const SizedBox(height: 12),
              ],
            );
          }
          if (customers.isEmpty) {
            return Text(
              'Kayıt bulunamadı.',
              textAlign: TextAlign.center,
              style: GoogleFonts.inter(color: _textSecondary),
            );
          }
          final c = customers[index - 1];
          final suspended = c['is_suspended'] == true;
          final active = c['has_active_ride'] == true;
          return GestureDetector(
            onTap: () => onTap(c),
            child: GlassCard(
              margin: const EdgeInsets.only(bottom: 12),
              child: Row(
                children: [
                  CircleAvatar(
                    backgroundColor: suspended ? Colors.redAccent.withOpacity(0.3) : _neonPurple.withOpacity(0.3),
                    child: Icon(
                      suspended ? Icons.block : Icons.person,
                      color: suspended ? Colors.redAccent : _neonPurple,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${c['full_name'] ?? '-'}',
                          style: GoogleFonts.inter(color: Colors.white, fontWeight: FontWeight.bold),
                        ),
                        Text(
                          '${c['phone'] ?? ''}',
                          style: GoogleFonts.inter(color: _textSecondary, fontSize: 12),
                        ),
                        Text(
                          '${c['completed_rides'] ?? 0} yolculuk · ★ ${c['rating'] ?? 5}',
                          style: GoogleFonts.inter(color: _textSecondary, fontSize: 11),
                        ),
                        if (active)
                          Text(
                            'Aktif yolculuk',
                            style: GoogleFonts.inter(color: Colors.orangeAccent, fontSize: 11),
                          ),
                      ],
                    ),
                  ),
                  const Icon(Icons.chevron_right, color: _textSecondary),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _chip(String value, String label) {
    final selected = suspendedFilter == value;
    return FilterChip(
      label: Text(label),
      selected: selected,
      onSelected: (_) => onSuspendedFilter(value),
      backgroundColor: const Color(0xFF151922),
      selectedColor: _neonBlue.withOpacity(0.25),
      labelStyle: GoogleFonts.inter(
        color: selected ? _neonBlue : _textSecondary,
        fontSize: 12,
        fontWeight: FontWeight.w600,
      ),
      side: BorderSide(color: selected ? _neonBlue : const Color(0xFF30363D)),
    );
  }
}

class _RidesTab extends StatelessWidget {
  const _RidesTab({
    required this.rides,
    required this.loading,
    required this.statusFilter,
    required this.searchController,
    required this.onStatusFilter,
    required this.onSearch,
    required this.onRefresh,
    required this.onRideTap,
    required this.statusTr,
    required this.statusColor,
  });

  final List<Map<String, dynamic>> rides;
  final bool loading;
  final String statusFilter;
  final TextEditingController searchController;
  final Future<void> Function(String status) onStatusFilter;
  final Future<void> Function() onSearch;
  final Future<void> Function() onRefresh;
  final Future<void> Function(Map<String, dynamic> ride) onRideTap;
  final String Function(String? status) statusTr;
  final Color Function(String? status) statusColor;

  static const _filters = [
    ('all', 'Tümü'),
    ('searching', 'Aranıyor'),
    ('accepted', 'Kabul'),
    ('arriving', 'Geliyor'),
    ('in_progress', 'Yolculukta'),
    ('completed', 'Bitti'),
    ('cancelled', 'İptal'),
  ];

  @override
  Widget build(BuildContext context) {
    if (loading && rides.isEmpty) {
      return const Center(child: CircularProgressIndicator(color: _neonBlue));
    }
    return RefreshIndicator(
      color: _neonBlue,
      backgroundColor: _bg,
      onRefresh: onRefresh,
      child: ListView.builder(
        padding: const EdgeInsets.fromLTRB(20, 10, 20, 100),
        itemCount: rides.isEmpty ? 2 : rides.length + 1,
        itemBuilder: (context, index) {
          if (index == 0) {
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'YOLCULUKLAR',
                  style: GoogleFonts.inter(
                    color: _textSecondary,
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    letterSpacing: 1.2,
                  ),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: searchController,
                  style: GoogleFonts.inter(color: Colors.white),
                  decoration: InputDecoration(
                    hintText: 'Ad, telefon veya adres…',
                    hintStyle: GoogleFonts.inter(color: _textSecondary, fontSize: 13),
                    filled: true,
                    fillColor: const Color(0xFF151922),
                    suffixIcon: IconButton(
                      icon: const Icon(Icons.search, color: _neonBlue),
                      onPressed: onSearch,
                    ),
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  onSubmitted: (_) => onSearch(),
                ),
                const SizedBox(height: 10),
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: _filters.map((f) {
                      final selected = statusFilter == f.$1;
                      return Padding(
                        padding: const EdgeInsets.only(right: 8),
                        child: FilterChip(
                          label: Text(f.$2),
                          selected: selected,
                          onSelected: (_) => onStatusFilter(f.$1),
                          backgroundColor: const Color(0xFF151922),
                          selectedColor: _neonBlue.withOpacity(0.25),
                          labelStyle: GoogleFonts.inter(
                            color: selected ? _neonBlue : _textSecondary,
                            fontWeight: FontWeight.w600,
                            fontSize: 12,
                          ),
                          side: BorderSide(
                            color: selected ? _neonBlue : const Color(0xFF30363D),
                          ),
                        ),
                      );
                    }).toList(),
                  ),
                ),
                const SizedBox(height: 12),
              ],
            );
          }
          if (rides.isEmpty && index == 1) {
            return Padding(
              padding: const EdgeInsets.only(top: 24),
              child: Text(
                'Kayıt bulunamadı.',
                textAlign: TextAlign.center,
                style: GoogleFonts.inter(color: _textSecondary),
              ),
            );
          }
          final r = rides[index - 1];
          final status = '${r['status'] ?? '-'}';
          final color = statusColor(status);
          final price = r['final_price'] ?? r['estimated_price'] ?? 0;

          return GestureDetector(
            onTap: () => onRideTap(r),
            child: GlassCard(
              margin: const EdgeInsets.only(bottom: 12),
              child: Row(
                children: [
                  Container(
                    width: 4,
                    height: 48,
                    decoration: BoxDecoration(
                      color: color,
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${r['customer_name'] ?? 'Yolcu'} → ${r['driver_name'] ?? '-'}',
                          style: GoogleFonts.inter(
                            color: Colors.white,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          statusTr(status),
                          style: GoogleFonts.inter(color: color, fontSize: 11, fontWeight: FontWeight.w600),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          '${r['pickup_address']}',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: GoogleFonts.inter(color: _textSecondary, fontSize: 12),
                        ),
                      ],
                    ),
                  ),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(
                        '$price TL',
                        style: GoogleFonts.inter(color: Colors.white, fontWeight: FontWeight.bold),
                      ),
                      const Icon(Icons.chevron_right, color: _textSecondary, size: 20),
                    ],
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}

String _formatReviewDate(String iso) {
  try {
    final d = DateTime.parse(iso).toLocal();
    final dd = d.day.toString().padLeft(2, '0');
    final mm = d.month.toString().padLeft(2, '0');
    final hh = d.hour.toString().padLeft(2, '0');
    final mi = d.minute.toString().padLeft(2, '0');
    return '$dd.$mm.${d.year} $hh:$mi';
  } catch (_) {
    return iso;
  }
}

String _roleTr(String? role) => role == 'driver' ? 'Sürücü' : 'Yolcu';

class _ReviewsTab extends StatelessWidget {
  const _ReviewsTab({
    required this.reviews,
    required this.counts,
    required this.selectedRating,
    required this.loading,
    required this.onRefresh,
    required this.onFilter,
  });

  final List<Map<String, dynamic>> reviews;
  final Map<int, int> counts;
  final int? selectedRating;
  final bool loading;
  final Future<void> Function() onRefresh;
  final Future<void> Function(int? rating) onFilter;

  Widget _starChip(BuildContext context, {required int? stars, required String label}) {
    final selected = selectedRating == stars;
    final count = stars == null
        ? counts.values.fold<int>(0, (a, b) => a + b)
        : (counts[stars] ?? 0);
    return FilterChip(
      label: Text('$label ($count)'),
      selected: selected,
      onSelected: (_) => onFilter(stars),
      labelStyle: GoogleFonts.inter(
        color: selected ? Colors.black : Colors.white,
        fontSize: 12,
        fontWeight: selected ? FontWeight.w600 : FontWeight.normal,
      ),
      selectedColor: stars != null && stars <= 2 ? Colors.red.shade300 : _neonBlue,
      backgroundColor: const Color(0xFF151922),
      side: BorderSide(color: selected ? _neonBlue : const Color(0xFF30363D)),
      showCheckmark: false,
    );
  }

  Widget _starsRow(int rating) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: List.generate(
        5,
        (i) => Icon(
          i < rating ? Icons.star_rounded : Icons.star_outline_rounded,
          size: 18,
          color: i < rating
              ? (rating <= 2 ? Colors.redAccent : Colors.amber)
              : _textSecondary,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (loading && reviews.isEmpty) {
      return const Center(child: CircularProgressIndicator(color: _neonBlue));
    }

    return RefreshIndicator(
      color: _neonBlue,
      backgroundColor: _bg,
      onRefresh: onRefresh,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 10, 20, 100),
        children: [
          Text(
            'DEĞERLENDİRMELER',
            style: GoogleFonts.inter(
              color: _textSecondary,
              fontSize: 12,
              fontWeight: FontWeight.w600,
              letterSpacing: 1.2,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            '1–2 yıldızlı yeni değerlendirmeler admin cihazına push bildirimi gönderir.',
            style: GoogleFonts.inter(color: _textSecondary, fontSize: 12, height: 1.35),
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              _starChip(context, stars: null, label: 'Tümü'),
              for (var s = 5; s >= 1; s--) _starChip(context, stars: s, label: '$s ★'),
            ],
          ),
          const SizedBox(height: 16),
          if (reviews.isEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 48),
              child: Center(
                child: Text(
                  'Bu filtrede değerlendirme yok.',
                  style: GoogleFonts.inter(color: _textSecondary),
                ),
              ),
            )
          else
            ...reviews.map((r) {
              final rating = (r['rating'] as num?)?.toInt() ?? 0;
              final reviewer = Map<String, dynamic>.from((r['reviewer'] as Map?) ?? {});
              final reviewed = Map<String, dynamic>.from((r['reviewed'] as Map?) ?? {});
              final ride = Map<String, dynamic>.from((r['ride'] as Map?) ?? {});
              final comment = (r['comment'] as String?)?.trim() ?? '';
              final low = rating <= 2;

              return Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: GlassCard(
                  padding: const EdgeInsets.all(14),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          _starsRow(rating),
                          const Spacer(),
                          Text(
                            _formatReviewDate('${r['created_at'] ?? ''}'),
                            style: GoogleFonts.inter(color: _textSecondary, fontSize: 11),
                          ),
                        ],
                      ),
                      if (low) ...[
                        const SizedBox(height: 8),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                          decoration: BoxDecoration(
                            color: Colors.red.withOpacity(0.15),
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Text(
                            'Düşük puan',
                            style: GoogleFonts.inter(
                              color: Colors.redAccent,
                              fontSize: 11,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      ],
                      const SizedBox(height: 10),
                      Text(
                        '${reviewer['full_name'] ?? '—'} (${_roleTr(reviewer['role'] as String?)})',
                        style: GoogleFonts.inter(color: Colors.white, fontWeight: FontWeight.w600),
                      ),
                      Text(
                        '→ ${reviewed['full_name'] ?? '—'} (${_roleTr(reviewed['role'] as String?)})',
                        style: GoogleFonts.inter(color: _textSecondary, fontSize: 13),
                      ),
                      if (ride.isNotEmpty) ...[
                        const SizedBox(height: 8),
                        Text(
                          '${ride['pickup_address'] ?? ''}',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: GoogleFonts.inter(color: _textSecondary, fontSize: 12),
                        ),
                        Text(
                          '→ ${ride['dropoff_address'] ?? ''}',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: GoogleFonts.inter(color: _textSecondary, fontSize: 12),
                        ),
                      ],
                      if (comment.isNotEmpty) ...[
                        const SizedBox(height: 8),
                        Text(
                          comment,
                          style: GoogleFonts.inter(color: Colors.white70, fontSize: 13),
                        ),
                      ],
                    ],
                  ),
                ),
              );
            }),
        ],
      ),
    );
  }
}

const _broadcastFieldFill = Color(0xFF151922);
const _broadcastFieldBorder = Color(0xFF30363D);

enum _BroadcastAudience { all, customers, drivers, user }

class _BroadcastTemplate {
  const _BroadcastTemplate({
    required this.label,
    required this.title,
    required this.body,
    this.audience,
  });

  final String label;
  final String title;
  final String body;
  final _BroadcastAudience? audience;
}

const _broadcastTemplates = <_BroadcastTemplate>[
  _BroadcastTemplate(
    label: '🚦 Yoğun saat',
    title: 'Yoğun saatler 📈',
    body:
        'Şu an talep yoğun! Lütfen çevrimiçi olun — yolcular sizi bekliyor. 🚕💨',
    audience: _BroadcastAudience.drivers,
  ),
  _BroadcastTemplate(
    label: '🟢 Çevrimiçi ol',
    title: 'Çevrimiçi olun 🟢',
    body: 'Bölgede çağrı var. Uygulamayı açıp çevrimiçi kalın, kazanç kaçmasın! 💰',
    audience: _BroadcastAudience.drivers,
  ),
  _BroadcastTemplate(
    label: '☀️ Günaydın',
    title: 'Günaydın ☀️',
    body: 'İyi günler! Bugün yoğun olabilir — erken çevrimiçi olan sürücüler öne çıkar. 🚕',
    audience: _BroadcastAudience.drivers,
  ),
  _BroadcastTemplate(
    label: '🌙 Gece turu',
    title: 'Gece turu başladı 🌙',
    body: 'Gece saatlerinde talep artıyor. Çevrimiçi kal, güvenli sürüş! 🌃🚕',
    audience: _BroadcastAudience.drivers,
  ),
  _BroadcastTemplate(
    label: '🔋 T-Coin',
    title: 'Bakiye hatırlatması 🔋',
    body:
        'Çevrimiçi olmak için yeterli T-Coin bakiyeniz olsun. Cüzdanınızı kontrol edin. 💳',
    audience: _BroadcastAudience.drivers,
  ),
  _BroadcastTemplate(
    label: '🚕 Hızlı taksi',
    title: 'Taksi bir dokunuş uzağında 🚕',
    body: 'İhtiyacın olduğunda Taksim Gelsin yanında. Hemen çağır, sürücün gelsin! ✨',
    audience: _BroadcastAudience.customers,
  ),
  _BroadcastTemplate(
    label: '🎁 Kampanya',
    title: 'Sana özel fırsat 🎁',
    body: 'Bu hafta yoğun saatlerde hızlı eşleşme! Uygulamayı aç, yolculuğunu başlat. 🎉',
    audience: _BroadcastAudience.customers,
  ),
  _BroadcastTemplate(
    label: '⏱️ Kısa bekleme',
    title: 'Dakikalar içinde kapında ⏱️',
    body: 'Çevrimdeki sürücülerle kısa bekleme süresi. Şimdi taksi çağır! 📍',
    audience: _BroadcastAudience.customers,
  ),
  _BroadcastTemplate(
    label: '📢 Duyuru',
    title: 'Önemli duyuru 📢',
    body: 'Taksim Gelsin ailesi için bilgilendirme. Detaylar uygulama içinde. ℹ️',
    audience: _BroadcastAudience.all,
  ),
  _BroadcastTemplate(
    label: '🔧 Bakım',
    title: 'Planlı bakım 🔧',
    body:
        'Kısa süreli bakım yapılabilir. Sorun yaşarsanız destek hattımız yanınızda. 🙏',
    audience: _BroadcastAudience.all,
  ),
  _BroadcastTemplate(
    label: '🙏 Teşekkür',
    title: 'Teşekkürler 🙏',
    body: 'Bizi tercih ettiğiniz için teşekkürler! İyi yolculuklar dileriz. ❤️',
    audience: _BroadcastAudience.all,
  ),
];

/// Admin — hedef kitleye FCM duyurusu.
class _AdminBroadcastSection extends StatefulWidget {
  const _AdminBroadcastSection({required this.api});
  final ApiService api;

  @override
  State<_AdminBroadcastSection> createState() => _AdminBroadcastSectionState();
}

class _AdminBroadcastSectionState extends State<_AdminBroadcastSection> {
  final _titleCtrl = TextEditingController();
  final _bodyCtrl = TextEditingController();
  final _phoneCtrl = TextEditingController();
  _BroadcastAudience _audience = _BroadcastAudience.all;
  bool _sending = false;

  @override
  void dispose() {
    _titleCtrl.dispose();
    _bodyCtrl.dispose();
    _phoneCtrl.dispose();
    super.dispose();
  }

  String get _audienceApiValue {
    switch (_audience) {
      case _BroadcastAudience.all:
        return 'all';
      case _BroadcastAudience.customers:
        return 'customers';
      case _BroadcastAudience.drivers:
        return 'drivers';
      case _BroadcastAudience.user:
        return 'user';
    }
  }

  String get _audienceLabel {
    switch (_audience) {
      case _BroadcastAudience.all:
        return 'Tüm kullanıcılar';
      case _BroadcastAudience.customers:
        return 'Yolcular';
      case _BroadcastAudience.drivers:
        return 'Sürücüler';
      case _BroadcastAudience.user:
        return 'Tek kişi';
    }
  }

  Future<void> _send() async {
    final title = _titleCtrl.text.trim();
    final body = _bodyCtrl.text.trim();
    if (title.isEmpty || body.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Başlık ve mesaj gerekli.')),
      );
      return;
    }

    String? targetPhone;
    if (_audience == _BroadcastAudience.user) {
      targetPhone = normalizeTrPhoneE164(_phoneCtrl.text);
      if (targetPhone == null) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Geçerli telefon girin (ör. +905551112233 veya 05551112233).'),
          ),
        );
        return;
      }
    }

    final confirmDetail = _audience == _BroadcastAudience.user
        ? 'Bu mesaj yalnızca $targetPhone numaralı kullanıcının kayıtlı cihazlarına gidecek. Devam?'
        : 'Kayıtlı push bildirimi olan hedef: $_audienceLabel. Devam?';

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF151922),
        title: Text('$_audienceLabel — gönder', style: GoogleFonts.inter(color: Colors.white)),
        content: Text(
          confirmDetail,
          style: GoogleFonts.inter(color: _textSecondary, fontSize: 14),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: Text('İptal', style: GoogleFonts.inter(color: _textSecondary)),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Gönder'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    setState(() => _sending = true);
    try {
      final res = await widget.api.postAdminBroadcastPush(
        title: title,
        body: body,
        audience: _audienceApiValue,
        phone: targetPhone,
      );
      final map = res.data;
      if (!mounted) return;
      if (map is Map && map['success'] == true) {
        final d = map['data'] as Map?;
        final total = d?['totalTokens'] ?? 0;
        final ok = d?['successCount'] ?? 0;
        final fail = d?['failureCount'] ?? 0;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'Tamamlandı: $total cihaz hedeflendi, başarılı $ok, başarısız $fail.',
              style: const TextStyle(color: Colors.white),
            ),
            backgroundColor: const Color(0xFF1B5E20),
          ),
        );
        _titleCtrl.clear();
        _bodyCtrl.clear();
      } else if (map is Map) {
        final err = map['error']?.toString() ?? 'Bilinmeyen hata';
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(err), backgroundColor: Colors.red.shade800),
        );
      }
    } catch (e) {
      if (!mounted) return;
      var msg = 'İstek başarısız';
      if (e is DioException) {
        final d = e.response?.data;
        if (d is Map) {
          if (d['error'] != null) msg = '${d['error']}';
          final details = d['details'];
          if (details is Map) {
            final fieldErrors = details['fieldErrors'];
            if (fieldErrors is Map) {
              for (final entry in fieldErrors.entries) {
                final list = entry.value;
                if (list is List && list.isNotEmpty) {
                  msg = '${entry.key}: ${list.first}';
                  break;
                }
              }
            }
          }
        }
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(msg), backgroundColor: Colors.red.shade800),
      );
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  InputDecoration _broadcastFieldDeco(String label) {
    return InputDecoration(
      labelText: label,
      labelStyle: GoogleFonts.inter(color: _textSecondary),
      filled: true,
      fillColor: _broadcastFieldFill,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: _broadcastFieldBorder),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: _neonBlue, width: 1.5),
      ),
    );
  }

  void _applyTemplate(_BroadcastTemplate template) {
    setState(() {
      _titleCtrl.text = template.title;
      _bodyCtrl.text = template.body;
      if (template.audience != null) {
        _audience = template.audience!;
      }
    });
    _titleCtrl.selection = TextSelection.collapsed(offset: _titleCtrl.text.length);
    _bodyCtrl.selection = TextSelection.collapsed(offset: _bodyCtrl.text.length);
  }

  Widget _templateChip(_BroadcastTemplate template) {
    return ActionChip(
      label: Text(template.label),
      onPressed: _sending ? null : () => _applyTemplate(template),
      labelStyle: GoogleFonts.inter(
        color: Colors.white,
        fontSize: 12,
        fontWeight: FontWeight.w600,
      ),
      backgroundColor: const Color(0xFF1E2430),
      side: const BorderSide(color: _broadcastFieldBorder),
      padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 0),
    );
  }

  Widget _audienceChip(_BroadcastAudience value, String label) {
    final selected = _audience == value;
    return FilterChip(
      label: Text(label),
      selected: selected,
      onSelected: _sending
          ? null
          : (v) {
              if (v) setState(() => _audience = value);
            },
      labelStyle: GoogleFonts.inter(
        color: selected ? Colors.black : Colors.white,
        fontSize: 13,
        fontWeight: selected ? FontWeight.w600 : FontWeight.normal,
      ),
      selectedColor: _neonBlue,
      backgroundColor: _broadcastFieldFill,
      side: BorderSide(color: selected ? _neonBlue : _broadcastFieldBorder),
      showCheckmark: false,
    );
  }

  @override
  Widget build(BuildContext context) {
    final hint = GoogleFonts.inter(color: _textSecondary, fontSize: 12, height: 1.35);
    final fieldStyle = GoogleFonts.inter(color: Colors.white, fontSize: 15);

    return GlassCard(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Hedef kitle seçin. Kayıtlı FCM token\'ı olan cihazlara bildirim gider '
            '(toplu gönderimde en fazla 20.000 cihaz).',
            style: hint,
          ),
          const SizedBox(height: 12),
          Text('Hedef kitle', style: GoogleFonts.inter(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              _audienceChip(_BroadcastAudience.all, 'Herkes'),
              _audienceChip(_BroadcastAudience.customers, 'Yolcular'),
              _audienceChip(_BroadcastAudience.drivers, 'Sürücüler'),
              _audienceChip(_BroadcastAudience.user, 'Tek kişi'),
            ],
          ),
          if (_audience == _BroadcastAudience.user) ...[
            const SizedBox(height: 12),
            TextField(
              controller: _phoneCtrl,
              enabled: !_sending,
              keyboardType: TextInputType.phone,
              cursorColor: _neonBlue,
              style: fieldStyle,
              decoration: _broadcastFieldDeco('Telefon (+905551112233)'),
            ),
          ],
          const SizedBox(height: 14),
          Text(
            'Hazır şablonlar',
            style: GoogleFonts.inter(
              color: Colors.white,
              fontSize: 13,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            'Şablona dokunun — başlık, mesaj ve önerilen hedef kitle dolar.',
            style: hint,
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final t in _broadcastTemplates) _templateChip(t),
            ],
          ),
          const SizedBox(height: 14),
          TextField(
            controller: _titleCtrl,
            enabled: !_sending,
            maxLength: 80,
            cursorColor: _neonBlue,
            style: fieldStyle,
            decoration: _broadcastFieldDeco('Başlık (en fazla 80 karakter)'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _bodyCtrl,
            enabled: !_sending,
            maxLength: 500,
            maxLines: 4,
            cursorColor: _neonBlue,
            style: fieldStyle,
            decoration: _broadcastFieldDeco('Mesaj (en fazla 500 karakter)'),
          ),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: _sending ? null : _send,
            icon: _sending
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.black),
                  )
                : const Icon(Icons.campaign_outlined, color: Colors.black),
            label: Text(
              _sending ? 'Gönderiliyor…' : '$_audienceLabel — bildirim gönder',
              style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.black),
            ),
            style: FilledButton.styleFrom(
              backgroundColor: _neonBlue,
              padding: const EdgeInsets.symmetric(vertical: 14),
            ),
          ),
        ],
      ),
    );
  }
}

class _SettingsTab extends ConsumerWidget {
  const _SettingsTab({
    required this.pricing,
    required this.platform,
    required this.backendOrigin,
    required this.onEditPricing,
    required this.onEditPlatform,
    required this.onEditBackendOrigin,
    required this.onLogout,
  });
  final Map<String, dynamic> pricing;
  final Map<String, dynamic> platform;
  final String backendOrigin;
  final Future<void> Function() onEditPricing;
  final Future<void> Function() onEditPlatform;
  final Future<void> Function() onEditBackendOrigin;
  final Future<void> Function() onLogout;

  static String _platformSubtitle(Map<String, dynamic> p) {
    if (p.isEmpty) return 'Sunucudan veri alınamadı — yenileyin';
    final acceptPct = p['rideAcceptFeePercent'];
    final minB = p['minDriverOnlineBalanceTcoin'];
    final resp = p['driverResponseTimeoutSeconds'];
    return 'Kabul ücreti: %$acceptPct · Çevrim içi min: $minB T · Yanıt: ${resp ?? '?'} sn';
  }

  static String _pricingSubtitle(Map<String, dynamic> p) {
    if (p.isEmpty) return 'Sunucudan veri alınamadı — yenileyin';
    final pct = p['commissionPercent'];
    final flat = p['commissionFlat'];
    return 'Komisyon %$pct · Sabit $flat';
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final titleStyle = GoogleFonts.inter(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w600);
    final subStyle = GoogleFonts.inter(color: _textSecondary, fontSize: 13);

    return Theme(
      data: Theme.of(context).copyWith(
        listTileTheme: ListTileThemeData(
          titleTextStyle: titleStyle,
          subtitleTextStyle: subStyle,
          iconColor: Colors.white,
        ),
      ),
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 10, 20, 100),
        children: [
          Text('AYARLAR', style: GoogleFonts.inter(color: _neonBlue, fontSize: 12, fontWeight: FontWeight.w600, letterSpacing: 1.2)),
          const SizedBox(height: 12),
          GlassCard(
            padding: EdgeInsets.zero,
            child: Material(
              color: Colors.transparent,
              child: ListTile(
                tileColor: const Color(0x14FFFFFF),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                leading: const Icon(Icons.tune, color: _neonBlue),
                title: Text('Platform Ayarları', style: titleStyle),
                subtitle: Text(_platformSubtitle(platform), style: subStyle),
                trailing: const Icon(Icons.chevron_right, color: _textSecondary),
                onTap: onEditPlatform,
              ),
            ),
          ),
          const SizedBox(height: 12),
          GlassCard(
            padding: EdgeInsets.zero,
            child: Material(
              color: Colors.transparent,
              child: ListTile(
                tileColor: const Color(0x14FFFFFF),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                leading: const Icon(Icons.attach_money, color: _neonPurple),
                title: Text('Fiyatlandırma', style: titleStyle),
                subtitle: Text(_pricingSubtitle(pricing), style: subStyle),
                trailing: const Icon(Icons.chevron_right, color: _textSecondary),
                onTap: onEditPricing,
              ),
            ),
          ),
          const SizedBox(height: 12),
          GlassCard(
            padding: EdgeInsets.zero,
            child: Material(
              color: Colors.transparent,
              child: ListTile(
                tileColor: const Color(0x14FFFFFF),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                leading: const Icon(Icons.dns, color: Colors.lightGreenAccent),
                title: Text('Backend Sunucu', style: titleStyle),
                subtitle: Text(backendOrigin, style: subStyle),
                trailing: const Icon(Icons.chevron_right, color: _textSecondary),
                onTap: onEditBackendOrigin,
              ),
            ),
          ),
          const SizedBox(height: 20),
          Text(
            'TOPLU BİLDİRİM',
            style: GoogleFonts.inter(color: _neonPurple, fontSize: 12, fontWeight: FontWeight.w600, letterSpacing: 1.2),
          ),
          const SizedBox(height: 10),
          _AdminBroadcastSection(api: ref.read(apiServiceProvider)),
          const SizedBox(height: 24),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.redAccent.withValues(alpha: 0.15),
              foregroundColor: Colors.redAccent,
              padding: const EdgeInsets.symmetric(vertical: 16),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
            ),
            onPressed: onLogout,
            child: const Text('Çıkış Yap', style: TextStyle(fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }
}

class _LogsTab extends StatelessWidget {
  const _LogsTab({required this.outLogs, required this.errorLogs, required this.loading, required this.onRefresh});
  final List<String> outLogs;
  final List<String> errorLogs;
  final bool loading;
  final Future<void> Function() onRefresh;

  static const _logBg = Color(0xFF0D1117);
  static const _logText = Color(0xFFC9D1D9);
  static const _logMuted = Color(0xFF8B949E);

  @override
  Widget build(BuildContext context) {
    if (loading) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const CircularProgressIndicator(color: _neonBlue),
            const SizedBox(height: 16),
            Text('Loglar yükleniyor…', style: GoogleFonts.inter(color: _textSecondary)),
          ],
        ),
      );
    }

    final outBody = outLogs.isEmpty
        ? 'Henüz stdout satırı yok.\n\nSunucu log endpoint’i boş döndüyse veya ilk yüklemede bekleyin; aşağıdan yenileyin.'
        : outLogs.reversed.take(50).join('\n');
    final errBody = errorLogs.isEmpty ? null : errorLogs.reversed.take(30).join('\n');

    return RefreshIndicator(
      color: _neonBlue,
      backgroundColor: _bg,
      onRefresh: onRefresh,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 10, 20, 100),
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          Row(
            children: [
              Expanded(child: Text('CANLI LOG', style: GoogleFonts.robotoMono(color: _neonBlue, fontSize: 12, fontWeight: FontWeight.bold))),
              TextButton.icon(
                onPressed: onRefresh,
                icon: const Icon(Icons.refresh, color: _neonBlue, size: 18),
                label: Text('Yenile', style: GoogleFonts.inter(color: _neonBlue, fontSize: 13)),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            'Stdout (son ${outLogs.length > 50 ? 50 : outLogs.length} satır)',
            style: GoogleFonts.inter(color: _logMuted, fontSize: 11),
          ),
          const SizedBox(height: 8),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: _logBg,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: const Color(0xFF30363D)),
            ),
            child: SelectableText(
              outBody,
              style: GoogleFonts.robotoMono(color: _logText, fontSize: 11, height: 1.35),
            ),
          ),
          if (errBody != null) ...[
            const SizedBox(height: 16),
            Text(
              'Stderr',
              style: GoogleFonts.inter(color: Colors.redAccent, fontSize: 12, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 8),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: const Color(0xFF2D141A),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: Colors.redAccent.withValues(alpha: 0.35)),
              ),
              child: SelectableText(
                errBody,
                style: GoogleFonts.robotoMono(color: const Color(0xFFFFB4AB), fontSize: 11, height: 1.35),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
