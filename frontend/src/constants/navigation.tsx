import { LayoutDashboard, FolderOpen, Settings2, CheckSquare } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
}

export const PRIMARY_NAV: NavItem[] = [
  { label: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
  { label: "Documents", path: "/documents", icon: FolderOpen },
  { label: "Approvals", path: "/tasks", icon: CheckSquare },
];

export const SECONDARY_NAV: NavItem[] = [
  { label: "Admin", path: "/admin", icon: Settings2 },
];
