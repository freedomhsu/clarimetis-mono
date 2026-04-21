import { forwardRef, InputHTMLAttributes } from "react";
import { clsx } from "clsx";

interface AuthInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export const AuthInput = forwardRef<HTMLInputElement, AuthInputProps>(
  ({ label, error, className, id, ...props }, ref) => {
    const inputId = id ?? label.toLowerCase().replace(/\s+/g, "-");
    return (
      <div className="space-y-1.5">
        <label
          htmlFor={inputId}
          className="block text-sm font-medium text-gray-300"
        >
          {label}
        </label>
        <input
          ref={ref}
          id={inputId}
          className={clsx(
            "w-full px-3.5 py-2.5 rounded-xl text-sm text-white placeholder-gray-500",
            "bg-gray-800 border transition-all outline-none",
            error
              ? "border-red-500 focus:border-red-500 focus:ring-1 focus:ring-red-500/50"
              : "border-gray-700 focus:border-brand-500 focus:ring-1 focus:ring-brand-500/40",
            className,
          )}
          {...props}
        />
        {error && (
          <p className="text-xs text-red-400 mt-1">{error}</p>
        )}
      </div>
    );
  },
);

AuthInput.displayName = "AuthInput";
