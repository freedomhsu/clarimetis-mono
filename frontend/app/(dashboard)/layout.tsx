import DashboardSidebar from "./DashboardSidebar";
import { DashboardProvider } from "@/components/providers/DashboardContext";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardProvider>
      <div className="flex h-dvh bg-gray-50 dark:bg-gray-950 overflow-hidden safe-p">
        <DashboardSidebar />
        <main className="flex-1 overflow-hidden">{children}</main>
      </div>
    </DashboardProvider>
  );
}

