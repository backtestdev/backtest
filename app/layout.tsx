import type { Metadata } from "next";
import localFont from "next/font/local";
import {
  ClerkProvider,
  SignInButton,
  SignUpButton,
  UserButton,
  SignedIn,
  SignedOut,
} from "@clerk/nextjs";
import Navigation from "@/components/Navigation";
import ThemeProvider from "@/components/ThemeProvider";
import AutoRefresh from "@/components/AutoRefresh";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "Backtest AI Tool - Test Stock Market Strategies",
  description:
    "Test any stock market investment strategy using plain English. See how it would have performed over the last 10 years.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en" suppressHydrationWarning>
        <head>
          <script
            dangerouslySetInnerHTML={{
              __html: `try{var t=localStorage.getItem("theme");var d=t==="dark"||(!t&&window.matchMedia("(prefers-color-scheme:dark)").matches);if(d)document.documentElement.classList.add("dark")}catch(e){}`,
            }}
          />
        </head>
        <body className={`${geistSans.variable} font-sans antialiased`}>
          <ThemeProvider>
            <nav className="sticky top-0 z-50 relative flex justify-between items-center px-4 sm:px-6 py-3 border-b border-th-border-light bg-th-surface/95 backdrop-blur-sm shadow-sm">
              <Navigation />
              <div className="flex items-center gap-2 sm:gap-3">
                <SignedOut>
                  <SignInButton mode="modal">
                    <button className="px-3 sm:px-4 py-2 text-sm font-medium text-th-text-2 hover:text-th-text border border-th-border rounded-lg hover:bg-th-hover transition-colors">
                      Sign In
                    </button>
                  </SignInButton>
                  <SignUpButton mode="modal">
                    <button className="px-3 sm:px-4 py-2 text-sm font-medium text-white bg-th-accent rounded-lg hover:bg-th-accent-hover transition-colors">
                      Sign Up
                    </button>
                  </SignUpButton>
                </SignedOut>
                <SignedIn>
                  <UserButton />
                </SignedIn>
              </div>
            </nav>
            <AutoRefresh />
            {children}
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
