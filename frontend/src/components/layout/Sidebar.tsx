import { useNavigate } from "react-router-dom";
import { LogOut } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { PRIMARY_NAV, SECONDARY_NAV } from "@/constants/navigation";
import { useAuth } from "@/contexts/AuthContext";
import SidebarNavItem from "./SidebarNavItem";

const getInitials = (name: string): string => {
  const parts = name.trim().split(" ");
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
};

const Sidebar = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  const initials = user?.name ? getInitials(user.name) : "?";

  return (
    <aside className="fixed inset-y-0 left-0 z-20 flex w-60 flex-col border-r border-border bg-sidebar">

      {/* Brand */}
      <div className="flex h-14 shrink-0 flex-col items-center justify-center border-b border-border px-4">
        <img src="/logo.svg" alt="DMS" className="h-5 w-auto" />
        <span className="mt-0.5 text-[10px] font-medium text-muted-foreground">Document Management System</span>
      </div>

      {/* Primary nav */}
      <nav className="flex flex-1 flex-col gap-0.5 px-2 py-2 overflow-y-auto">
        {PRIMARY_NAV.map((item) => {
          if (item.label === "Approvals" && user?.role === "uploader") return null;
          return <SidebarNavItem key={item.path} {...item} />;
        })}
      </nav>

      {/* Admin nav */}
      {user?.role === "Admin" && (
        <>
          <div className="border-t border-border" />
          <div className="px-2 py-2">
            {SECONDARY_NAV.map((item) => (
              <SidebarNavItem key={item.path} {...item} />
            ))}
          </div>
        </>
      )}

      {/* User section */}
      <div className="border-t border-border px-3 py-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex w-full items-center gap-2.5 rounded-md px-1 py-1.5 hover:bg-accent/60 transition-colors outline-none">
              <Avatar className="size-7 shrink-0">
                <AvatarFallback className="bg-primary text-primary-foreground text-[11px] font-semibold">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-1 flex-col text-left">
                <span className="truncate text-xs font-medium text-foreground leading-tight">
                  {user?.name}
                </span>
                <span className="truncate text-[11px] text-muted-foreground leading-tight">
                  {user?.email}
                </span>
              </div>
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent side="top" align="start" className="w-52 mb-1">
            <DropdownMenuLabel className="font-normal py-2">
              <div className="flex items-center gap-2.5">
                <Avatar className="size-8 shrink-0">
                  <AvatarFallback className="bg-primary text-primary-foreground text-xs font-semibold">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-medium text-foreground truncate">{user?.name}</span>
                  <span className="text-xs text-muted-foreground truncate">{user?.email}</span>
                </div>
              </div>
            </DropdownMenuLabel>

            <DropdownMenuSeparator />

            <DropdownMenuItem
              className="gap-2 text-sm text-destructive focus:text-destructive focus:bg-destructive/10"
              onClick={handleLogout}
            >
              <LogOut className="size-3.5" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

    </aside>
  );
};

export default Sidebar;
