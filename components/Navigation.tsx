"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "Backtest" },
  { href: "/signals", label: "Signal Explorer", beta: true },
  { href: "/screener", label: "Screener", beta: true },
  { href: "/portfolio", label: "Portfolio", beta: true },
];

export default function Navigation() {
  const pathname = usePathname();

  return (
    <div className="flex items-center gap-1">
      {NAV_ITEMS.map((item) => {
        const isActive = item.href === "/"
          ? pathname === "/"
          : pathname.startsWith(item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              isActive
                ? "bg-gray-900 text-white"
                : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"
            }`}
          >
            {item.label}
            {item.beta && (
              <span className="ml-1.5 text-[9px] font-semibold uppercase tracking-wider px-1 py-0.5 rounded bg-blue-100 text-blue-600">
                Beta
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
