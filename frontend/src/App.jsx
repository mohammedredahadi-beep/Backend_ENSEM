import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './services/AuthContext';

// Auth
import Login from './modules/auth/Login';
import Register from './modules/auth/Register';
import EmailVerify from './modules/auth/EmailVerify';
import PendingApproval from './modules/auth/PendingApproval';

// Admin
import AdminLayout from './modules/admin/AdminLayout';
import Dashboard from './modules/admin/Dashboard';
import LaureatList from './modules/admin/LaureatList';
import ValidationQueue from './modules/admin/ValidationQueue';
import AgentList from './modules/admin/AgentList';
import EmergencyPass from './modules/admin/EmergencyPass';

// Laureate
import PassView from './modules/laureate/PassView';

// Agent
import Scanner from './modules/agent/Scanner';

function ProtectedRoute({ children, roles }) {
  const { user, loading } = useAuth();
  if (loading) return null; // Attendre que l'auth soit résolue
  if (!user) return <Navigate to="/auth/login" replace />;
  if (roles && !roles.includes(user.role)) {
    // Rediriger vers la bonne page selon le rôle, pas vers "/" (évite la boucle)
    if (user.role === 'admin') return <Navigate to="/admin/dashboard" replace />;
    if (user.role === 'agent') return <Navigate to="/agent/scanner" replace />;
    return <Navigate to="/pass" replace />;
  }
  return children;
}

function RoleRedirect() {
  const { user, loading } = useAuth();
  if (loading) return null; // Attendre que l'auth soit résolue
  if (!user) return <Navigate to="/auth/login" replace />;
  if (user.role === 'admin') return <Navigate to="/admin/dashboard" replace />;
  if (user.role === 'agent') return <Navigate to="/agent/scanner" replace />;
  return <Navigate to="/pass" replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* Public */}
        <Route path="/" element={<RoleRedirect />} />
        <Route path="/auth/login" element={<Login />} />
        <Route path="/auth/register" element={<Register />} />
        <Route path="/auth/verify-email/:token" element={<EmailVerify />} />
        <Route path="/auth/pending" element={<PendingApproval />} />

        {/* Admin */}
        <Route path="/admin" element={<ProtectedRoute roles={['admin']}><AdminLayout /></ProtectedRoute>}>
          <Route index element={<Navigate to="/admin/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="laureats" element={<LaureatList />} />
          <Route path="validation" element={<ValidationQueue />} />
          <Route path="agents" element={<AgentList />} />
          <Route path="emergency" element={<EmergencyPass />} />
        </Route>

        {/* Lauréat */}
        <Route path="/pass" element={<ProtectedRoute roles={['laureate']}><PassView /></ProtectedRoute>} />

        {/* Agent */}
        <Route path="/agent/scanner" element={<ProtectedRoute roles={['agent', 'admin']}><Scanner /></ProtectedRoute>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
