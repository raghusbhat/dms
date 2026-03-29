import { LayoutDashboard, FolderOpen, Settings2, CheckSquare } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
}

export const PRIMARY_NAV: NavItem[] = [
  { label: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
  { label: "Approvals", path: "/tasks", icon: CheckSquare },
  { label: "Documents", path: "/documents", icon: FolderOpen },
];

export const SECONDARY_NAV: NavItem[] = [
  { label: "Admin", path: "/admin", icon: Settings2 },
];
