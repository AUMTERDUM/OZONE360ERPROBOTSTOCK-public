import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { DataProvider } from './context/DataContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { ConfirmProvider } from './context/ConfirmContext';
import { ThemeProvider } from './context/ThemeContext';
import MascotLoader from './components/MascotLoader';
import ErrorBoundary from './components/ErrorBoundary';

import Dashboard from './pages/Dashboard';
import Robots from './pages/Robots';
import Customers from './pages/Customers';
import CustomerParts from './pages/CustomerParts';
import Maintenance from './pages/Maintenance';
import MASchedule from './pages/MASchedule';
import SiteSurvey from './pages/SiteSurvey';
import Login from './pages/Login';
import Models from './pages/Models';
import PuduImport from './pages/PuduImport';
import Users from './pages/Users';
import ActivityLog from './pages/ActivityLog';
import Warehouses from './pages/Warehouses';
import DeliveryNotes from './pages/DeliveryNotes';
import RobotLoans from './pages/RobotLoans';
import SpareParts from './pages/SpareParts';
import Trash from './pages/Trash';
import Backup from './pages/Backup';
import PurchaseOrders from './pages/PurchaseOrders';
import ProjectRequests from './pages/ProjectRequests';
import TrackRepair from './pages/TrackRepair';
import RobotPublic from './pages/RobotPublic';
import Report from './pages/Report';
import Accounts from './pages/Accounts';
import MaterialRequests from './pages/MaterialRequests';
import TravelExpenses from './pages/TravelExpenses';
import CustomerPortal from './pages/CustomerPortal';
import NotFound from './pages/NotFound';

// Remember where the user was heading (e.g. a link from a notification or chat) so login returns there.
const loginRedirect = (location: { pathname: string; search: string }) =>
  `/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`;

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, checking } = useAuth();
  const location = useLocation();
  if (checking) return <MascotLoader minHeight="100vh" />;
  if (!isAuthenticated) return <Navigate to={loginRedirect(location)} replace />;
  return <>{children}</>;
};

const AdminRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isAuthenticated, checking } = useAuth();
  const location = useLocation();
  if (checking) return <MascotLoader />;
  if (!isAuthenticated) return <Navigate to={loginRedirect(location)} replace />;
  if (user?.role !== 'ADMIN') return <Navigate to="/" replace />;
  return <>{children}</>;
};

function App() {
  return (
    <ErrorBoundary>
    <ThemeProvider>
    <AuthProvider>
      <ToastProvider>
        <ConfirmProvider>
        <DataProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/track/:token" element={<TrackRepair />} />
              <Route path="/robot/:sn" element={<RobotPublic />} />
              <Route path="/portal/:token" element={<CustomerPortal />} />
              <Route path="*" element={<NotFound />} />
              <Route path="/" element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }>
                <Route index element={<Dashboard />} />
                <Route path="inventory" element={<Robots />} />
                <Route path="models" element={<Models />} />
                <Route path="customers" element={<Customers />} />
                <Route path="customer-parts" element={<CustomerParts />} />
                <Route path="maintenance" element={<Maintenance />} />
                <Route path="ma-schedule" element={<MASchedule />} />
                <Route path="site-survey" element={<SiteSurvey />} />
                <Route path="pudu/import" element={<PuduImport />} />
                <Route path="users" element={<AdminRoute><Users /></AdminRoute>} />
                <Route path="warehouses" element={<Warehouses />} />
                <Route path="delivery-notes" element={<DeliveryNotes />} />
                <Route path="robot-loans" element={<RobotLoans />} />
                <Route path="spare-parts" element={<SpareParts />} />
                <Route path="activity-log" element={<AdminRoute><ActivityLog /></AdminRoute>} />
                <Route path="trash" element={<AdminRoute><Trash /></AdminRoute>} />
                <Route path="backup" element={<AdminRoute><Backup /></AdminRoute>} />
                <Route path="purchase-orders" element={<PurchaseOrders />} />
                <Route path="project-requests" element={<ProjectRequests />} />
                <Route path="report" element={<Report />} />
                <Route path="accounts" element={<Accounts />} />
                <Route path="material-requests" element={<MaterialRequests />} />
                <Route path="travel-expenses" element={<TravelExpenses />} />
                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </DataProvider>
        </ConfirmProvider>
      </ToastProvider>
    </AuthProvider>
    </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
