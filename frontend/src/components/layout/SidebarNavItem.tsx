import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import type { NavItem } from "@/constants/navigation";

const SidebarNavItem = ({ label, path, icon: Icon }: NavItem) => {
  return (
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
      {label}
    </NavLink>
  );
};

export default SidebarNavItem;
