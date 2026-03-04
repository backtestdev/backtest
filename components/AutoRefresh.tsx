"use client";

import { useEffect } from "react";

/**
 * Silent client-side component that triggers a database staleness check
 * on each new browser session. If data is stale (>20 hours for stocks,
 * >8 days for prices), the GET handlers auto-trigger a background refresh.
 *
 * This acts as a safety net for when Vercel cron fails or CRON_SECRET
 * is misconfigured - normal user traffic keeps the data fresh.
 */
export default function AutoRefresh() {
  useEffect(() => {
    try {
      if (sessionStorage.getItem("_dbAutoRefreshChecked")) return;
      sessionStorage.setItem("_dbAutoRefreshChecked", "1");
    } catch {
      return; // sessionStorage unavailable
    }

    // Fire-and-forget: the GET handlers check staleness and auto-refresh
    // if needed. The serverless function continues even if this tab closes.
    fetch("/api/admin/refresh-stocks").catch(() => {});
    fetch("/api/admin/refresh-prices").catch(() => {});
  }, []);

  return null;
}
