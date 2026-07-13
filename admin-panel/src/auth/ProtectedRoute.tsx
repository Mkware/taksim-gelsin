import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './AuthContext';

export function ProtectedRoute() {
  const { user } = useAuth();
  if (!user?.is_admin) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}
