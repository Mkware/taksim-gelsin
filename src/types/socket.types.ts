/**
 * Socket.io Tip Tanımlamaları
 * Client ↔ Server arası tüm event'lerin tip güvenliği.
 */

import { LatLng, RideStatus } from './index';

// ============================================================
// CLIENT → SERVER Event'leri
// ============================================================

// Sürücü çevrimiçi olma
export interface DriverGoOnlinePayload {
  driverId: string;
}

// Sürücü çevrimdışı olma
export interface DriverGoOfflinePayload {
  driverId: string;
}

// Sürücü konum güncelleme
export interface DriverLocationUpdatePayload {
  driverId: string;
  lat: number;
  lng: number;
  bearing: number;
}

// Yolculuk isteği (müşteriden)
export interface RideRequestPayload {
  customerId: string;
  pickup: LatLng;
  dropoff: LatLng;
  pickupAddress: string;
  dropoffAddress: string;
  estimatedPrice: number;
  distanceKm: number;
}

// Sürücü yolculuk kabul
export interface RideAcceptPayload {
  driverId: string;
  rideId: string;
}

// Sürücü yolculuk ret
export interface RideRejectPayload {
  driverId: string;
  rideId: string;
}

// Sürücü vardı bildirimi
export interface RideArrivedPayload {
  driverId: string;
  rideId: string;
}

// Yolculuk başlatma
export interface RideStartPayload {
  driverId: string;
  rideId: string;
}

// Yolculuk tamamlama
export interface RideCompletePayload {
  driverId: string;
  rideId: string;
  finalPrice: number;
}

// Yolculuk iptal
export interface RideCancelPayload {
  userId: string;
  rideId: string;
  reason: string;
}

// Sürücü: yolcudan aldığı 4 haneli biniş kodunu doğrula
export interface RideVerifyPickupCodePayload {
  rideId: string;
  code: string;
}

// ============================================================
// SERVER → CLIENT Event'leri
// ============================================================

// Sürücü konum yayını (müşteriye)
export interface DriverLocationBroadcast {
  driverId: string;
  lat: number;
  lng: number;
  bearing: number;
}

// Yeni yolculuk isteği (sürücüye)
export interface RideNewRequestEvent {
  rideId: string;
  /** Bu çağrının teklif edildiği sürücü (UUID) — istemci yanlış oda/FCM için doğrulama */
  targetDriverId: string;
  pickup: LatLng;
  dropoff: LatLng;
  pickupAddress: string;
  dropoffAddress: string;
  price: number;
  distanceKm: number;
  customerInfo: {
    id: string;
    fullName: string;
    phone: string;
    rating: number;
  };
  /** Kabul öncesi: gerçek biniş gizlendi */
  pickupMasked?: boolean;
  /** Yaklaşık alım belirsizliği (m) */
  pickupUncertaintyM?: number;
  /** Kabul anında kesilecek sabit T Coin */
  acceptFeeTcoin?: number;
  /** Sürücü güncel bakiye (T Coin) */
  balanceTcoin?: number;
  /** Kabul penceresinin bittiği an (epoch ms) — istemci geri sayımı arka plan/uyku sonrası senkronlar */
  responseDeadlineMs?: number;
  /** Sunucu ayarı ile aynı pencere (sn) — deadline yoksa geri sayım */
  responseTimeoutSeconds?: number;
}

// Yolculuk kabul edildi (müşteriye)
export interface RideAcceptedEvent {
  rideId: string;
  /** Yolcunun sürücüye söyleyeceği 4 haneli kod (yalnızca müşteri alır) */
  verificationCode: string;
  /** İstemci uyumluluğu — verificationCode ile aynı değer */
  pickupVerificationCode?: string;
  pickup_verification_code?: string;
  driverInfo: {
    id: string;
    fullName: string;
    phone: string;
    rating: number;
    vehiclePlate: string;
    vehicleModel: string;
    vehicleColor: string;
    lat: number;
    lng: number;
  };
  eta: number; // Tahmini varış süresi (dakika)
}

// Sürücü vardı (müşteriye)
export interface RideDriverArrivedEvent {
  rideId: string;
  /** Bildirimin hedef yolcusu — başka oturumlar yok sayar */
  targetCustomerId?: string;
}

