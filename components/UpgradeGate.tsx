"use client";

import Link from "next/link";

interface UpgradeGateProps {
  /** Message shown above the CTA */
  message?: string;
  /** Optional sub-message for additional context */
  subMessage?: string;
  /** The content to blur behind the gate */
  children: React.ReactNode;
  /** Whether to show the gate (true = blurred + CTA, false = content visible) */
  locked: boolean;
  /** How strong the blur should be */
  blur?: "light" | "medium" | "heavy";
  /** Additional className for the wrapper */
  className?: string;
  /** Where to position the CTA overlay */
  ctaPosition?: "center" | "top";
}

const BLUR_MAP = {
  light: "blur-[4px]",
  medium: "blur-[8px]",
  heavy: "blur-[12px]",
};

export default function UpgradeGate({
  message = "Upgrade to Premium for full access",
  subMessage,
  children,
  locked,
  blur = "medium",
  className = "",
  ctaPosition = "center",
}: UpgradeGateProps) {
  if (!locked) return <>{children}</>;

  return (
    <div className={`relative ${className}`}>
      {/* Blurred content */}
      <div
        className={`${BLUR_MAP[blur]} select-none pointer-events-none`}
        aria-hidden="true"
      >
        {children}
      </div>

      {/* Overlay with CTA */}
      <div
        className={`absolute inset-0 flex justify-center z-10 ${
          ctaPosition === "top" ? "items-start pt-8" : "items-center"
        }`}
      >
        <div className="bg-th-surface/90 backdrop-blur-sm border border-th-border rounded-2xl px-6 py-5 sm:px-8 sm:py-6 text-center shadow-lg max-w-sm mx-4">
          <div className="w-10 h-10 mx-auto mb-3 rounded-full bg-gradient-to-br from-th-accent to-th-accent-hover flex items-center justify-center">
            <svg
              className="w-5 h-5 text-white"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456Z"
              />
            </svg>
          </div>
          <p className="text-sm font-semibold text-th-text">{message}</p>
          {subMessage && (
            <p className="text-xs text-th-text-3 mt-1">{subMessage}</p>
          )}
          <Link
            href="/pricing"
            className="inline-flex items-center gap-2 mt-4 px-5 py-2.5 text-sm font-medium text-white bg-th-accent rounded-xl hover:bg-th-accent-hover transition-colors"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z"
              />
            </svg>
            Upgrade to Premium
          </Link>
          <p className="text-[10px] text-th-text-4 mt-3">
            7-day free trial. Cancel anytime.
          </p>
        </div>
      </div>
    </div>
  );
}
