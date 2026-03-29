import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import RequireAuth from "@/components/auth/RequireAuth";
import RequireRole from "@/components/auth/RequireRole";
import AppLayout from "@/components/layout/AppLayout";
import LoginPage from "@/pages/LoginPage";
import DashboardPage from "@/pages/DashboardPage";
import DocumentsPage from "@/pages/DocumentsPage";
import DocumentViewerPage from "@/pages/DocumentViewerPage";
import TasksPage from "@/pages/TasksPage";
import AdminPage from "@/pages/AdminPage";
import TrashPage from "@/pages/TrashPage";
import AuditLogPage from "@/pages/AuditLogPage";

const App = () => {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<RequireAuth />}>
            <Route element={<AppLayout />}>
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/documents" element={<DocumentsPage />} />
              <Route path="/documents/:id" element={<DocumentViewerPage />} />
              <Route element={<RequireRole roles={["Admin", "reviewer"]} />}>
                <Route path="/tasks" element={<TasksPage />} />
              </Route>
              <Route element={<RequireRole roles={["Admin"]} />}>
                <Route path="/admin" element={<AdminPage />} />
                <Route path="/trash" element={<TrashPage />} />
                <Route path="/audit" element={<AuditLogPage />} />
              </Route>
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
};

export default App;
