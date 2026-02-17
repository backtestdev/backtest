"use client";

/**
 * StockLogo — small colored letter avatar for stock tickers.
 * Color is deterministic based on sector (or ticker hash fallback).
 */

const SECTOR_COLORS: Record<string, { bg: string; text: string }> = {
  Technology:              { bg: "bg-blue-100",    text: "text-blue-700" },
  Healthcare:              { bg: "bg-emerald-100", text: "text-emerald-700" },
  Financial:               { bg: "bg-amber-100",   text: "text-amber-700" },
  "Financial Services":    { bg: "bg-amber-100",   text: "text-amber-700" },
  Energy:                  { bg: "bg-orange-100",  text: "text-orange-700" },
  Consumer:                { bg: "bg-pink-100",    text: "text-pink-700" },
  "Consumer Cyclical":     { bg: "bg-pink-100",    text: "text-pink-700" },
  "Consumer Defensive":    { bg: "bg-rose-100",    text: "text-rose-700" },
  Industrials:             { bg: "bg-gray-100",    text: "text-gray-700" },
  "Basic Materials":       { bg: "bg-yellow-100",  text: "text-yellow-700" },
  "Real Estate":           { bg: "bg-purple-100",  text: "text-purple-700" },
  Utilities:               { bg: "bg-teal-100",    text: "text-teal-700" },
  Communication:           { bg: "bg-indigo-100",  text: "text-indigo-700" },
  "Communication Services":{ bg: "bg-indigo-100",  text: "text-indigo-700" },
};

const FALLBACK_COLORS = [
  { bg: "bg-slate-100",  text: "text-slate-600" },
  { bg: "bg-sky-100",    text: "text-sky-700" },
  { bg: "bg-violet-100", text: "text-violet-700" },
  { bg: "bg-lime-100",   text: "text-lime-700" },
  { bg: "bg-cyan-100",   text: "text-cyan-700" },
];

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

interface StockLogoProps {
  ticker: string;
  sector?: string;
  size?: "sm" | "md";
}

export default function StockLogo({ ticker, sector, size = "sm" }: StockLogoProps) {
  const colors = (sector && SECTOR_COLORS[sector]) ||
    FALLBACK_COLORS[hashCode(ticker) % FALLBACK_COLORS.length];

  const letter = ticker.charAt(0);

  const dims = size === "sm"
    ? "w-6 h-6 text-[10px]"
    : "w-8 h-8 text-xs";

  return (
    <span
      className={`inline-flex items-center justify-center rounded-md font-bold flex-shrink-0 ${dims} ${colors.bg} ${colors.text}`}
      title={ticker}
    >
      {letter}
    </span>
  );
}
