"use client";

import { SignUpButton, SignInButton } from "@clerk/nextjs";

interface LoginGateProps {
  /** Message shown above the CTA buttons */
  message?: string;
  /** Optional sub-message for additional context */
  subMessage?: string;
  /** The content to blur behind the gate */
  children: React.ReactNode;
  /** Whether to show the gate (true = blurred + CTA, false = content visible) */
  locked: boolean;
  /** How strong the blur should be: "light" (4px), "medium" (8px), "heavy" (12px) */
  blur?: "light" | "medium" | "heavy";
  /** Additional className for the wrapper */
  className?: string;
  /** Where to position the CTA overlay: "center" (default) or "top" */
  ctaPosition?: "center" | "top";
}

const BLUR_MAP = {
  light: "blur-[4px]",
  medium: "blur-[8px]",
  heavy: "blur-[12px]",
};

export default function LoginGate({
  message = "Sign up to unlock full access",
  subMessage,
  children,
  locked,
  blur = "medium",
  className = "",
  ctaPosition = "center",
}: LoginGateProps) {
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
      <div className={`absolute inset-0 flex justify-center z-10 ${ctaPosition === "top" ? "items-start pt-8" : "items-center"}`}>
        <div className="bg-th-surface/90 backdrop-blur-sm border border-th-border rounded-2xl px-6 py-5 sm:px-8 sm:py-6 text-center shadow-lg max-w-sm mx-4">
          <div className="w-10 h-10 mx-auto mb-3 rounded-full bg-th-accent-bg flex items-center justify-center">
            <svg
              className="w-5 h-5 text-th-accent"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"
              />
            </svg>
          </div>
          <p className="text-sm font-semibold text-th-text">{message}</p>
          {subMessage && (
            <p className="text-xs text-th-text-3 mt-1">{subMessage}</p>
          )}
          <div className="flex items-center justify-center gap-3 mt-4">
            <SignUpButton
              mode="modal"
              forceRedirectUrl={
                typeof window !== "undefined" ? window.location.href : "/"
              }
            >
              <button className="px-5 py-2.5 text-sm font-medium text-white bg-th-accent rounded-xl hover:bg-th-accent-hover transition-colors">
                Sign Up Free
              </button>
            </SignUpButton>
            <SignInButton
              mode="modal"
              forceRedirectUrl={
                typeof window !== "undefined" ? window.location.href : "/"
              }
            >
              <button className="px-5 py-2.5 text-sm font-medium text-th-text-2 bg-th-inset border border-th-border rounded-xl hover:bg-th-hover transition-colors">
                Sign In
              </button>
            </SignInButton>
          </div>
          <p className="text-[10px] text-th-text-4 mt-3">
            Free account. No credit card required.
          </p>
        </div>
      </div>
    </div>
  );
}
