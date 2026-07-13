import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geocoding/geocoding.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import '../../core/constants/app_constants.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/top_overlay_toast.dart';
import '../../models/ride_model.dart' hide LatLng;
import '../../models/ride_model.dart' as models show LatLng;
import '../../providers/providers.dart';
import '../../services/directions_service.dart';

/// Rezervasyon paneli — sürüklenebilir sayfa ile uyumlu; üstte arama, altta sabit çağrı CTA.
class RideBottomSheet extends ConsumerStatefulWidget {
  final ScrollController? sheetScrollController;
  final LatLng? pickupPosition;
  final LatLng? dropoffPosition;
  final String? pickupAddress;
  final String? dropoffAddress;
  final RouteInfo? routeInfo;
  final List<RouteInfo> routeAlternatives;
  final int selectedRouteIndex;
  final ValueChanged<int>? onRouteAlternativeSelected;
  final VoidCallback onSelectPickup;
  final VoidCallback onSelectDropoff;
  final VoidCallback onSelectDropoffOnMap;
  final VoidCallback onClearDropoff;
  /// Geçmişten seçilen yer (harita/rota güncellenir)
  final ValueChanged<PlaceDetail>? onHistoryPlaceSelected;

  const RideBottomSheet({
    super.key,
    this.sheetScrollController,
    this.pickupPosition,
    this.dropoffPosition,
    this.pickupAddress,
    this.dropoffAddress,
    this.routeInfo,
    this.routeAlternatives = const [],
    this.selectedRouteIndex = 0,
    this.onRouteAlternativeSelected,
    required this.onSelectPickup,
    required this.onSelectDropoff,
    required this.onSelectDropoffOnMap,
    required this.onClearDropoff,
    this.onHistoryPlaceSelected,
  });

  @override
  ConsumerState<RideBottomSheet> createState() => _RideBottomSheetState();
}

class _RideBottomSheetState extends ConsumerState<RideBottomSheet> {
  bool _isRequesting = false;
  List<Map<String, dynamic>> _history = [];

  @override
  void initState() {
    super.initState();
    _reloadHistory();
  }

  @override
  void dispose() {
    dismissTopOverlayToast();
    super.dispose();
  }

