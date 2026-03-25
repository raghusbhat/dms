import { LogOut } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { PRIMARY_NAV, SECONDARY_NAV } from "@/constants/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import SidebarNavItem from "./SidebarNavItem";

const Sidebar = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <aside className="fixed inset-y-0 left-0 z-20 flex w-60 flex-col border-r border-border bg-sidebar">
      {/* Brand */}
      <div className="flex h-14 items-center border-b border-border px-4">
        <img src="/logo.svg" alt="DMS" className="h-7 w-auto" />
      </div>

      {/* Primary nav */}
      <nav className="flex flex-1 flex-col gap-0.5 px-3 py-4">
        {PRIMARY_NAV.map((item) => (
          <SidebarNavItem key={item.path} {...item} />
        ))}
      </nav>

      {/* Secondary nav + user */}
      <div className="border-t border-border px-3 py-3 flex flex-col gap-0.5">
        {SECONDARY_NAV.map((item) => (
          <SidebarNavItem key={item.path} {...item} />
        ))}

        {/* User + logout */}
        <div className="mt-1 flex items-center justify-between rounded-md px-3 py-2">
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-xs font-medium text-foreground">{user?.name}</span>
            <span className="truncate text-xs text-muted-foreground">{user?.email}</span>
          </div>
          <button
            onClick={handleLogout}
            className={cn(
              "ml-2 shrink-0 rounded p-1 text-muted-foreground",
              "hover:bg-accent hover:text-accent-foreground transition-colors"
            )}
            title="Sign out"
          >
            <LogOut className="size-3.5" />
          </button>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
