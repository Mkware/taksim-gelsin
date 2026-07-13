import { apiClient } from './client';
import type {
  ApiSuccess,
  BroadcastResult,
  CustomerItem,
  DriverItem,
  LiveSnapshot,
  LogsData,
  OpsHealth,
  OverviewData,
  PlatformSettings,
  PricingSettings,
  ReviewListResult,
  RideItem,
  RideStatus,
  SearchingMatchingItem,
} from '../types/api';

// ---- Overview ----
export async function getOverview(): Promise<OverviewData> {
  const res = await apiClient.get<ApiSuccess<OverviewData>>('/admin/overview');
  return res.data.data;
}

// ---- Drivers ----
export async function getDrivers(): Promise<DriverItem[]> {
  const res = await apiClient.get<ApiSuccess<{ items: DriverItem[] }>>('/admin/drivers');
  return res.data.data.items;
}

export interface CreateDriverInput {
  phone: string;
  full_name: string;
  password: string;
  vehicle_plate: string;
  vehicle_model: string;
  vehicle_color: string;
}

export async function createDriver(input: CreateDriverInput): Promise<void> {
  await apiClient.post('/admin/drivers', input);
}

export interface UpdateDriverInput {
  full_name?: string;
  phone?: string;
  vehicle_plate?: string;
  vehicle_model?: string;
  vehicle_color?: string;
  password?: string;
}

export async function updateDriver(id: string, patch: UpdateDriverInput): Promise<void> {
  await apiClient.patch(`/admin/drivers/${id}`, patch);
}

export async function deleteDriver(id: string): Promise<void> {
  await apiClient.delete(`/admin/drivers/${id}`);
}

export async function addDriverBalance(id: string, amount: number): Promise<{ id: string; balance: number }> {
  const res = await apiClient.post<ApiSuccess<{ id: string; balance: number }>>(`/admin/drivers/${id}/balance`, {
    amount,
  });
  return res.data.data;
}

export async function setDriverAccess(id: string, enabled: boolean): Promise<void> {
  await apiClient.patch(`/admin/drivers/${id}/access`, { enabled });
}

// ---- Customers ----
export interface ListCustomersParams {
  q?: string;
  suspended?: 'all' | 'true' | 'false';
}

export async function getCustomers(params: ListCustomersParams = {}): Promise<CustomerItem[]> {
  const res = await apiClient.get<ApiSuccess<{ items: CustomerItem[] }>>('/admin/customers', { params });
  return res.data.data.items;
}

export interface UpdateCustomerInput {
  is_suspended?: boolean;
  full_name?: string;
  phone?: string;
}

export async function updateCustomer(id: string, patch: UpdateCustomerInput): Promise<void> {
  await apiClient.patch(`/admin/customers/${id}`, patch);
}

export async function revokeCustomerSessions(id: string): Promise<void> {
  await apiClient.post(`/admin/customers/${id}/revoke-sessions`);
}

export async function resetCustomerPassword(id: string, password: string): Promise<void> {
  await apiClient.post(`/admin/customers/${id}/reset-password`, { password });
}

export async function deleteCustomer(id: string): Promise<void> {
  await apiClient.delete(`/admin/customers/${id}`);
}

// ---- Rides ----
export interface ListRidesParams {
  status?: RideStatus | 'all';
  q?: string;
  limit?: number;
}

export async function getRides(params: ListRidesParams = {}): Promise<RideItem[]> {
  const res = await apiClient.get<ApiSuccess<{ items: RideItem[] }>>('/admin/rides', { params });
  return res.data.data.items;
}

export async function getRide(id: string): Promise<RideItem> {
  const res = await apiClient.get<ApiSuccess<RideItem>>(`/admin/rides/${id}`);
  return res.data.data;
}

export async function cancelRide(id: string, reason?: string): Promise<RideItem> {
  const res = await apiClient.post<ApiSuccess<RideItem>>(`/admin/rides/${id}/cancel`, { reason });
  return res.data.data;
}

// ---- Live Ops ----
export async function getOpsLive(): Promise<LiveSnapshot> {
  const res = await apiClient.get<ApiSuccess<LiveSnapshot>>('/admin/ops/live');
  return res.data.data;
}

export async function getOpsHealth(): Promise<OpsHealth> {
  const res = await apiClient.get<ApiSuccess<OpsHealth>>('/admin/ops/health');
  return res.data.data;
}

export async function getOpsMatching(): Promise<SearchingMatchingItem[]> {
  const res = await apiClient.get<ApiSuccess<{ items: SearchingMatchingItem[] }>>('/admin/ops/matching');
  return res.data.data.items;
}

export async function clearOpsMatching(rideId: string): Promise<void> {
  await apiClient.post(`/admin/ops/matching/${rideId}/clear`);
}

export async function recoverStaleSearching(): Promise<{ recovered: number }> {
  const res = await apiClient.post<ApiSuccess<{ recovered: number }>>('/admin/ops/stale-searching/recover');
  return res.data.data;
}

// ---- Logs ----
export async function getLogs(lines = 200): Promise<LogsData> {
  const res = await apiClient.get<ApiSuccess<LogsData>>('/admin/logs', { params: { lines } });
  return res.data.data;
}

// ---- Settings ----
export async function getPlatformSettings(): Promise<PlatformSettings> {
  const res = await apiClient.get<ApiSuccess<PlatformSettings>>('/admin/settings/platform');
  return res.data.data;
}

export async function updatePlatformSettings(patch: Partial<PlatformSettings>): Promise<PlatformSettings> {
  const res = await apiClient.put<ApiSuccess<PlatformSettings>>('/admin/settings/platform', patch);
  return res.data.data;
}

export async function getPricingSettings(): Promise<PricingSettings> {
  const res = await apiClient.get<ApiSuccess<PricingSettings>>('/admin/settings/pricing');
  return res.data.data;
}

export async function updatePricingSettings(patch: PricingSettings): Promise<PricingSettings> {
  const res = await apiClient.put<ApiSuccess<PricingSettings>>('/admin/settings/pricing', patch);
  return res.data.data;
}

export interface BroadcastInput {
  title: string;
  body: string;
  audience: 'all' | 'customers' | 'drivers' | 'user';
  userId?: string;
  phone?: string;
}

export async function sendBroadcastPush(input: BroadcastInput): Promise<BroadcastResult> {
  const res = await apiClient.post<ApiSuccess<BroadcastResult>>('/admin/push/broadcast', input);
  return res.data.data;
}

// ---- Reviews ----
export interface ListReviewsParams {
  rating?: number | 'all';
  page?: number;
  limit?: number;
}

export async function getReviews(params: ListReviewsParams = {}): Promise<ReviewListResult> {
  const res = await apiClient.get<ApiSuccess<ReviewListResult>>('/admin/reviews', { params });
  return res.data.data;
}
