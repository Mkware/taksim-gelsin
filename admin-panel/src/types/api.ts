export interface ApiSuccess<T> {
  success: true;
  message?: string;
  data: T;
}

export interface ApiFailure {
  success: false;
  error: string;
  code?: 'SESSION_REPLACED' | 'ACCOUNT_SUSPENDED' | string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export interface AdminUser {
  id: string;
  phone: string;
  full_name: string;
  role: 'customer' | 'driver';
  is_admin: boolean;
  [key: string]: unknown;
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
}

export interface LoginResponseData {
  user: AdminUser;
  tokens: AuthTokens;
}

export interface OverviewData {
  users: number;
  drivers: number;
  activeRides: number;
  completedToday: number;
  revenueToday: number;
  revenueMonth: number;
}

export interface DriverItem {
  id: string;
  is_online: boolean;
  is_available: boolean;
  vehicle_plate: string;
  vehicle_model: string;
  vehicle_color: string;
  balance: number;
  users: {
    full_name: string;
    phone: string;
    rating: number | null;
    rating_count: number | null;
  } | null;
}

export interface CustomerItem {
  id: string;
  phone: string;
  full_name: string;
  role: 'customer';
  rating: number | null;
  rating_count: number | null;
  created_at: string;
  is_suspended: boolean;
  completed_rides: number;
  has_active_ride: boolean;
}

export type RideStatus =
  | 'searching'
  | 'accepted'
  | 'arriving'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

export interface RideItem {
  id: string;
  customer_id: string;
  driver_id: string | null;
  pickup_address: string;
  dropoff_address: string;
  distance_km: number | null;
  estimated_price: number | null;
  final_price: number | null;
  platform_fee: number | null;
  status: RideStatus;
  requested_at: string;
  accepted_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  can_cancel: boolean;
}

// ---- Live Ops ----
export interface MatchingDiagnostics {
  rideId: string;
  driversQueued: number;
  driversAsked: number;
  queueRemaining: number;
  queueDriverIds: string[];
  rejectedDriverIds: string[];
  pendingDriverId: string | null;
  offerSecondsLeft: number | null;
  hasMatchingQueue: boolean;
}

export interface LiveDriver {
  id: string;
  full_name: string | null;
  phone: string | null;
  vehicle_plate: string | null;
  is_available: boolean;
  lat: number | null;
  lng: number | null;
  bearing: number;
  locationUpdatedAt: number | null;
  hasLocation: boolean;
}

export interface LiveRide {
  id: string;
  status: RideStatus;
  customer_id: string;
  driver_id: string | null;
  pickup_address: string;
  dropoff_address: string;
  requested_at: string;
  estimated_price: number | null;
  customer_name: string | null;
  driver_name: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  matching: MatchingDiagnostics | null;
}

export interface LiveSnapshot {
  drivers: LiveDriver[];
  rides: LiveRide[];
  fetchedAt: string;
}

export interface OpsHealth {
  status: 'ready' | 'degraded';
  redis: 'ok' | 'error';
  database: 'ok' | 'error';
  onlineDriversSocket: number;
  searchingRides: number;
  staleSearchingMinutes: number;
  timestamp: string;
}

export interface SearchingMatchingItem {
  id: string;
  status: RideStatus;
  customer_id: string;
  pickup_address: string;
  requested_at: string;
  estimated_price: number | null;
  customer_name: string | null;
  customer_phone: string | null;
  matching: MatchingDiagnostics;
}

// ---- Logs ----
export interface LogsData {
  out: string[];
  error: string[];
  fetchedAt: string;
  configured: boolean;
  message?: string;
}

// ---- Settings ----
export interface PlatformSettings {
  rideAcceptFeePercent: number;
  minDriverOnlineBalanceTcoin: number;
  pickupMaskRadiusM: number;
  matchingRoadMatrixMaxDrivers: number;
  drivingDistanceCacheTtlSec: number;
  driverResponseTimeoutSeconds: number;
  walletCardSimulationEnabled: boolean;
}

export interface PricingSettings {
  entryDaily: number;
  entryWeekly: number;
  entryMonthly: number;
  commissionPercent: number;
  commissionFlat: number;
  minCommission: number;
}

export interface BroadcastResult {
  totalTokens: number;
  successCount: number;
  targetUserId?: string;
}

// ---- Reviews ----
export interface ReviewUserRef {
  id: string;
  full_name: string;
  phone: string;
  role: 'customer' | 'driver';
}

export interface ReviewItem {
  id: string;
  ride_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  reviewer: ReviewUserRef;
  reviewed: ReviewUserRef;
  ride: { id: string; pickup_address: string; dropoff_address: string } | null;
}

export interface ReviewListResult {
  items: ReviewItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  counts: Record<1 | 2 | 3 | 4 | 5, number>;
}
