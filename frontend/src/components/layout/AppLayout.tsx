import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";

const AppLayout = () => {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <main className="ml-60 flex flex-1 flex-col min-h-0">
        <Outlet />
      </main>
    </div>
  );
};

export default AppLayout;