// Yolculuk başladı
export interface RideStartedEvent {
  rideId: string;
}

// Yolculuk tamamlandı
export interface RideCompletedEvent {
  rideId: string;
  finalPrice: number;
}

// Yolculuk iptal edildi
export interface RideCancelledEvent {
  rideId: string;
  reason: string;
  cancelledBy: 'customer' | 'driver' | 'admin';
}

// Sürücü bulunamadı
export interface RideNoDriverFoundEvent {
  rideId: string;
}

// Sunucu yolculuk oluşturdu, müşteri yerel temp id'yi bununla değiştirmeli
export interface RideSearchingEvent {
  rideId: string;
}

/** Müşteri arama ekranı — kaç sürücüye sorulduğu ve en fazla bekleme süresi */
export interface RideMatchingProgressEvent {
  rideId: string;
  /** Eşleştirme kuyruğundaki toplam sürücü sayısı (en fazla 5) */
  driversQueued: number;
  /** Şimdiye kadar teklif gönderilen sürücü sayısı */
  driversAsked: number;
  /** Kuyrukta henüz sorulmamış sürücü sayısı */
  driversRemainingInQueue: number;
  /** Kötü senaryo: kalan süre (sn) — mevcut teklif + sıradakiler × yanıt penceresi */
  maxWaitSeconds: number;
  /** Aktif teklif varsa o sürücünün yanıt penceresi kalan süresi (sn) */
  currentOfferSecondsLeft?: number;
  /** Admin ayarı — sürücü başına yanıt süresi (sn) */
  driverResponseTimeoutSeconds: number;
}

// Müşteri arama sırasında iptal — sürücüdeki bekleyen istek geçersiz
export interface RideRequestCancelledEvent {
  rideId: string;
  /** İstemci uyarı metni / davranışı için (opsiyonel) */
  reason?: 'customer_cancelled' | 'no_driver' | 'accept_failed' | 'accepted_by_other' | string;
  message?: string;
}

/** Kabul sonrası sürücüye tam biniş/iniş koordinatları */
export interface RideRevealLocationEvent {
  rideId: string;
  pickup: LatLng;
  dropoff: LatLng;
  balanceTcoin?: number;
  pickupVerificationCode?: string;
}

/** Bakiye yetersiz vb. */
export interface RideAcceptFailedEvent {
  rideId: string;
  reason: string;
  message?: string;
}

/** Çevrimiçi olma isteği bakiye yüzünden reddedildi */
export interface DriverOnlineBlockedEvent {
  reason: string;
  minBalance: number;
  balance: number;
  message?: string;
}

/** Sunucu bakiye bitti diye çevrimdışı çekti */
export interface DriverForcedOfflineEvent {
  reason: 'ZERO_BALANCE';
  balance: number;
  message?: string;
}

/** driver:go_online sunucu onayı (DB'ye yazıldı) */
export interface DriverOnlineConfirmedEvent {
  isOnline: true;
  /** Sunucu zamanındaki onay anı (epoch ms) */
  at: number;
  /** Sürücü güncel bakiyesi (T Coin) */
  balanceTcoin?: number;
}

// Aktif yolculuk snapshot'ı (reconnect / kaldığı yerden devam)
export interface RideSnapshotEvent {
  ride: {
    id: string;
    customerId: string;
    driverId: string | null;
    pickupAddress: string;
    dropoffAddress: string;
    pickupLat: number | null;
    pickupLng: number | null;
    dropoffLat: number | null;
    dropoffLng: number | null;
    distanceKm: number | null;
    estimatedPrice: number;
    finalPrice: number | null;
    status: RideStatus;
    requestedAt: string;
    acceptedAt: string | null;
    startedAt: string | null;
    pickupVerificationCode?: string | null;
    pickupCodeVerified?: boolean;
  };
  driver?: {
    id: string;
    fullName: string;
    phone: string;
    rating: number;
    vehiclePlate: string;
    vehicleModel: string;
    vehicleColor: string;
    lat?: number;
    lng?: number;
    bearing?: number;
  } | null;
  customer?: {
    id: string;
    fullName: string;
    phone: string;
    rating: number;
  } | null;
}

