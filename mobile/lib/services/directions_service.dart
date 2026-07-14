import 'dart:math';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

import '../core/constants/app_constants.dart';

double _fareForDistanceKm(double distanceKm) {
  final p = AppConstants.baseFare + (distanceKm * AppConstants.perKmRate);
  return p < AppConstants.minimumFare ? AppConstants.minimumFare : p;
}

/// Google Maps API Servisi
/// Places Autocomplete (adres arama) ve Directions (rota çizimi) API'leri
class DirectionsService {
  final Dio _dio = Dio();
  final String _apiKey;

  DirectionsService(this._apiKey);

  // ============================================================
  // OTURUM BELİRTECİ (session token) — maliyet optimizasyonu
  //
  // Google, aynı sessiontoken ile gönderilen Autocomplete çağrılarını +
  // ardından gelen Place Details çağrısını TEK bir Place Details ücreti
  // olarak faturalandırıyor (token yoksa her Autocomplete çağrısı ayrı
  // ücretlendirilir). Bir arama oturumu = yazarken gelen tüm öneriler +
  // seçilen sonucun detayı; detay çağrısı tamamlanınca token sıfırlanır,
  // bir sonraki arama yeni bir oturumla başlar.
  // https://developers.google.com/maps/documentation/places/web-service/session-tokens
  // ============================================================
  String? _sessionToken;

  String _ensureSessionToken() => _sessionToken ??= _generateSessionToken();

  String _generateSessionToken() {
    final rnd = Random.secure();
    String hex(int n) =>
        List.generate(n, (_) => rnd.nextInt(16).toRadixString(16)).join();
    // UUID v4 biçimi (Google'ın önerdiği format; katı RFC uyumu şart değil,
    // yalnızca oturum başına benzersiz olması yeterli).
    return '${hex(8)}-${hex(4)}-4${hex(3)}-'
        '${(8 + rnd.nextInt(4)).toRadixString(16)}${hex(3)}-${hex(12)}';
  }

  // ============================================================
  // PLACES AUTOCOMPLETE — Yazarak adres arama
  // ============================================================

  /// Google Places Autocomplete ile adres önerileri al
  /// [query] → kullanıcının yazdığı metin
  /// [location] → arama merkezini belirlemek için mevcut konum (opsiyonel)
  Future<List<PlacePrediction>> searchPlaces(
    String query, {
    LatLng? location,
  }) async {
    if (query.trim().length < 2) return [];
    if (_apiKey.trim().isEmpty) {
      if (kDebugMode) {
        debugPrint(
          'DirectionsService: GOOGLE_MAPS_API_KEY boş — varış araması çalışmaz. '
          'flutter run --dart-define=GOOGLE_MAPS_API_KEY=... veya AppConstants yedek anahtar.',
        );
      }
      return [];
    }

    try {
      final params = <String, dynamic>{
        'input': query,
        'key': _apiKey,
        'language': 'tr',
        'components': 'country:tr',
        'types': 'geocode|establishment',
        'sessiontoken': _ensureSessionToken(),
      };

      // Konum bazlı önceliklendirme (yakındaki sonuçlar önce)
      if (location != null) {
        params['location'] = '${location.latitude},${location.longitude}';
        params['radius'] = '50000'; // 50 km yarıçap
      }

      final response = await _dio.get(
        'https://maps.googleapis.com/maps/api/place/autocomplete/json',
        queryParameters: params,
      );

      final status = response.data['status'] as String?;
      if (status == 'OK') {
        final predictions = response.data['predictions'] as List;
        return predictions
            .map((p) => PlacePrediction(
                  placeId: p['place_id'] as String,
                  description: p['description'] as String,
                  mainText: p['structured_formatting']?['main_text'] as String? ?? '',
                  secondaryText: p['structured_formatting']?['secondary_text'] as String? ?? '',
                ))
            .toList();
      }
      if (kDebugMode && status != null) {
        final msg = response.data['error_message'];
        debugPrint('Places autocomplete: $status ${msg != null ? "— $msg" : ""}');
      }
      return [];
    } catch (e) {
      return [];
    }
  }

