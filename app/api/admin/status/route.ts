/**
 * Admin health/status endpoint for monitoring the refresh pipeline.
 *
 * GET /api/admin/status - Returns refresh timestamps, stock counts,
 * data freshness indicators, and diagnostic information.
 *
 * No auth required (read-only diagnostic data, no secrets exposed).
 */

import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const sql = getDb();
  if (!sql) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  try {
    // Fetch all metadata timestamps
    const meta = await sql`
      SELECT key, value, updated_at FROM stock_meta
      WHERE key IN ('last_populate', 'last_signal_refresh', 'last_price_refresh', 'enrich_offset', 'refresh_lock')
    `;
    const metaMap: Record<string, { value: string; updated_at: string }> = {};
    for (const row of meta) {
      metaMap[row.key as string] = { value: row.value as string, updated_at: String(row.updated_at) };
    }

    const now = Date.now();

    const hoursAgo = (isoDate: string | undefined): number | null => {
      if (!isoDate) return null;
      const ms = new Date(isoDate).getTime();
      if (isNaN(ms)) return null;
      return Math.round((now - ms) / (1000 * 60 * 60) * 10) / 10;
    };

    // Stock counts & data quality
    const counts = await sql`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE price_to_earnings_ratio IS NOT NULL) AS with_pe,
        COUNT(*) FILTER (WHERE return_on_equity IS NOT NULL) AS with_roe,
        COUNT(*) FILTER (WHERE revenue_history IS NOT NULL) AS with_revenue_history,
        COUNT(*) FILTER (WHERE earnings_yield IS NOT NULL) AS with_earnings_yield,
        COUNT(*) FILTER (WHERE quant_score IS NOT NULL) AS with_score,
        COUNT(*) FILTER (WHERE latest_fiscal_date IS NOT NULL AND latest_fiscal_date > CURRENT_DATE - INTERVAL '9 months') AS fresh_fiscal,
        COUNT(*) FILTER (WHERE latest_fiscal_date IS NULL OR latest_fiscal_date <= CURRENT_DATE - INTERVAL '9 months') AS stale_fiscal,
        MIN(updated_at) AS oldest_update,
        MAX(updated_at) AS newest_update,
        MIN(score_updated_at) AS oldest_score,
        MAX(score_updated_at) AS newest_score
      FROM stocks
    `;
    const c = counts[0];

    // Signal picks summary
    const picks = await sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'active') AS active,
        COUNT(*) FILTER (WHERE status = 'sold') AS sold,
        MAX(pick_date) FILTER (WHERE status = 'active') AS latest_pick,
        MAX(sell_date) FILTER (WHERE status = 'sold') AS latest_sell
      FROM signal_picks
    `;
    const p = picks[0];

    // Top 5 stale stocks by market cap (missing recent fiscal data)
    const staleStocks = await sql`
      SELECT symbol, company_name, market_cap, latest_fiscal_date, updated_at, quant_score, score_updated_at
      FROM stocks
      WHERE (latest_fiscal_date IS NULL OR latest_fiscal_date <= CURRENT_DATE - INTERVAL '9 months')
        AND market_cap > 1000000000
      ORDER BY market_cap DESC NULLS LAST
      LIMIT 10
    `;

    // Score distribution
    const scoreDist = await sql`
      SELECT
        COUNT(*) FILTER (WHERE quant_score >= 90) AS score_90_plus,
        COUNT(*) FILTER (WHERE quant_score >= 80 AND quant_score < 90) AS score_80_89,
        COUNT(*) FILTER (WHERE quant_score >= 60 AND quant_score < 80) AS score_60_79,
        COUNT(*) FILTER (WHERE quant_score < 60) AS score_below_60,
        MAX(quant_score) AS max_score,
        MIN(quant_score) AS min_score,
        ROUND(AVG(quant_score)) AS avg_score
      FROM stocks
      WHERE quant_score IS NOT NULL
    `;

    const lastPopulate = metaMap["last_populate"]?.value;
    const lastSignal = metaMap["last_signal_refresh"]?.value;
    const lastPrice = metaMap["last_price_refresh"]?.value;
    const enrichOffset = metaMap["enrich_offset"]?.value;
    const refreshLock = metaMap["refresh_lock"]?.value;

    // Compute health status
    const stocksHoursAgo = hoursAgo(lastPopulate);
    const signalsHoursAgo = hoursAgo(lastSignal);
    const pricesHoursAgo = hoursAgo(lastPrice);

    const issues: string[] = [];
    if (stocksHoursAgo == null || stocksHoursAgo > 26) issues.push("refresh-stocks has not run in >26 hours");
    if (signalsHoursAgo == null || signalsHoursAgo > 26) issues.push("refresh-signals has not run in >26 hours");
    if (pricesHoursAgo != null && pricesHoursAgo > 192) issues.push("refresh-prices has not run in >8 days");
    if (Number(c.with_score) === 0) issues.push("No stocks have quant_score persisted yet (refresh-signals needs to run)");
    if (Number(c.stale_fiscal) > Number(c.fresh_fiscal)) issues.push(`More stale fiscal data (${c.stale_fiscal}) than fresh (${c.fresh_fiscal})`);
    if (refreshLock) issues.push(`Refresh lock is held (since ${refreshLock})`);

    const health = issues.length === 0 ? "healthy" : issues.length <= 2 ? "degraded" : "unhealthy";

    return NextResponse.json({
      health,
      issues,
      refreshTimestamps: {
        lastStockRefresh: lastPopulate || null,
        lastStockRefreshHoursAgo: stocksHoursAgo,
        lastSignalRefresh: lastSignal || null,
        lastSignalRefreshHoursAgo: signalsHoursAgo,
        lastPriceRefresh: lastPrice || null,
        lastPriceRefreshHoursAgo: pricesHoursAgo,
        enrichOffset: enrichOffset ? Number(enrichOffset) : 0,
        refreshLock: refreshLock || null,
      },
      stockCounts: {
        total: Number(c.total),
        withPE: Number(c.with_pe),
        withROE: Number(c.with_roe),
        withRevenueHistory: Number(c.with_revenue_history),
        withEarningsYield: Number(c.with_earnings_yield),
        withScore: Number(c.with_score),
        freshFiscalData: Number(c.fresh_fiscal),
        staleFiscalData: Number(c.stale_fiscal),
        oldestUpdate: c.oldest_update,
        newestUpdate: c.newest_update,
        oldestScoreUpdate: c.oldest_score,
        newestScoreUpdate: c.newest_score,
      },
      scoreDistribution: scoreDist[0] ? {
        score90Plus: Number(scoreDist[0].score_90_plus),
        score80to89: Number(scoreDist[0].score_80_89),
        score60to79: Number(scoreDist[0].score_60_79),
        scoreBelow60: Number(scoreDist[0].score_below_60),
        maxScore: Number(scoreDist[0].max_score),
        minScore: Number(scoreDist[0].min_score),
        avgScore: Number(scoreDist[0].avg_score),
      } : null,
      signalPicks: {
        active: Number(p.active),
        sold: Number(p.sold),
        latestPick: p.latest_pick,
        latestSell: p.latest_sell,
      },
      staleHighCapStocks: staleStocks.map((s) => ({
        symbol: s.symbol,
        name: s.company_name,
        marketCapB: Math.round(Number(s.market_cap) / 1e9 * 10) / 10,
        latestFiscalDate: s.latest_fiscal_date,
        lastUpdated: s.updated_at,
        quantScore: s.quant_score,
        scoreUpdatedAt: s.score_updated_at,
      })),
    });
  } catch (error) {
    console.error("[admin/status] Error:", error);
    return NextResponse.json({ error: "Failed to fetch status", details: String(error) }, { status: 500 });
  }
}