// ============================================================
// Socket.io Event Map Tipleri
// ============================================================

// Client'tan Server'a gönderilen event'ler
export interface ClientToServerEvents {
  'driver:go_online': (payload: DriverGoOnlinePayload) => void;
  'driver:go_offline': (payload: DriverGoOfflinePayload) => void;
  'driver:location:update': (payload: DriverLocationUpdatePayload) => void;
  'ride:request': (payload: RideRequestPayload) => void;
  'ride:accept': (payload: RideAcceptPayload) => void;
  'ride:reject': (payload: RideRejectPayload) => void;
  'ride:arrived': (payload: RideArrivedPayload) => void;
  'ride:start': (payload: RideStartPayload) => void;
  'ride:complete': (payload: RideCompletePayload) => void;
  'ride:cancel': (payload: RideCancelPayload) => void;
  'ride:verify_pickup_code': (payload: RideVerifyPickupCodePayload) => void;
}

// Oturum sonlandı (başka cihaz girişi veya çıkışta tüm socket'ler)
export interface AuthSessionEndedEvent {
  reason: 'other_device_login' | 'logout';
}

// Server'dan Client'a gönderilen event'ler
export interface ServerToClientEvents {
  'auth:session_ended': (payload: AuthSessionEndedEvent) => void;
  'driver:location:broadcast': (payload: DriverLocationBroadcast) => void;
  'ride:new_request': (payload: RideNewRequestEvent) => void;
  'ride:accepted': (payload: RideAcceptedEvent) => void;
  'ride:driver_arrived': (payload: RideDriverArrivedEvent) => void;
  'ride:started': (payload: RideStartedEvent) => void;
  /** Yolculuk başlatılamadı (ör. biniş kodu doğrulanmadı) */
  'ride:start_rejected': (payload: { rideId: string; message: string }) => void;
  'ride:completed': (payload: RideCompletedEvent) => void;
  'ride:cancelled': (payload: RideCancelledEvent) => void;
  'ride:no_driver_found': (payload: RideNoDriverFoundEvent) => void;
  'ride:status_update': (payload: { rideId: string; status: RideStatus }) => void;
  'ride:searching': (payload: RideSearchingEvent) => void;
  'ride:matching_progress': (payload: RideMatchingProgressEvent) => void;
  'ride:request_cancelled': (payload: RideRequestCancelledEvent) => void;
  'ride:snapshot': (payload: RideSnapshotEvent) => void;
  /** Sürücü kabul sonrası tam biniş/iniş */
  'ride:reveal_location': (payload: RideRevealLocationEvent) => void;
  /** Kabul başarısız (bakiye vb.) */
  'ride:accept_failed': (payload: RideAcceptFailedEvent) => void;
  /** Sürücü PIN doğrulama sonucu */
  'ride:pickup_code_result': (payload: { rideId: string; ok: boolean; message?: string }) => void;
  /** driver:go_online — yetersiz T Coin */
  'driver:online_blocked': (payload: DriverOnlineBlockedEvent) => void;
  /** Bakiye 0 (veya altı) — çevrimdışı zorlandı */
  'driver:forced_offline': (payload: DriverForcedOfflineEvent) => void;
  /** driver:go_online sunucuda başarı ile uygulandı (DB+Redis) */
  'driver:online_confirmed': (payload: DriverOnlineConfirmedEvent) => void;
  /** Yolculuk tamamlama isteği başarısız (ör. yetki, hatalı fiyat) */
  'ride:complete_failed': (payload: { rideId: string; message: string }) => void;
}

// Socket.io dahili event'ler
export interface InterServerEvents {
  ping: () => void;
}

// Socket verisi (her bağlantıda taşınan kullanıcı bilgisi)
export interface SocketData {
  userId: string;
  role: 'customer' | 'driver';
  /** JWT sessionVersion; girişte eski oturumları ayıklamak için */
  sessionVersion?: number;
  /**
   * Aynı kullanıcı yeni bir socket açtığında eski socket bu bayrakla kapatılır.
   * disconnect handler'ları bu bayrağı görünce "çevrimdışı yap" mantığını atlar
   * (reconnect sırasında yanlışlıkla offline yapılmaması için).
   */
  replaced?: boolean;
}
