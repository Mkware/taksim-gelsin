import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { notifications } from '@mantine/notifications';
import * as authApi from '../api/auth';
import { setForceLogoutHandler } from '../api/client';
import { clearStoredAuth, loadStoredAuth, saveStoredAuth } from '../api/tokenStorage';
import type { AdminUser } from '../types/api';

interface AuthContextValue {
  user: AdminUser | null;
  isLoading: boolean;
  login: (phone: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const FORCE_LOGOUT_MESSAGES: Record<string, string> = {
  session_replaced: 'Hesabınıza başka bir yerden giriş yapıldı. Lütfen tekrar giriş yapın.',
  account_suspended: 'Hesabınız askıya alınmış. Destek ile iletişime geçin.',
  refresh_failed: 'Oturumunuzun süresi doldu. Lütfen tekrar giriş yapın.',
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(() => loadStoredAuth()?.user ?? null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    setForceLogoutHandler((reason) => {
      setUser(null);
      notifications.show({
        color: 'red',
        title: 'Oturum sonlandırıldı',
        message: FORCE_LOGOUT_MESSAGES[reason] ?? 'Oturum sonlandırıldı, lütfen tekrar giriş yapın.',
      });
    });
    return () => setForceLogoutHandler(null);
  }, []);

  const login = useCallback(async (phone: string, password: string) => {
    setIsLoading(true);
    try {
      const data = await authApi.login(phone, password);
      if (!data.user.is_admin) {
        throw new Error('Bu hesabın yönetim paneline erişim yetkisi yok.');
      }
      saveStoredAuth({ user: data.user, tokens: data.tokens });
      setUser(data.user);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // Bayat oturumda bile çıkış güvenli — hatayı yok say.
    } finally {
      clearStoredAuth();
      setUser(null);
    }
  }, []);

  const value = useMemo(() => ({ user, isLoading, login, logout }), [user, isLoading, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth, AuthProvider içinde kullanılmalı.');
  return ctx;
}
