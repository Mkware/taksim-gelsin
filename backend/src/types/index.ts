/**
 * Genel Tip Tanımlamaları
 * Backend genelinde kullanılan ortak tipler.
 */

// Kullanıcı rolleri
export type UserRole = 'customer' | 'driver';

// Yolculuk durumları
export type RideStatus =
  | 'searching'
  | 'accepted'
  | 'arriving'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

// Koordinat
export interface LatLng {
  lat: number;
  lng: number;
}

// Kullanıcı veri modeli (DB satırı)
export interface User {
  id: string;
  phone: string;
  full_name: string;
  password_hash: string;
  avatar_url: string | null;
  role: UserRole;
  rating: number;
  rating_count: number;
  refresh_token: string | null;
  created_at: string;
  updated_at: string;
}

// Sürücü veri modeli (DB satırı)
export interface Driver {
  id: string;
  vehicle_plate: string;
  vehicle_model: string;
  vehicle_color: string;
  is_online: boolean;
  is_available: boolean;
  current_location: unknown; // PostGIS GEOGRAPHY tipi
  last_location_update: string | null;
  total_rides: number;
  created_at: string;
  updated_at: string;
}

// Yolculuk veri modeli (DB satırı)
export interface Ride {
  id: string;
  customer_id: string;
  driver_id: string | null;
  pickup_location: unknown; // PostGIS GEOGRAPHY tipi
  dropoff_location: unknown;
  pickup_address: string;
  dropoff_address: string;
  distance_km: number | null;
  estimated_price: number;
  final_price: number | null;
  status: RideStatus;
  requested_at: string;
  accepted_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;
}

// Değerlendirme veri modeli (DB satırı)
export interface Review {
  id: string;
  ride_id: string;
  reviewer_id: string;
  reviewed_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
}

// API yanıt formatı — tüm endpoint'ler bu yapıyı döner
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// Sayfalama parametreleri
export interface PaginationParams {
  page: number;
  limit: number;
}

// Sayfalı yanıt
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// Yakın sürücü bilgisi (find_nearby_drivers fonksiyonu sonucu)
export interface NearbyDriver {
  driver_id: string;
  full_name: string;
  phone: string;
  vehicle_plate: string;
  vehicle_model: string;
  vehicle_color: string;
  rating: number;
  distance_meters: number;
  lat: number;
  lng: number;
}

// Express Request'e eklenen kullanıcı bilgisi (auth middleware sonrası)
export interface AuthenticatedUser {
  userId: string;
  role: UserRole;
  /** JWT içindeki oturum sürümü (logout kararı için) */
  sessionVersion?: number;
}
