import { MessageCircle } from "lucide-react";

interface AuthCardProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

export function AuthCard({ title, subtitle, children }: AuthCardProps) {
  return (
    <div className="w-full max-w-sm">
      {/* Logo mark */}
      <div className="flex justify-center mb-8">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-500 to-violet-600 flex items-center justify-center shadow-2xl shadow-brand-500/40">
          <MessageCircle size={26} className="text-white" />
        </div>
      </div>

      {/* Card */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 shadow-2xl">
        <div className="text-center mb-7">
          <h1 className="text-2xl font-bold text-white tracking-tight">{title}</h1>
          {subtitle && (
            <p className="text-sm text-gray-400 mt-1.5 leading-snug">{subtitle}</p>
          )}
        </div>
        {children}
      </div>

      <p className="text-center text-xs text-gray-600 mt-5">
        ClariMetis &middot; AI Wellness Coach
      </p>
    </div>
  );
}
