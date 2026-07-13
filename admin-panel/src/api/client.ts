import axios, { AxiosError, isAxiosError, type AxiosRequestConfig } from 'axios';
import type { ApiFailure, AuthTokens } from '../types/api';
import { clearStoredAuth, getAccessToken, getRefreshToken, loadStoredAuth, saveStoredAuth } from './tokenStorage';

const API_ORIGIN = import.meta.env.VITE_API_ORIGIN as string;

export const apiClient = axios.create({
  baseURL: `${API_ORIGIN}/api/v1`,
});

// Refresh çağrısı için interceptor'sız çıplak instance — döngüyü önler.
const bareClient = axios.create({
  baseURL: `${API_ORIGIN}/api/v1`,
});

type ForceLogoutReason = 'session_replaced' | 'account_suspended' | 'refresh_failed';
type ForceLogoutHandler = (reason: ForceLogoutReason) => void;

let forceLogoutHandler: ForceLogoutHandler | null = null;
export function setForceLogoutHandler(handler: ForceLogoutHandler | null): void {
  forceLogoutHandler = handler;
}

function forceLogout(reason: ForceLogoutReason): void {
  clearStoredAuth();
  forceLogoutHandler?.(reason);
}

apiClient.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let refreshInflight: Promise<boolean> | null = null;

async function performRefresh(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  const currentAuth = loadStoredAuth();
  if (!refreshToken || !currentAuth) return false;

  try {
    const res = await bareClient.post<{ success: true; data: { user: typeof currentAuth.user; tokens: AuthTokens } }>(
      '/auth/refresh',
      { refresh_token: refreshToken },
    );
    saveStoredAuth({ user: res.data.data.user, tokens: res.data.data.tokens });
    return true;
  } catch {
    return false;
  }
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiFailure>) => {
    const originalRequest = error.config as (AxiosRequestConfig & { _retry?: boolean }) | undefined;
    const status = error.response?.status;
    const code = error.response?.data?.code;

    if (code === 'ACCOUNT_SUSPENDED') {
      forceLogout('account_suspended');
      return Promise.reject(error);
    }

    if (code === 'SESSION_REPLACED') {
      forceLogout('session_replaced');
      return Promise.reject(error);
    }

    const isRefreshCall = originalRequest?.url?.includes('/auth/refresh');

    if (status === 401 && originalRequest && !originalRequest._retry && !isRefreshCall) {
      originalRequest._retry = true;

      if (!refreshInflight) {
        refreshInflight = performRefresh().finally(() => {
          refreshInflight = null;
        });
      }

      const refreshed = await refreshInflight;
      if (refreshed) {
        const token = getAccessToken();
        originalRequest.headers = originalRequest.headers ?? {};
        (originalRequest.headers as Record<string, string>).Authorization = `Bearer ${token}`;
        return apiClient.request(originalRequest);
      }

      forceLogout('refresh_failed');
    }

    return Promise.reject(error);
  },
);

export function getErrorMessage(err: unknown, fallback = 'Bilinmeyen bir hata oluştu.'): string {
  if (isAxiosError<ApiFailure>(err)) {
    return err.response?.data?.error ?? fallback;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}
