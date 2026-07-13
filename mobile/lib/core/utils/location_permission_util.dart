import 'package:geolocator/geolocator.dart';

/// Ön planda konum izni — [whileInUse] / [always] iken [Geolocator.requestPermission] çağrılmaz
/// (Android’de gereksiz ikinci izin diyaloğu riskini azaltır).
Future<LocationPermission> requestForegroundLocationPermission() async {
  var permission = await Geolocator.checkPermission();
  switch (permission) {
    case LocationPermission.whileInUse:
    case LocationPermission.always:
      return permission;
    case LocationPermission.deniedForever:
      return permission;
    case LocationPermission.denied:
      return Geolocator.requestPermission();
    case LocationPermission.unableToDetermine:
      return Geolocator.requestPermission();
  }
}
