import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

const RequireAuth = () => {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    // Avoid flashing the login page while the /auth/me check is in-flight
    return <div className="min-h-screen bg-background" />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
};

export default RequireAuth;
