import { useState } from "react";
import { useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, LogOut, FolderOpen } from "lucide-react";
import FolderPanel from "@/components/folders/FolderPanel";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PRIMARY_NAV, SECONDARY_NAV } from "@/constants/navigation";
import { useAuth } from "@/contexts/AuthContext";
import SidebarNavItem from "./SidebarNavItem";

const getInitials = (name: string): string => {
  const parts = name.trim().split(" ");
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
};

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

const Sidebar = ({ collapsed, onToggle }: SidebarProps) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const folderIdParam = searchParams.get("folder_id");
  const isDocumentsPage = location.pathname === "/documents";
  const [docsExpanded, setDocsExpanded] = useState(true);

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  const initials = user?.name ? getInitials(user.name) : "?";

  return (
    <TooltipProvider>
    <aside className={`fixed inset-y-0 left-0 z-20 flex flex-col border-r border-border bg-sidebar transition-all duration-200 ${collapsed ? "w-14" : "w-60"}`}>
      {/* Collapse toggle — tab style, sticks out to the right of the sidebar */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onToggle}
            className="absolute right-0 top-4 translate-x-full z-30 rounded-r-md border border-l-0 border-border bg-primary/10 hover:bg-primary/20 text-primary px-0.5 py-3 shadow-sm transition-colors"
          >
            {collapsed ? <ChevronRight className="size-3" /> : <ChevronLeft className="size-3" />}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">
          {collapsed ? "Expand sidebar" : "Collapse sidebar"}
        </TooltipContent>
      </Tooltip>

      {/* Brand */}
      <div className="flex h-14 shrink-0 flex-col items-center justify-center border-b border-border px-4">
        <img src={collapsed ? "/favicon.svg" : "/logo.svg"} alt="DMS" className={collapsed ? "h-5 w-5" : "h-5 w-auto"} />
        {!collapsed && (
          <span className="mt-0.5 text-[10px] font-medium text-muted-foreground">Document Management System</span>
        )}
      </div>

      {/* Primary nav */}
      <nav className="flex flex-1 flex-col gap-0.5 px-2 py-2 overflow-y-auto min-h-0">
        {PRIMARY_NAV.map((item) => {
          if (item.label === "Approvals" && user?.role === "uploader") return null;

          // Documents: always render with chevron; expand tree only when on /documents
          if (item.label === "Documents" && !collapsed) {
            return (
              <div key={item.path}>
                {/* Documents row */}
                <div
                  className={`flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm select-none cursor-pointer transition-colors ${
                    isDocumentsPage
                      ? "bg-accent font-medium text-foreground"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                  }`}
                  onClick={() => {
                    if (isDocumentsPage) {
                      setDocsExpanded(v => !v);
                    } else {
                      navigate("/documents");
                    }
                  }}
                >
                  <FolderOpen className="size-4 shrink-0" />
                  <span className="flex-1">Documents</span>
                  <ChevronRight
                    className={`size-3.5 text-muted-foreground transition-transform duration-200 ${isDocumentsPage && docsExpanded ? "rotate-90" : ""}`}
                  />
                </div>
                {/* Folder tree — only on /documents, animated open/close */}
                {isDocumentsPage && (
                  <div className={`grid transition-[grid-template-rows] duration-200 ease-in-out ${docsExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                    <div className="overflow-hidden">
                      <div className="ml-3.5 border-l border-border/60 mt-0.5">
                        <FolderPanel selectedFolderId={folderIdParam} hideHeader />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          }

          return <SidebarNavItem key={item.path} {...item} collapsed={collapsed} />;
        })}
      </nav>

      {/* Admin nav */}
      {user?.role === "Admin" && (
        <>
          <div className="border-t border-border" />
          <div className="px-2 py-2">
            {SECONDARY_NAV.map((item) => (
              <SidebarNavItem key={item.path} {...item} collapsed={collapsed} />
            ))}
          </div>
        </>
      )}

      {/* User section */}
      <div className="mt-auto border-t border-border">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className={`flex items-center gap-2.5 px-3 py-3 hover:bg-accent/60 transition-colors outline-none ${collapsed ? "justify-center" : "w-full"}`}>
              <Avatar className="size-7 shrink-0">
                <AvatarFallback className="bg-primary text-primary-foreground text-[11px] font-semibold">
                  {initials}
                </AvatarFallback>
              </Avatar>
              {!collapsed && (
                <div className="flex min-w-0 flex-col text-left">
                  <span className="truncate text-xs font-medium text-foreground leading-tight">
                    {user?.name}
                  </span>
                  <span className="truncate text-[11px] text-muted-foreground leading-tight">
                    {user?.email}
                  </span>
                </div>
              )}
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
    </TooltipProvider>
  );
};

export default Sidebar;