  @override
  void didUpdateWidget(RideBottomSheet oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.dropoffAddress != widget.dropoffAddress ||
        oldWidget.dropoffPosition != widget.dropoffPosition) {
      _reloadHistory();
    }
  }

  void _reloadHistory() {
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      await ref.read(storageServiceProvider).init();
      if (!mounted) return;
      setState(() {
        _history = ref.read(storageServiceProvider).getDestinationSearchHistory();
      });
    });
  }

  double? get _estimatedDistance => widget.routeInfo?.distanceKm;

  double _priceForRouteKm(double distanceKm) {
    final price = AppConstants.baseFare + (distanceKm * AppConstants.perKmRate);
    return price < AppConstants.minimumFare ? AppConstants.minimumFare : price;
  }

  double? get _estimatedPrice {
    final dist = _estimatedDistance;
    if (dist == null) return null;
    return _priceForRouteKm(dist);
  }

  static String _lineFromPlacemark(Placemark p) {
    final parts = <String>[];
    void add(String? s) {
      if (s == null) return;
      final t = s.trim();
      if (t.isEmpty || parts.contains(t)) return;
      parts.add(t);
    }
    add(p.street);
    add(p.thoroughfare);
    add(p.subLocality);
    add(p.locality);
    add(p.administrativeArea);
    add(p.postalCode);
    add(p.country);
    return parts.join(', ');
  }

  Future<({String pickup, String dropoff})> _resolveFullAddresses() async {
    var pickup = (widget.pickupAddress?.trim().isNotEmpty ?? false)
        ? widget.pickupAddress!.trim()
        : 'Biniş Noktası';
    var dropoff = (widget.dropoffAddress?.trim().isNotEmpty ?? false)
        ? widget.dropoffAddress!.trim()
        : 'Varış Noktası';

    final pickupNeedsGeo = widget.pickupPosition != null &&
        (pickup == 'Mevcut Konumunuz' ||
            pickup == 'Biniş Noktası' ||
            pickup.length < 10);

    if (pickupNeedsGeo) {
      try {
        final list = await placemarkFromCoordinates(
          widget.pickupPosition!.latitude,
          widget.pickupPosition!.longitude,
        );
        if (list.isNotEmpty) {
          final line = _lineFromPlacemark(list.first);
          if (line.isNotEmpty) pickup = line;
        }
      } catch (_) {}
    }

    final dropNeedsGeo = widget.dropoffPosition != null &&
        (dropoff.length < 12 ||
            dropoff == 'Varış Noktası' ||
            dropoff == 'İniş Noktası');
    if (dropNeedsGeo) {
      try {
        final list = await placemarkFromCoordinates(
          widget.dropoffPosition!.latitude,
          widget.dropoffPosition!.longitude,
        );
        if (list.isNotEmpty) {
          final line = _lineFromPlacemark(list.first);
          if (line.isNotEmpty) dropoff = line;
        }
      } catch (_) {}
    }

    return (pickup: pickup, dropoff: dropoff);
  }

  Future<void> _requestRide() async {
    if (widget.pickupPosition == null || widget.dropoffPosition == null) {
      return;
    }
    if (_estimatedPrice == null || _estimatedDistance == null) return;

    setState(() => _isRequesting = true);

    try {
      final addr = await _resolveFullAddresses();
      final socket = ref.read(socketServiceProvider);

      socket.requestRide(
        pickup: models.LatLng(
          lat: widget.pickupPosition!.latitude,
          lng: widget.pickupPosition!.longitude,
        ),
        dropoff: models.LatLng(
          lat: widget.dropoffPosition!.latitude,
          lng: widget.dropoffPosition!.longitude,
        ),
        pickupAddress: addr.pickup,
        dropoffAddress: addr.dropoff,
        estimatedPrice: _estimatedPrice!,
        distanceKm: _estimatedDistance!,
      );

      ref.read(rideMatchingProgressProvider.notifier).clear();
      ref.read(activeRideProvider.notifier).setRide(RideModel(
            id: 'temp_${DateTime.now().millisecondsSinceEpoch}',
            customerId: ref.read(currentUserProvider)?.id ?? '',
            pickupAddress: addr.pickup,
            dropoffAddress: addr.dropoff,
            distanceKm: _estimatedDistance,
            estimatedPrice: _estimatedPrice!,
            status: RideStatus.searching,
          ));

      if (mounted) {
        showTopOverlayToast(context, 'Sürücü aranıyor…', AppTheme.ink);
      }
    } catch (e) {
      if (mounted) {
        showTopOverlayToast(context, 'Hata: $e', AppTheme.errorColor);
      }
    } finally {
      if (mounted) setState(() => _isRequesting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.paddingOf(context).bottom;
    final hasTrip =
        widget.dropoffPosition != null && _estimatedPrice != null;

    return Container(
      decoration: BoxDecoration(
        color: AppTheme.brandSurface,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(AppTheme.radiusLg)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.35),
            blurRadius: 20,
            offset: const Offset(0, -4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Expanded(
            child: SingleChildScrollView(
              controller: widget.sheetScrollController,
              physics: const ClampingScrollPhysics(),
              padding: const EdgeInsets.fromLTRB(14, 6, 14, 0),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Center(
                    child: Container(
                      width: 36,
                      height: 3,
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.28),
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ),
                  ),
                  const SizedBox(height: 6),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.center,
                    children: [
                      Expanded(
                        child: Text(
                          'Nereye?',
                          style: GoogleFonts.inter(
                            fontSize: 18,
                            fontWeight: FontWeight.w800,
                            color: Colors.white.withValues(alpha: 0.95),
                            letterSpacing: -0.4,
                          ),
                        ),
                      ),
                      if (widget.dropoffPosition != null)
                        TextButton(
                          onPressed: widget.onClearDropoff,
                          style: TextButton.styleFrom(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 8, vertical: 2),
                            minimumSize: Size.zero,
                            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                            foregroundColor: AppTheme.primaryLight,
                          ),
                          child: Text(
                            'Temizle',
                            style: GoogleFonts.inter(
                              fontSize: 12,
                              fontWeight: FontWeight.w700,
                              color: AppTheme.primaryColor,
                            ),
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Alım noktası',
                    style: GoogleFonts.inter(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: Colors.white.withValues(alpha: 0.5),
                    ),
                  ),
                  const SizedBox(height: 4),
                  _buildPickupBar(context),
                  const SizedBox(height: 8),
                  Text.rich(
                    TextSpan(
                      children: [
                        TextSpan(
                          text: 'Gidilecek yer',
                          style: GoogleFonts.inter(
                            fontSize: 11,
                            fontWeight: FontWeight.w600,
                            color: Colors.white.withValues(alpha: 0.5),
                          ),
                        ),
                        TextSpan(
                          text: ' · ',
                          style: GoogleFonts.inter(
                            fontSize: 11,
                            fontWeight: FontWeight.w500,
                            color: Colors.white.withValues(alpha: 0.32),
                          ),
                        ),
                        TextSpan(
                          text: 'Ara veya harita',
                          style: GoogleFonts.inter(
                            fontSize: 11,
                            fontWeight: FontWeight.w500,
                            color: Colors.white.withValues(alpha: 0.36),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 4),
                  _buildNereyeBar(context),
                  _buildHistorySection(),
                  if (hasTrip) ...[
                    const SizedBox(height: 8),
                    if (widget.routeAlternatives.length > 1) ...[
                      Text(
                        'Rota seçenekleri',
                        style: GoogleFonts.inter(
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                          color: Colors.white.withValues(alpha: 0.88),
                        ),
                      ),
                      const SizedBox(height: 6),
                      ...List.generate(widget.routeAlternatives.length, (i) {
                        final r = widget.routeAlternatives[i];
                        final selected = i == widget.selectedRouteIndex;
                        final tl = _priceForRouteKm(r.distanceKm);
                        return Padding(
                          padding: const EdgeInsets.only(bottom: 6),
                          child: Material(
                            color: Colors.transparent,
                            child: InkWell(
                              onTap: () =>
                                  widget.onRouteAlternativeSelected?.call(i),
                              borderRadius:
                                  BorderRadius.circular(AppTheme.radiusSm),
                              child: AnimatedContainer(
                                duration: const Duration(milliseconds: 200),
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 10, vertical: 8),
                                decoration: BoxDecoration(
                                  color: selected
                                      ? AppTheme.primaryColor
                                          .withValues(alpha: 0.18)
                                      : AppTheme.brandMidnightElevated,
                                  borderRadius:
                                      BorderRadius.circular(AppTheme.radiusSm),
                                  border: Border.all(
                                    color: selected
                                        ? AppTheme.primaryColor
                                            .withValues(alpha: 0.65)
                                        : AppTheme.brandBorderSubtle,
                                    width: selected ? 1.5 : 1,
                                  ),
                                ),
                                child: Row(
                                  children: [
                                    Icon(
                                      selected
                                          ? Icons.check_circle_rounded
                                          : Icons.circle_outlined,
                                      size: 18,
                                      color: selected
                                          ? AppTheme.primaryColor
                                          : Colors.white.withValues(alpha: 0.45),
                                    ),
                                    const SizedBox(width: 8),
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment:
                                            CrossAxisAlignment.start,
                                        children: [
                                          Text(
                                            r.displayLabel,
                                            style: GoogleFonts.inter(
                                              fontSize: 12,
                                              fontWeight: FontWeight.w700,
                                              color: Colors.white.withValues(alpha: 0.92),
                                            ),
                                            maxLines: 2,
                                            overflow: TextOverflow.ellipsis,
                                          ),
                                          const SizedBox(height: 2),
                                          Text(
                                            '${r.durationText} · ${r.distanceText}',
                                            style: GoogleFonts.inter(
                                              fontSize: 11,
                                              fontWeight: FontWeight.w500,
                                              color: Colors.white.withValues(alpha: 0.5),
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                    Text(
                                      '≈ ${tl.toStringAsFixed(0)} ₺',
                                      style: GoogleFonts.inter(
                                        fontSize: 14,
                                        fontWeight: FontWeight.w800,
                                        color: AppTheme.primaryColor,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ),
                        );
                      }),
                    ] else ...[
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 10, vertical: 8),
                        decoration: BoxDecoration(
                          color: AppTheme.brandMidnightElevated,
                          borderRadius:
                              BorderRadius.circular(AppTheme.radiusSm),
                          border: Border.all(color: AppTheme.brandBorderSubtle),
                        ),
                        child: Row(
                          children: [
                            Icon(Icons.schedule_rounded,
                                color: AppTheme.primaryColor, size: 18),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    widget.routeInfo?.durationText ?? '—',
                                    style: GoogleFonts.inter(
                                      fontSize: 13,
                                      fontWeight: FontWeight.w800,
                                      color: Colors.white.withValues(alpha: 0.95),
                                    ),
                                  ),
                                  Text(
                                    widget.routeInfo?.distanceText ??
                                        '${_estimatedDistance!.toStringAsFixed(1)} km',
                                    style: GoogleFonts.inter(
                                      fontSize: 11,
                                      fontWeight: FontWeight.w500,
                                      color: Colors.white.withValues(alpha: 0.5),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            Text(
                              '≈ ${_estimatedPrice!.toStringAsFixed(0)} ₺',
                              style: GoogleFonts.inter(
                                fontSize: 17,
                                fontWeight: FontWeight.w800,
                                color: AppTheme.primaryColor,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ],
                  SizedBox(height: hasTrip ? 10 : bottomInset * 0.08),
                ],
              ),
            ),
          ),
          if (hasTrip)
            Material(
              color: AppTheme.brandSurface,
              elevation: 10,
              shadowColor: Colors.black.withValues(alpha: 0.25),
              child: Padding(
                padding: EdgeInsets.fromLTRB(14, 4, 14, 4 + bottomInset),
                child: SizedBox(
                  height: 44,
                  child: ElevatedButton(
                    onPressed: _isRequesting ? null : _requestRide,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppTheme.primaryColor,
                      foregroundColor: AppTheme.ink,
                      elevation: 0,
                      shape: RoundedRectangleBorder(
                        borderRadius:
                            BorderRadius.circular(AppTheme.radiusSm),
                      ),
                    ),
                    child: _isRequesting
                        ? const SizedBox(
                            width: 22,
                            height: 22,
                            child: CircularProgressIndicator(
                              strokeWidth: 2.5,
                              color: AppTheme.ink,
                            ),
                          )
                        : Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              const Icon(Icons.local_taxi_rounded, size: 20),
                              const SizedBox(width: 8),
                              Text(
                                'Taksim Gelsin',
                                style: GoogleFonts.inter(
                                  fontSize: 15,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                            ],
                          ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildHistorySection() {
    if (_history.isEmpty) return const SizedBox.shrink();
    final cb = widget.onHistoryPlaceSelected;
    if (cb == null) return const SizedBox.shrink();

    final entries = _history.take(8).toList();

    return Padding(
      padding: const EdgeInsets.only(top: 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Son aramalar',
            style: GoogleFonts.inter(
              fontSize: 10,
              fontWeight: FontWeight.w700,
              color: Colors.white.withValues(alpha: 0.42),
              letterSpacing: 0.2,
            ),
          ),
          const SizedBox(height: 4),
          SizedBox(
            height: 28,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              clipBehavior: Clip.none,
              itemCount: entries.length,
              separatorBuilder: (_, __) => const SizedBox(width: 6),
              itemBuilder: (context, i) {
                final e = entries[i];
                final main = e['mainText'] as String? ?? '';
                final sub = e['secondaryText'] as String? ?? '';
                final pid = e['placeId'] as String? ?? '';
                final label = main.isNotEmpty ? main : sub;

                return Material(
                  color: AppTheme.brandMidnightElevated,
                  elevation: 0,
                  shape: StadiumBorder(
                    side: BorderSide(
                      color: AppTheme.brandBorderSubtle,
                    ),
                  ),
                  clipBehavior: Clip.antiAlias,
                  child: InkWell(
                    onTap: pid.isEmpty || label.isEmpty
                        ? null
                        : () async {
                            final ds = DirectionsService(
                                AppConstants.googleMapsApiKey);
                            final d = await ds.getPlaceDetails(pid);
                            if (!mounted || d == null) return;
                            await ref
                                .read(storageServiceProvider)
                                .addDestinationSearchHistoryEntry(
                                  placeId: pid,
                                  mainText: main,
                                  secondaryText: sub,
                                );
                            cb(d);
                            _reloadHistory();
                          },
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 8, vertical: 0),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            Icons.history_rounded,
                            size: 12,
                            color: Colors.white.withValues(alpha: 0.45),
                          ),
                          const SizedBox(width: 4),
                          ConstrainedBox(
                            constraints: const BoxConstraints(maxWidth: 96),
                            child: Text(
                              label,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: GoogleFonts.inter(
                                fontSize: 11,
                                fontWeight: FontWeight.w600,
                                color: Colors.white.withValues(alpha: 0.85),
                                height: 1.15,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildNereyeBar(BuildContext context) {
    final hasDrop = widget.dropoffAddress != null &&
        widget.dropoffAddress!.trim().isNotEmpty;
    final preview =
        hasDrop ? widget.dropoffAddress!.trim() : 'Adres veya mekan ara…';
    return Material(
      color: AppTheme.brandMidnightElevated,
      borderRadius: BorderRadius.circular(AppTheme.radiusSm),
      clipBehavior: Clip.antiAlias,
      child: Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(AppTheme.radiusSm),
          border: Border.all(
            color: AppTheme.brandBorderSubtle,
            width: 1.5,
          ),
        ),
        child: Row(
          children: [
            Expanded(
              child: InkWell(
                onTap: widget.onSelectDropoff,
                child: Padding(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
                  child: Row(
                    children: [
                      Icon(Icons.search_rounded,
                          color: Colors.white.withValues(alpha: 0.45),
                          size: 20),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          preview,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: GoogleFonts.inter(
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                            color: hasDrop
                                ? Colors.white.withValues(alpha: 0.92)
                                : Colors.white.withValues(alpha: 0.42),
                          ),
                        ),
                      ),
                      Icon(Icons.arrow_forward_ios_rounded,
                          size: 11,
                          color: Colors.white.withValues(alpha: 0.35)),
                    ],
                  ),
                ),
              ),
            ),
            Container(
              width: 1,
              height: 32,
              color: AppTheme.brandBorderSubtle,
            ),
            InkWell(
              onTap: widget.onSelectDropoffOnMap,
              child: Padding(
                padding:
                    const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      Icons.map_rounded,
                      color: AppTheme.primaryColor,
                      size: 18,
                    ),
                    const SizedBox(height: 1),
                    Text(
                      'Harita',
                      style: GoogleFonts.inter(
                        fontSize: 10,
                        fontWeight: FontWeight.w700,
                        color: Colors.white.withValues(alpha: 0.62),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildPickupBar(BuildContext context) {
    final hasPickup = widget.pickupAddress != null &&
        widget.pickupAddress!.trim().isNotEmpty;
    final preview =
        hasPickup ? widget.pickupAddress!.trim() : 'Alım noktası seçin';
    return Material(
      color: AppTheme.brandMidnightElevated,
      borderRadius: BorderRadius.circular(AppTheme.radiusSm),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: widget.onSelectPickup,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(AppTheme.radiusSm),
            border: Border.all(
              color: AppTheme.brandBorderSubtle,
              width: 1.5,
            ),
          ),
          child: Row(
            children: [
              Icon(Icons.place_rounded,
                  color: Colors.white.withValues(alpha: 0.5), size: 20),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  preview,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: GoogleFonts.inter(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: hasPickup
                        ? Colors.white.withValues(alpha: 0.92)
                        : Colors.white.withValues(alpha: 0.42),
                  ),
                ),
              ),
              Icon(Icons.edit_location_alt_rounded,
                  size: 14, color: Colors.white.withValues(alpha: 0.4)),
            ],
          ),
        ),
      ),
    );
  }

}