  /// Place ID'den koordinat al (Place Details API).
  /// Bu, o ana kadarki Autocomplete çağrılarıyla aynı sessiontoken'ı taşıyıp
  /// oturumu kapatır — çağrı sonucu ne olursa olsun bir sonraki arama yeni
  /// bir oturumla (yeni token) başlasın diye token burada sıfırlanır.
  Future<PlaceDetail?> getPlaceDetails(String placeId) async {
    if (_apiKey.trim().isEmpty) return null;
    final sessionToken = _ensureSessionToken();
    _sessionToken = null;
    try {
      final response = await _dio.get(
        'https://maps.googleapis.com/maps/api/place/details/json',
        queryParameters: {
          'place_id': placeId,
          'key': _apiKey,
          'language': 'tr',
          'fields': 'geometry,formatted_address,name',
          'sessiontoken': sessionToken,
        },
      );

      final status = response.data['status'] as String?;
      if (status == 'OK') {
        final result = response.data['result'];
        final loc = result['geometry']['location'];
        return PlaceDetail(
          lat: (loc['lat'] as num).toDouble(),
          lng: (loc['lng'] as num).toDouble(),
          address: result['formatted_address'] as String? ?? result['name'] as String? ?? '',
          name: result['name'] as String? ?? '',
        );
      }
      if (kDebugMode && status != null) {
        final msg = response.data['error_message'];
        debugPrint('Place details: $status ${msg != null ? "— $msg" : ""}');
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  // ============================================================
  // DIRECTIONS — Rota ve polyline çizimi
  // ============================================================

  /// İki nokta arasındaki rota bilgisini al (ilk önerilen rota)
  Future<RouteInfo?> getDirections(LatLng origin, LatLng destination) async {
    final list = await getDirectionsAlternatives(origin, destination);
    return list.isEmpty ? null : list.first;
  }

  /// Alternatif rotalar (Google genelde en fazla 3 rota döner)
  Future<List<RouteInfo>> getDirectionsAlternatives(
    LatLng origin,
    LatLng destination,
  ) async {
    if (_apiKey.trim().isEmpty) return [];
    try {
      final response = await _dio.get(
        'https://maps.googleapis.com/maps/api/directions/json',
        queryParameters: {
          'origin': '${origin.latitude},${origin.longitude}',
          'destination': '${destination.latitude},${destination.longitude}',
          'key': _apiKey,
          'language': 'tr',
          'mode': 'driving',
          'alternatives': 'true',
        },
      );

      final dirStatus = response.data['status'] as String?;
      if (dirStatus != 'OK') {
        if (kDebugMode && dirStatus != null) {
          final msg = response.data['error_message'];
          debugPrint('Directions: $dirStatus ${msg != null ? "— $msg" : ""}');
        }
        return [];
      }

      final routes = response.data['routes'] as List;
      final result = <RouteInfo>[];

      for (var i = 0; i < routes.length; i++) {
        final route = routes[i] as Map<String, dynamic>;
        final legs = route['legs'] as List?;
        if (legs == null || legs.isEmpty) continue;

        final leg = legs[0] as Map<String, dynamic>;
        final overview = route['overview_polyline'];
        if (overview == null) continue;

        final encodedPolyline = overview['points'] as String;
        final points = _decodePolyline(encodedPolyline);
        final summary = route['summary'] as String?;

        result.add(
          RouteInfo(
            points: points,
            distanceMeters: leg['distance']['value'] as int,
            distanceText: leg['distance']['text'] as String,
            durationSeconds: leg['duration']['value'] as int,
            durationText: leg['duration']['text'] as String,
            summary: summary,
            routeIndex: i,
          ),
        );
      }

      result.sort((a, b) {
        final byFare =
            _fareForDistanceKm(a.distanceKm).compareTo(_fareForDistanceKm(b.distanceKm));
        if (byFare != 0) return byFare;
        final byDist = a.distanceMeters.compareTo(b.distanceMeters);
        if (byDist != 0) return byDist;
        return a.durationSeconds.compareTo(b.durationSeconds);
      });

      return result
          .asMap()
          .entries
          .map(
            (e) => RouteInfo(
              points: e.value.points,
              distanceMeters: e.value.distanceMeters,
              distanceText: e.value.distanceText,
              durationSeconds: e.value.durationSeconds,
              durationText: e.value.durationText,
              summary: e.value.summary,
              routeIndex: e.key,
            ),
          )
          .toList();
    } catch (e) {
      return [];
    }
  }

  /// Google'ın encoded polyline formatını LatLng listesine çöz
  /// Algoritma: https://developers.google.com/maps/documentation/utilities/polylinealgorithm
  List<LatLng> _decodePolyline(String encoded) {
    final points = <LatLng>[];
    int index = 0;
    int lat = 0;
    int lng = 0;

    while (index < encoded.length) {
      // Latitude decode
      int shift = 0;
      int result = 0;
      int b;
      do {
        b = encoded.codeUnitAt(index++) - 63;
        result |= (b & 0x1F) << shift;
        shift += 5;
      } while (b >= 0x20);
      lat += (result & 1) != 0 ? ~(result >> 1) : (result >> 1);

      // Longitude decode
      shift = 0;
      result = 0;
      do {
        b = encoded.codeUnitAt(index++) - 63;
        result |= (b & 0x1F) << shift;
        shift += 5;
      } while (b >= 0x20);
      lng += (result & 1) != 0 ? ~(result >> 1) : (result >> 1);

      points.add(LatLng(lat / 1e5, lng / 1e5));
    }

    return points;
  }
}

// ============================================================
// VERİ MODELLERİ
// ============================================================

/// Places Autocomplete sonuç önerisi
class PlacePrediction {
  final String placeId;
  final String description;
  final String mainText;
  final String secondaryText;

  const PlacePrediction({
    required this.placeId,
    required this.description,
    required this.mainText,
    required this.secondaryText,
  });
}

/// Yer detay bilgisi (koordinat + adres)
class PlaceDetail {
  final double lat;
  final double lng;
  final String address;
  final String name;

  const PlaceDetail({
    required this.lat,
    required this.lng,
    required this.address,
    required this.name,
  });
}

/// Rota bilgisi (polyline + mesafe + süre)
class RouteInfo {
  final List<LatLng> points;
  final int distanceMeters;
  final String distanceText;
  final int durationSeconds;
  final String durationText;

  /// Google özet yol adı (ör. "D750, D220"); yoksa null
  final String? summary;

  /// Yanıt içindeki sıra (0 tabanlı)
  final int routeIndex;

  const RouteInfo({
    required this.points,
    required this.distanceMeters,
    required this.distanceText,
    required this.durationSeconds,
    required this.durationText,
    this.summary,
    this.routeIndex = 0,
  });

  /// Mesafe (km cinsinden)
  double get distanceKm => distanceMeters / 1000.0;

  /// Kısa etiket (liste / seçim için)
  String get displayLabel => summary?.trim().isNotEmpty == true ? summary!.trim() : 'Rota ${routeIndex + 1}';
}
