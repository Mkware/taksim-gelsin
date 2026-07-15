import { Navigate, Route, Routes } from 'react-router-dom';
import { LoginPage } from './auth/LoginPage';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { AppLayout } from './components/AppLayout';
import { OverviewPage } from './pages/OverviewPage';
import { DriversPage } from './pages/DriversPage';
import { CustomersPage } from './pages/CustomersPage';
import { RidesPage } from './pages/RidesPage';
import { LiveOpsPage } from './pages/LiveOpsPage';
import { LogsPage } from './pages/LogsPage';
import { SettingsPage } from './pages/SettingsPage';
import { ReviewsPage } from './pages/ReviewsPage';
import { WalletLedgerPage } from './pages/WalletLedgerPage';
import { AuditLogPage } from './pages/AuditLogPage';

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/overview" element={<OverviewPage />} />
          <Route path="/live-ops" element={<LiveOpsPage />} />
          <Route path="/drivers" element={<DriversPage />} />
          <Route path="/customers" element={<CustomersPage />} />
          <Route path="/rides" element={<RidesPage />} />
          <Route path="/reviews" element={<ReviewsPage />} />
          <Route path="/wallet" element={<WalletLedgerPage />} />
          <Route path="/audit-log" element={<AuditLogPage />} />
          <Route path="/logs" element={<LogsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/overview" replace />} />
    </Routes>
  );
}

export default App;
