/**
 * Admin endpoint to refresh Signal Tracker picks.
 *
 * GET  /api/admin/refresh-signals - Vercel Cron handler (daily)
 * POST /api/admin/refresh-signals - Manual trigger
 *
 * Checks for new stocks qualifying for picks (score >= 90 with market cap
 * rules) and marks sells for stocks whose score dropped below 80.
 *
 * Vercel cron sends GET with Authorization: Bearer <CRON_SECRET>.
 * Manual trigger uses x-admin-secret header.
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb, ensureSignalPicksTable, ensureSignalScoreHistoryTable } from "@/lib/db";
import { computeBacktestScore } from "@/lib/backtestScore";
import { NON_COMPANY_PATTERN, SYMBOL_EXCLUSIONS } from "@/lib/stockFilters";
import { v4 as uuidv4 } from "uuid";
import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance({ suppressNotices: ["ripHistorical"] });

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Use shared exclusion list for signal picks (bonds, notes, non-operating entities)
const SYMBOL_BLOCKLIST = SYMBOL_EXCLUSIONS;

function qualifiesForPick(score: number, marketCapB: number): boolean {
  if (score >= 95) return true;
  if (score >= 92 && marketCapB < 20) return true;
  if (score >= 90 && marketCapB < 10) return true;
  return false;
}

function generateThesis(s: {
  name: string; symbol: string; sector: string; industry: string;
  marketCapB: number; score: number;
  earningsYield: number | null; roe: number | null; profitMargin: number | null;
  revenueGrowth: number | null; consecutiveEarningsGrowth: number; peRatio: number | null;
}): string {
  const size = s.marketCapB >= 100 ? "mega-cap" : s.marketCapB >= 10 ? "large-cap" : s.marketCapB >= 2 ? "mid-cap" : "small-cap";
  const parts: string[] = [];
  parts.push(`${s.name} earns a Quant Score of ${s.score}, qualifying as a ${size} pick in ${s.sector || "diversified"}.`);
  const strengths: string[] = [];
  if (s.earningsYield != null && s.earningsYield > 0.03) strengths.push(`earnings yield of ${(s.earningsYield * 100).toFixed(1)}%`);
  if (s.roe != null && s.roe > 0.12) strengths.push(`ROE of ${(s.roe * 100).toFixed(1)}%`);
  if (s.profitMargin != null && s.profitMargin > 0.08) strengths.push(`net margin of ${(s.profitMargin * 100).toFixed(1)}%`);
  if (s.consecutiveEarningsGrowth >= 2) strengths.push(`${s.consecutiveEarningsGrowth} consecutive years of earnings growth`);
  if (s.revenueGrowth != null && s.revenueGrowth > 0.08) strengths.push(`revenue growth of ${(s.revenueGrowth * 100).toFixed(1)}% YoY`);
  if (strengths.length > 0) parts.push(`Strong fundamentals include ${strengths.slice(0, 3).join(", ")}.`);
  if (s.peRatio != null && s.peRatio > 0) {
    if (s.peRatio < 15) parts.push(`At a P/E of ${s.peRatio.toFixed(1)}, the stock offers compelling value.`);
    else if (s.peRatio < 30) parts.push(`A P/E of ${s.peRatio.toFixed(1)} reflects reasonable valuation given the growth profile.`);
    else parts.push(`The premium P/E of ${s.peRatio.toFixed(1)} is supported by superior profitability and growth consistency.`);
  }
  if (s.industry) parts.push(`Positioned in ${s.industry}, the company benefits from favorable secular trends in its addressable market.`);
  return parts.join(" ");
}

function generateLiveSellReason(stock: Record<string, unknown> | undefined, score: number): string {
  if (stock) {
    const pm = stock.profit_margin != null ? Number(stock.profit_margin) : null;
    if (pm != null && !isNaN(pm) && pm < 0.05)
      return `Profit margins compressed to ${(pm * 100).toFixed(1)}%, below quality threshold`;
    const roe = stock.roe != null ? Number(stock.roe) : null;
    if (roe != null && !isNaN(roe) && roe < 0.08)
      return `ROE declined to ${(roe * 100).toFixed(1)}%, signaling deteriorating capital efficiency`;
    const pe = stock.pe_ratio != null ? Number(stock.pe_ratio) : null;
    if (pe != null && !isNaN(pe) && pe > 40)
      return `Valuation stretched - P/E expanded to ${pe.toFixed(1)}, exceeding target range`;
    const rg = stock.revenue_growth != null ? Number(stock.revenue_growth) : null;
    if (rg != null && !isNaN(rg) && rg < 0)
      return `Revenue growth turned negative (${(rg * 100).toFixed(1)}% YoY), weakening growth thesis`;
    const eg = stock.earnings_growth != null ? Number(stock.earnings_growth) : null;
    if (eg != null && !isNaN(eg) && eg < -0.1)
      return `Earnings declined ${(Math.abs(eg) * 100).toFixed(0)}% YoY, breaking growth streak`;
    const sector = (stock.sector as string) || "the broader market";
    return `Score declined to ${score} amid sector rotation in ${sector}`;
  }
  return `Score declined to ${score}, below hold threshold of 78`;
}

function checkAuth(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) return true;

  const adminSecret = process.env.ADMIN_SECRET;
  const adminHeader = request.headers.get("x-admin-secret");
  if (adminSecret && adminHeader === adminSecret) return true;

  return false;
}

async function refreshSignals() {
  const sql = getDb();
  if (!sql) return { error: "Database not configured", status: 503 };

  await ensureSignalPicksTable(sql);

  // Fetch all stocks with scores
  const allStocks = await sql`
    SELECT symbol, company_name AS name, sector, industry,
           price_to_earnings_ratio AS pe_ratio, ev_to_ebitda, earnings_yield,
           return_on_equity AS roe, return_on_invested_capital AS roic,
           net_profit_margin AS profit_margin,
           revenue_growth_yoy AS revenue_growth, earnings_growth_yoy AS earnings_growth,
           dividend_yield, debt_to_equity_ratio AS debt_to_equity,
           current_ratio, free_cash_flow_yield, market_cap, beta,
           consecutive_net_income_growth_years AS consecutive_earnings_growth,
           revenue_growth_positive_3yr_count,
           price_to_book_ratio AS price_to_book,
           price_to_earnings_growth_ratio AS peg_ratio
    FROM stocks
    WHERE market_cap IS NOT NULL AND market_cap > 0.1
      AND is_etf IS NOT TRUE
      AND company_name !~* ${NON_COMPANY_PATTERN}
  `;

  // Score on full set (before dedup) to match screener & signal-tracker percentiles.
  // Scoring after dedup would remove GOOG and shift percentile rankings for ALL stocks.
  const enriched = allStocks.map((stock) => {
    const mcapB = (Number(stock.market_cap) || 0) / 1e9;
    return { ...(stock as unknown as Record<string, unknown>), log_market_cap: mcapB > 0 ? Math.log10(mcapB) : -1 };
  });
  const scoreMap = computeBacktestScore(enriched);

  // Dedup GOOG/GOOGL after scoring
  const googlExists = allStocks.some((s) => s.symbol === "GOOGL");
  const deduped = googlExists ? allStocks.filter((s) => s.symbol !== "GOOG") : allStocks;

  // Existing picks - no re-pitch within 1 year, no dupes for active picks
  const recentPicks = await sql`SELECT symbol FROM signal_picks WHERE pick_date >= NOW() - INTERVAL '1 year'`;
  const recentSymbols = new Set(recentPicks.map((p) => p.symbol as string));
  const existingActive = await sql`SELECT symbol FROM signal_picks WHERE status = 'active'`;
  const activeSymbols = new Set(existingActive.map((p) => p.symbol as string));

  // Find new qualifying stocks (exclude already-active and recent picks)
  const newQualifiers = deduped
    .filter((s) => {
      const sym = s.symbol as string;
      if (SYMBOL_BLOCKLIST.has(sym)) return false;
      if (activeSymbols.has(sym)) return false;
      const score = scoreMap.get(sym) || 0;
      const mcapB = (Number(s.market_cap) || 0) / 1e9;
      return !recentSymbols.has(sym) && qualifiesForPick(score, mcapB);
    })
    .map((s) => ({
      symbol: s.symbol as string,
      name: (s.name as string) || "",
      sector: (s.sector as string) || "",
      industry: (s.industry as string) || "",
      marketCapB: (Number(s.market_cap) || 0) / 1e9,
      score: scoreMap.get(s.symbol as string) || 0,
      earningsYield: s.earnings_yield != null ? Number(s.earnings_yield) : null,
      roe: s.roe != null ? Number(s.roe) : null,
      profitMargin: s.profit_margin != null ? Number(s.profit_margin) : null,
      revenueGrowth: s.revenue_growth != null ? Number(s.revenue_growth) : null,
      consecutiveEarningsGrowth: Number(s.consecutive_earnings_growth) || 0,
      peRatio: s.pe_ratio != null && Number(s.pe_ratio) > 0 ? Number(s.pe_ratio) : null,
    }));

  let added = 0;
  if (newQualifiers.length > 0) {
    const symbols = newQualifiers.map((s) => s.symbol);

    // Use Yahoo Finance live quotes for accurate entry prices (stock_prices may be stale)
    const priceMap = new Map<string, number>();
    try {
      const quotes = await Promise.allSettled(
        symbols.map(async (sym) => {
          const q = await yf.quote(sym);
          return { symbol: sym, price: q?.regularMarketPrice ?? null };
        })
      );
      for (const result of quotes) {
        if (result.status === "fulfilled" && result.value.price != null) {
          priceMap.set(result.value.symbol, Math.round(result.value.price * 100) / 100);
        }
      }
    } catch (e) {
      console.error("[refresh-signals] Yahoo Finance quote fetch failed:", e);
    }

    // Fallback: fill missing from stock_prices table
    const missingSymbols = symbols.filter((s) => !priceMap.has(s));
    if (missingSymbols.length > 0) {
      const priceRows = await sql`
        SELECT DISTINCT ON (symbol) symbol, close_price
        FROM stock_prices WHERE symbol = ANY(${missingSymbols})
        ORDER BY symbol, date DESC
      `;
      for (const r of priceRows) {
        if (!priceMap.has(r.symbol as string)) {
          priceMap.set(r.symbol as string, Number(r.close_price));
        }
      }
    }

    const today = new Date().toISOString().slice(0, 10);
    for (const stock of newQualifiers) {
      const price = priceMap.get(stock.symbol);
      if (!price) continue;
      await sql`
        INSERT INTO signal_picks (id, symbol, company_name, sector, market_cap_at_pick, score, thesis, pick_date, entry_price, status)
        VALUES (${uuidv4()}, ${stock.symbol}, ${stock.name}, ${stock.sector},
                ${stock.marketCapB * 1e9}, ${stock.score}, ${generateThesis(stock)},
                ${today}, ${price}, 'active')
      `;
      added++;
    }
  }

  // Check for sells: active picks whose score dropped below 80
  // Only sell if the stock was actually found in scoreMap (avoid false sells from missing data)
  const SELL_THRESHOLD = 80;
  const stockInfoMap = new Map<string, Record<string, unknown>>();
  for (const stock of deduped) stockInfoMap.set(stock.symbol as string, stock);
  const activePicks = await sql`SELECT id, symbol FROM signal_picks WHERE status = 'active'`;
  let sold = 0;
  // Batch-fetch live sell prices from Yahoo Finance for candidates
  const sellCandidateSyms = activePicks
    .filter((p) => {
      const score = scoreMap.get(p.symbol as string);
      return score != null && score < SELL_THRESHOLD;
    })
    .map((p) => p.symbol as string);

  const sellPriceMap = new Map<string, number>();
  if (sellCandidateSyms.length > 0) {
    try {
      const quotes = await Promise.allSettled(
        sellCandidateSyms.map(async (sym) => {
          const q = await yf.quote(sym);
          return { symbol: sym, price: q?.regularMarketPrice ?? null };
        })
      );
      for (const result of quotes) {
        if (result.status === "fulfilled" && result.value.price != null) {
          sellPriceMap.set(result.value.symbol, Math.round(result.value.price * 100) / 100);
        }
      }
    } catch (e) {
      console.error("[refresh-signals] Yahoo Finance sell price fetch failed:", e);
    }
  }

  for (const pick of activePicks) {
    const score = scoreMap.get(pick.symbol as string);
    // Skip if stock not found in scoreMap - don't sell on missing data
    if (score == null) continue;
    if (score < SELL_THRESHOLD) {
      const stockData = stockInfoMap.get(pick.symbol as string);
      const sellReason = generateLiveSellReason(stockData, score);
      // Prefer Yahoo Finance live price, fallback to stock_prices table
      let sellPrice = sellPriceMap.get(pick.symbol as string) ?? null;
      if (sellPrice == null) {
        const pr = await sql`SELECT close_price FROM stock_prices WHERE symbol = ${pick.symbol} ORDER BY date DESC LIMIT 1`;
        sellPrice = pr.length > 0 ? Number(pr[0].close_price) : null;
      }
      const today = new Date().toISOString().slice(0, 10);
      await sql`
        UPDATE signal_picks SET status = 'sold', sell_date = ${today},
          sell_price = ${sellPrice}, sell_reason = ${sellReason}
        WHERE id = ${pick.id}
      `;
      sold++;
    }
  }

  // Record score snapshot for all active signal picks + all high-scoring stocks (score >= 80).
  // Tracking a broader set allows monitoring candidates before they become signals.
  await ensureSignalScoreHistoryTable(sql);
  const today = new Date().toISOString().slice(0, 10);
  const activeAfterSells = await sql`SELECT symbol FROM signal_picks WHERE status = 'active'`;
  const snapshotSymbols = new Set(activeAfterSells.map((p) => p.symbol as string));
  // Also track all high-scoring stocks for trend analysis
  scoreMap.forEach((score, sym) => {
    if (score >= 80) snapshotSymbols.add(sym);
  });
  let recorded = 0;
  for (const sym of Array.from(snapshotSymbols)) {
    const score = scoreMap.get(sym);
    if (score == null) continue;
    await sql`
      INSERT INTO signal_score_history (symbol, score, recorded_at)
      VALUES (${sym}, ${score}, ${today})
      ON CONFLICT (symbol, recorded_at) DO UPDATE SET score = EXCLUDED.score
    `.catch(() => {});
    recorded++;
  }

  return { success: true, added, sold, checked: activePicks.length, scoreSnapshots: recorded };
}

// GET: Vercel Cron handler
export async function GET(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await refreshSignals();
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[refresh-signals] Error:", error);
    return NextResponse.json({ error: "Failed to refresh signals" }, { status: 500 });
  }
}

// POST: Manual trigger
export async function POST(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await refreshSignals();
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[refresh-signals] Error:", error);
    return NextResponse.json({ error: "Failed to refresh signals" }, { status: 500 });
  }
}
