import { apiClient } from './client';
import type { ApiSuccess, LoginResponseData } from '../types/api';

export async function login(phone: string, password: string): Promise<LoginResponseData> {
  const res = await apiClient.post<ApiSuccess<LoginResponseData>>('/auth/login', { phone, password });
  return res.data.data;
}

export async function logout(): Promise<void> {
  await apiClient.post('/auth/logout');
}
