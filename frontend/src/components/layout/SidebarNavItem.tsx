import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { NavItem } from "@/constants/navigation";

interface SidebarNavItemProps extends NavItem {
  collapsed: boolean;
}

const SidebarNavItem = ({ label, path, icon: Icon, collapsed }: SidebarNavItemProps) => {
  const content = (
    <NavLink
      to={path}
      className={({ isActive }) =>
        cn(
          "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors",
          isActive
            ? "bg-accent font-medium text-foreground"
            : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
        )
      }
    >
      <Icon className="size-4 shrink-0" />
      {!collapsed && label}
    </NavLink>
  );

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    );
  }

  return content;
};

export default SidebarNavItem;
