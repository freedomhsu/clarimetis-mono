import DashboardSidebar from "./DashboardSidebar";
import { DashboardProvider } from "@/components/providers/DashboardContext";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardProvider>
      <div
        className="flex h-screen bg-gray-50 dark:bg-gray-950 overflow-hidden"
        style={{
          paddingTop: "env(safe-area-inset-top, 0px)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
          paddingLeft: "env(safe-area-inset-left, 0px)",
          paddingRight: "env(safe-area-inset-right, 0px)",
        }}
      >
        <DashboardSidebar />
        <main className="flex-1 overflow-hidden">{children}</main>
      </div>
    </DashboardProvider>
  );
}

