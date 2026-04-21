export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 px-4 py-12">
      {/* Subtle radial glow behind the card */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 flex items-center justify-center"
      >
        <div className="w-[480px] h-[480px] rounded-full bg-brand-500/10 blur-[120px]" />
      </div>
      <div className="relative z-10 w-full flex justify-center">
        {children}
      </div>
    </div>
  );
}
