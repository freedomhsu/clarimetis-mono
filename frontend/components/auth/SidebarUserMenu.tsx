"use client";

import { useUser, useClerk } from "@clerk/nextjs";
import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { LogOut, Settings, ChevronDown } from "lucide-react";

export function SidebarUserMenu() {
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!isLoaded || !user) {
    return (
      <div className="flex items-center gap-3 px-2 py-1.5">
        <div className="w-8 h-8 rounded-full bg-gray-800 animate-pulse" />
        <div className="flex-1 space-y-1.5">
          <div className="h-2.5 rounded bg-gray-800 animate-pulse w-24" />
          <div className="h-2 rounded bg-gray-800 animate-pulse w-16" />
        </div>
      </div>
    );
  }

  const initials = [user.firstName, user.lastName]
    .filter(Boolean)
    .map((n) => n![0].toUpperCase())
    .join("") || user.emailAddresses[0]?.emailAddress[0]?.toUpperCase() || "?";

  const displayName =
    [user.firstName, user.lastName].filter(Boolean).join(" ") ||
    user.emailAddresses[0]?.emailAddress ||
    "Account";

  const email = user.primaryEmailAddress?.emailAddress ?? "";

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-2 py-1.5 rounded-xl hover:bg-gray-800 transition-colors group"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        {/* Avatar */}
        {user.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.imageUrl}
            alt={displayName}
            className="w-8 h-8 rounded-full object-cover shrink-0"
          />
        ) : (
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-500 to-violet-600 flex items-center justify-center shrink-0 text-white text-xs font-bold">
            {initials}
          </div>
        )}

        {/* Name / email */}
        <div className="flex-1 min-w-0 text-left">
          <p className="text-sm font-medium text-gray-200 truncate leading-tight">
            {displayName}
          </p>
          {email && (
            <p className="text-[11px] text-gray-500 truncate leading-tight">{email}</p>
          )}
        </div>

        <ChevronDown
          size={14}
          className={`text-gray-500 shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 right-0 mb-1 bg-gray-900 border border-gray-800 rounded-xl shadow-2xl shadow-black/40 overflow-hidden z-50"
        >
          {/* User info header */}
          <div className="px-4 py-3 border-b border-gray-800">
            <p className="text-sm font-semibold text-white truncate">{displayName}</p>
            {email && (
              <p className="text-[11px] text-gray-500 truncate mt-0.5">{email}</p>
            )}
          </div>

          {/* Menu items */}
          <div className="py-1">
            <Link
              href="/account"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
            >
              <Settings size={15} className="text-gray-500" />
              Account settings
            </Link>
            <button
              type="button"
              role="menuitem"
              onClick={() => signOut({ redirectUrl: "/" })}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-800 hover:text-red-400 transition-colors"
            >
              <LogOut size={15} className="text-gray-500" />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
