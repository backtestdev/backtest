"use client";

import { ReactNode } from "react";

/**
 * Lightweight hover tooltip. Renders a styled popup on hover.
 * Use for metric labels, column headers, and any UI element that
 * benefits from a brief explanation.
 */
export default function Tooltip({
  content,
  children,
  position = "top",
  width = "w-56",
}: {
  content: ReactNode;
  children: ReactNode;
  position?: "top" | "bottom";
  width?: string;
}) {
  const posClass =
    position === "top"
      ? "bottom-full mb-1.5"
      : "top-full mt-1.5";

  return (
    <span className="group/tip relative inline-flex cursor-help">
      {children}
      <span
        className={`absolute left-1/2 -translate-x-1/2 ${posClass} hidden group-hover/tip:block z-30 ${width} px-2.5 py-1.5 text-[11px] leading-relaxed font-normal normal-case tracking-normal text-white bg-gray-800 rounded-lg shadow-lg pointer-events-none`}
      >
        {content}
      </span>
    </span>
  );
}
