import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/top_overlay_toast.dart';
import '../../providers/providers.dart';
import '../../services/directions_service.dart';

/// Uber tarzı varış arama — alt çizgili arama, son aramalar, sade liste.
class DestinationSearchScreen extends ConsumerStatefulWidget {
  final String apiKey;
  final LatLng? currentLocation;

  const DestinationSearchScreen({
    super.key,
    required this.apiKey,
    this.currentLocation,
  });

  @override
  ConsumerState<DestinationSearchScreen> createState() =>
      _DestinationSearchScreenState();
}

class _DestinationSearchScreenState
    extends ConsumerState<DestinationSearchScreen> {
  final _searchController = TextEditingController();
  final _focusNode = FocusNode();
  late final DirectionsService _directionsService;

  List<PlacePrediction> _predictions = [];
  List<Map<String, dynamic>> _history = [];
  bool _isLoading = false;
  Timer? _debounce;

  @override
  void initState() {
    super.initState();
    _directionsService = DirectionsService(widget.apiKey);
    _searchController.addListener(() {
      if (mounted) setState(() {});
    });
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      await ref.read(storageServiceProvider).init();
      if (!mounted) return;
      setState(() {
        _history = ref.read(storageServiceProvider).getDestinationSearchHistory();
      });
      _focusNode.requestFocus();
    });
  }

  @override
  void dispose() {
    _searchController.dispose();
    _focusNode.dispose();
    _debounce?.cancel();
    super.dispose();
  }

  void _onSearchChanged(String query) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 320), () {
      _searchPlaces(query);
    });
  }

  Future<void> _searchPlaces(String query) async {
    if (query.trim().length < 2) {
      setState(() => _predictions = []);
      return;
    }

    setState(() => _isLoading = true);

    final results = await _directionsService.searchPlaces(
      query,
      location: widget.currentLocation,
    );

    if (mounted) {
      setState(() {
        _predictions = results;
        _isLoading = false;
      });
    }
  }

  Future<void> _persistAndPop(PlacePrediction prediction, PlaceDetail detail) async {
    await ref.read(storageServiceProvider).addDestinationSearchHistoryEntry(
          placeId: prediction.placeId,
          mainText: prediction.mainText,
          secondaryText: prediction.secondaryText,
        );
    if (mounted) Navigator.pop(context, detail);
  }

  Future<void> _selectPrediction(PlacePrediction prediction) async {
    setState(() => _isLoading = true);

    final detail = await _directionsService.getPlaceDetails(prediction.placeId);

    if (detail != null && mounted) {
      await _persistAndPop(prediction, detail);
    } else if (mounted) {
      showTopOverlayToast(
        context,
        'Konum bilgisi alınamadı.',
        AppTheme.errorColor,
      );
      setState(() => _isLoading = false);
    }
  }

  Future<void> _selectHistoryEntry(Map<String, dynamic> e) async {
    final placeId = e['placeId'] as String? ?? '';
    if (placeId.isEmpty) return;
    final prediction = PlacePrediction(
      placeId: placeId,
      description: '${e['mainText'] ?? ''}, ${e['secondaryText'] ?? ''}',
      mainText: e['mainText'] as String? ?? '',
      secondaryText: e['secondaryText'] as String? ?? '',
    );
    await _selectPrediction(prediction);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.surfaceColor,
      appBar: AppBar(
        backgroundColor: AppTheme.surfaceColor,
        elevation: 0,
        scrolledUnderElevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded,
              color: AppTheme.ink, size: 20),
          onPressed: () => Navigator.pop(context),
        ),
        title: Text(
          'Nereye?',
          style: GoogleFonts.inter(
            color: AppTheme.ink,
            fontSize: 18,
            fontWeight: FontWeight.w800,
            letterSpacing: -0.3,
          ),
        ),
        centerTitle: false,
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Adres veya mekan ara',
                  style: GoogleFonts.inter(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: AppTheme.textSecondary,
                  ),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: _searchController,
                  focusNode: _focusNode,
                  onChanged: _onSearchChanged,
                  style: GoogleFonts.inter(
                    fontSize: 17,
                    fontWeight: FontWeight.w600,
                    color: AppTheme.ink,
                  ),
                  decoration: InputDecoration(
                    hintText: 'Örn. Otogar, hastane…',
                    hintStyle: GoogleFonts.inter(
                      color: AppTheme.textMuted,
                      fontWeight: FontWeight.w500,
                    ),
                    prefixIcon:
                        Icon(Icons.search_rounded, color: AppTheme.textMuted),
                    suffixIcon: _searchController.text.isNotEmpty
                        ? IconButton(
                            icon: Icon(Icons.close_rounded,
                                color: AppTheme.textMuted, size: 22),
                            onPressed: () {
                              _searchController.clear();
                              setState(() => _predictions = []);
                            },
                          )
                        : null,
                    border: UnderlineInputBorder(
                      borderSide: BorderSide(color: AppTheme.border),
                    ),
                    enabledBorder: UnderlineInputBorder(
                      borderSide: BorderSide(color: AppTheme.border),
                    ),
                    focusedBorder: UnderlineInputBorder(
                      borderSide:
                          const BorderSide(color: AppTheme.ink, width: 2),
                    ),
                    contentPadding:
                        const EdgeInsets.symmetric(vertical: 12),
                  ),
                ),
              ],
            ),
          ),
          if (_isLoading)
            const LinearProgressIndicator(
              minHeight: 2,
              color: AppTheme.ink,
              backgroundColor: AppTheme.subtle,
            ),
          Expanded(
            child: _predictions.isNotEmpty
                ? ListView.separated(
                    padding: const EdgeInsets.symmetric(horizontal: 8),
                    itemCount: _predictions.length,
                    separatorBuilder: (_, __) => Divider(
                      height: 1,
                      indent: 56,
                      color: AppTheme.border.withValues(alpha: 0.6),
                    ),
                    itemBuilder: (context, index) {
                      final p = _predictions[index];
                      return _resultTile(
                        title: p.mainText,
                        subtitle: p.secondaryText,
                        onTap: () => _selectPrediction(p),
                      );
                    },
                  )
                : _buildBelowSearch(),
          ),
        ],
      ),
    );
  }

  Widget _buildBelowSearch() {
    if (_searchController.text.trim().length >= 2 && !_isLoading) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.search_off_rounded, size: 48, color: AppTheme.textMuted),
            const SizedBox(height: 12),
            Text(
              'Sonuç yok',
              style: GoogleFonts.inter(
                fontSize: 16,
                fontWeight: FontWeight.w700,
                color: AppTheme.textSecondary,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              'Farklı bir ifade deneyin',
              style: GoogleFonts.inter(
                fontSize: 14,
                fontWeight: FontWeight.w500,
                color: AppTheme.textMuted,
              ),
            ),
          ],
        ),
      );
    }

    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
      children: [
        if (_history.isNotEmpty) ...[
          Text(
            'Son aramalar',
            style: GoogleFonts.inter(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: AppTheme.textMuted,
              letterSpacing: 0.4,
            ),
          ),
          const SizedBox(height: 10),
          ..._history.map((e) {
            return Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: Material(
                color: Colors.transparent,
                child: InkWell(
                  onTap: () => _selectHistoryEntry(e),
                  borderRadius: BorderRadius.circular(AppTheme.radiusSm),
                  child: Padding(
                    padding:
                        const EdgeInsets.symmetric(vertical: 12, horizontal: 4),
                    child: Row(
                      children: [
                        Icon(Icons.history_rounded,
                            color: AppTheme.textSecondary, size: 22),
                        const SizedBox(width: 14),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                e['mainText'] as String? ?? '',
                                style: GoogleFonts.inter(
                                  fontSize: 15,
                                  fontWeight: FontWeight.w700,
                                  color: AppTheme.ink,
                                ),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                              if ((e['secondaryText'] as String? ?? '')
                                  .isNotEmpty)
                                Text(
                                  e['secondaryText'] as String,
                                  style: GoogleFonts.inter(
                                    fontSize: 13,
                                    fontWeight: FontWeight.w500,
                                    color: AppTheme.textSecondary,
                                  ),
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                ),
                            ],
                          ),
                        ),
                        Icon(Icons.chevron_right_rounded,
                            color: AppTheme.textMuted, size: 22),
                      ],
                    ),
                  ),
                ),
              ),
            );
          }),
          const SizedBox(height: 20),
        ],
        Text(
          'Öneriler',
          style: GoogleFonts.inter(
            fontSize: 12,
            fontWeight: FontWeight.w700,
            color: AppTheme.textMuted,
            letterSpacing: 0.4,
          ),
        ),
        const SizedBox(height: 10),
        _quickRow('Kırıkkale Otogar', Icons.directions_bus_rounded),
        _quickRow('Kırıkkale Üniversitesi', Icons.school_rounded),
        _quickRow('Kırıkkale Devlet Hastanesi', Icons.local_hospital_rounded),
        _quickRow('Big Center AVM', Icons.shopping_bag_outlined),
      ],
    );
  }

  Widget _quickRow(String text, IconData icon) {
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: Container(
        width: 40,
        height: 40,
        decoration: BoxDecoration(
          color: AppTheme.subtle,
          borderRadius: BorderRadius.circular(AppTheme.radiusSm),
          border: Border.all(color: AppTheme.border),
        ),
        child: Icon(icon, color: AppTheme.ink, size: 20),
      ),
      title: Text(
        text,
        style: GoogleFonts.inter(
          fontSize: 15,
          fontWeight: FontWeight.w600,
          color: AppTheme.ink,
        ),
      ),
      onTap: () {
        _searchController.text = text;
        _searchPlaces(text);
      },
    );
  }

  Widget _resultTile({
    required String title,
    required String subtitle,
    required VoidCallback onTap,
  }) {
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      leading: Container(
        width: 40,
        height: 40,
        decoration: BoxDecoration(
          color: AppTheme.subtle,
          borderRadius: BorderRadius.circular(AppTheme.radiusSm),
          border: Border.all(color: AppTheme.border),
        ),
        child: const Icon(Icons.place_outlined, color: AppTheme.ink, size: 22),
      ),
      title: Text(
        title,
        style: GoogleFonts.inter(
          fontWeight: FontWeight.w700,
          fontSize: 15,
          color: AppTheme.ink,
        ),
        overflow: TextOverflow.ellipsis,
      ),
      subtitle: Text(
        subtitle,
        style: GoogleFonts.inter(
          fontSize: 13,
          fontWeight: FontWeight.w500,
          color: AppTheme.textSecondary,
        ),
        overflow: TextOverflow.ellipsis,
      ),
      onTap: onTap,
    );
  }
}
