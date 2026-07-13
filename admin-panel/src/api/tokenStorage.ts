import type { AdminUser, AuthTokens } from '../types/api';

const STORAGE_KEY = 'admin_auth';

interface StoredAuth {
  tokens: AuthTokens;
  user: AdminUser;
}

export function loadStoredAuth(): StoredAuth | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredAuth;
  } catch {
    return null;
  }
}

export function saveStoredAuth(auth: StoredAuth): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
}

export function clearStoredAuth(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function getAccessToken(): string | null {
  return loadStoredAuth()?.tokens.access_token ?? null;
}

export function getRefreshToken(): string | null {
  return loadStoredAuth()?.tokens.refresh_token ?? null;
}
