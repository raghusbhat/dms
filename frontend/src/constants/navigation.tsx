import { LayoutDashboard, FolderOpen, Search, Settings2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
}

export const PRIMARY_NAV: NavItem[] = [
  { label: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
  { label: "Documents", path: "/documents", icon: FolderOpen },
  { label: "Search", path: "/search", icon: Search },
];

export const SECONDARY_NAV: NavItem[] = [
  { label: "Admin", path: "/admin", icon: Settings2 },
];
