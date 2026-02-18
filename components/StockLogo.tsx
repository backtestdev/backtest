"use client";

import { useState, useCallback } from "react";

/**
 * StockLogo — company logo from FMP with letter-avatar fallback.
 * Tries to load the real logo; falls back on error or if image looks like
 * a placeholder (tiny dimensions / known-bad).
 */

const SECTOR_COLORS: Record<string, { bg: string; text: string }> = {
  Technology:              { bg: "bg-th-accent-muted",    text: "text-th-accent-text" },
  Healthcare:              { bg: "bg-cyan-100",        text: "text-cyan-700" },
  Financial:               { bg: "bg-amber-100",       text: "text-amber-700" },
  "Financial Services":    { bg: "bg-amber-100",       text: "text-amber-700" },
  Energy:                  { bg: "bg-orange-100",      text: "text-orange-700" },
  Consumer:                { bg: "bg-violet-100",      text: "text-violet-700" },
  "Consumer Cyclical":     { bg: "bg-violet-100",      text: "text-violet-700" },
  "Consumer Defensive":    { bg: "bg-purple-100",      text: "text-purple-700" },
  Industrials:             { bg: "bg-slate-100",      text: "text-slate-600" },
  "Basic Materials":       { bg: "bg-amber-100",      text: "text-amber-700" },
  "Real Estate":           { bg: "bg-purple-100",  text: "text-purple-700" },
  Utilities:               { bg: "bg-teal-100",    text: "text-teal-700" },
  Communication:           { bg: "bg-indigo-100",  text: "text-indigo-700" },
  "Communication Services":{ bg: "bg-indigo-100",  text: "text-indigo-700" },
};

const FALLBACK_COLORS = [
  { bg: "bg-slate-100",  text: "text-slate-600" },
  { bg: "bg-sky-100",    text: "text-sky-700" },
  { bg: "bg-violet-100", text: "text-violet-700" },
  { bg: "bg-amber-100",  text: "text-amber-700" },
  { bg: "bg-cyan-100",   text: "text-cyan-700" },
];

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// Track tickers whose logos failed / were placeholders.
const failedTickers = new Set<string>();

interface StockLogoProps {
  ticker: string;
  sector?: string;
  size?: "sm" | "md";
}

export default function StockLogo({ ticker, sector, size = "sm" }: StockLogoProps) {
  const [imgFailed, setImgFailed] = useState(() => failedTickers.has(ticker));
  const [imgReady, setImgReady] = useState(false);

  const colors = (sector && SECTOR_COLORS[sector]) ||
    FALLBACK_COLORS[hashCode(ticker) % FALLBACK_COLORS.length];

  const px = size === "sm" ? 24 : 32;
  const dims = size === "sm"
    ? "w-6 h-6 text-[10px]"
    : "w-8 h-8 text-xs";

  const markFailed = useCallback(() => {
    failedTickers.add(ticker);
    setImgFailed(true);
  }, [ticker]);

  // Detect placeholder images: FMP returns tiny or empty PNGs for unknown tickers
  const handleLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (img.naturalWidth <= 1 || img.naturalHeight <= 1) {
      markFailed();
    } else {
      setImgReady(true);
    }
  }, [markFailed]);

  // Layered approach: letter avatar is always rendered as the base layer.
  // Once the real logo loads successfully, we add bg-white so it looks clean.
  // If FMP returns a bad image, imgFailed=true removes the img entirely.
  return (
    <span
      className={`inline-flex items-center justify-center rounded-md font-bold flex-shrink-0 relative overflow-hidden ${dims} ${colors.bg} ${colors.text}`}
      title={ticker}
    >
      {ticker.charAt(0)}
      {!imgFailed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`https://financialmodelingprep.com/image-stock/${encodeURIComponent(ticker)}.png`}
          alt=""
          width={px}
          height={px}
          loading="lazy"
          className={`absolute inset-0 w-full h-full rounded-md object-contain${imgReady ? " bg-gray-200 dark:bg-gray-700 ring-1 ring-black/10 dark:ring-white/15" : ""}`}
          onError={markFailed}
          onLoad={handleLoad}
        />
      )}
    </span>
  );
}
