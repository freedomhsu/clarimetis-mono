import DashboardSidebar from "./DashboardSidebar";
import { DashboardProvider } from "@/components/providers/DashboardContext";
import { I18nProvider } from "@/components/providers/I18nContext";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider>
      <DashboardProvider>
        <div className="flex h-screen bg-gray-50 dark:bg-gray-950 overflow-hidden">
          <DashboardSidebar />
          <main className="flex-1 overflow-hidden">{children}</main>
        </div>
      </DashboardProvider>
    </I18nProvider>
  );
}

