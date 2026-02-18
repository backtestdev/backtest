"use client";

import { useState, useCallback } from "react";

/**
 * StockLogo — company logo from FMP with letter-avatar fallback.
 * Tries to load the real logo; falls back on error or if image looks like
 * a placeholder (tiny dimensions / known-bad).
 * Detects predominantly white/light logos and inverts them so they're
 * visible on the white background.
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
// Cache light-logo detection across renders so we don't re-probe.
const lightLogoTickers = new Set<string>();

interface StockLogoProps {
  ticker: string;
  sector?: string;
  size?: "sm" | "md";
}

export default function StockLogo({ ticker, sector, size = "sm" }: StockLogoProps) {
  const [imgFailed, setImgFailed] = useState(() => failedTickers.has(ticker));
  const [imgReady, setImgReady] = useState(false);
  const [isLightLogo, setIsLightLogo] = useState(() => lightLogoTickers.has(ticker));

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

  const handleLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (img.naturalWidth <= 1 || img.naturalHeight <= 1) {
      markFailed();
      return;
    }
    setImgReady(true);

    // Already detected for this ticker
    if (lightLogoTickers.has(ticker)) {
      setIsLightLogo(true);
      return;
    }

    // Probe for white/light logo via a CORS-enabled copy so we can canvas-sample.
    // The browser should serve this from cache. If CORS is blocked, we silently skip.
    const probe = new Image();
    probe.crossOrigin = "anonymous";
    probe.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const s = 32;
        canvas.width = s;
        canvas.height = s;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(probe, 0, 0, s, s);
        const { data } = ctx.getImageData(0, 0, s, s);
        let light = 0, opaque = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] > 128) {
            opaque++;
            if ((data[i] + data[i + 1] + data[i + 2]) / 3 > 240) light++;
          }
        }
        if (opaque > 0 && light / opaque > 0.85) {
          lightLogoTickers.add(ticker);
          setIsLightLogo(true);
        }
      } catch {
        // Canvas tainted by CORS or unavailable — skip detection
      }
    };
    // onerror = CORS not supported for this image — just ignore
    probe.src = img.src;
  }, [markFailed, ticker]);

  // White bg is a separate layer so the invert filter only hits the logo image,
  // not the background.
  return (
    <span
      className={`inline-flex items-center justify-center rounded-md font-bold flex-shrink-0 relative overflow-hidden ${dims} ${colors.bg} ${colors.text}`}
      title={ticker}
    >
      {ticker.charAt(0)}
      {!imgFailed && (
        <>
          {imgReady && <span className="absolute inset-0 bg-white dark:bg-gray-800 rounded-md" />}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://financialmodelingprep.com/image-stock/${encodeURIComponent(ticker)}.png`}
            alt=""
            width={px}
            height={px}
            loading="lazy"
            className={`absolute inset-0 w-full h-full rounded-md object-contain p-px${imgReady ? "" : " opacity-0"}${isLightLogo ? " invert dark:invert-0" : ""}`}
            onError={markFailed}
            onLoad={handleLoad}
          />
        </>
      )}
    </span>
  );
}
