import type { Metadata } from "next";
import localFont from "next/font/local";
import { ClerkProvider } from "@clerk/nextjs";
import ThemeProvider from "@/components/ThemeProvider";
import { SubscriptionProvider } from "@/components/SubscriptionProvider";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "SoloQuant — Test Before You Invest",
  description:
    "Institutional-grade backtesting and stock screening for individual investors. Describe a strategy in plain English and see how it would have performed.",
  openGraph: {
    title: "SoloQuant — Test Before You Invest",
    description:
      "Institutional-grade backtesting and stock screening for individual investors. Describe a strategy in plain English and see how it would have performed.",
    siteName: "SoloQuant",
    url: "https://soloquant.app",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "SoloQuant — Test Before You Invest",
    description:
      "Institutional-grade backtesting and stock screening for individual investors.",
  },
  metadataBase: new URL("https://soloquant.app"),
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
            <SubscriptionProvider>
              {children}
            </SubscriptionProvider>
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
