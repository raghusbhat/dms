import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

interface Props {
  roles: string[];
}

const RequireRole = ({ roles }: Props) => {
  const { user } = useAuth();

  if (!user || !roles.includes(user.role ?? "")) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
};

export default RequireRole;
