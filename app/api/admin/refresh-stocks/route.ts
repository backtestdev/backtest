/**
 * Admin endpoint to refresh the stock database from FMP API.
 *
 * POST /api/admin/refresh-stocks
 *
 * Rate-limited: one refresh per hour. Requires ADMIN_SECRET header
 * to prevent unauthorized use.
 *
 * FMP Starter plan: 300 req/min. We throttle to ~200 req/min with
 * retry on 429 to stay within limits.
 *
 * Enrichment budget (Vercel 5-min timeout):
 *   150 stocks × 5 calls/stock × 300ms = ~225s + SQL overhead ≈ 4 min
 */

import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { refreshStockUniverse } from "@/lib/fmpService";
import { ensureStockTables } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 minutes

// Simple in-memory rate limiter: one call per hour
let lastRefreshAt = 0;
const RATE_LIMIT_MS = 60 * 60 * 1000;

const FMP_API_KEY =
  process.env.FINANCIAL_MODELING_PREP_API_KEY ||
  process.env.FMP_API_KEY ||
  "";
const FMP_BASE = "https://financialmodelingprep.com/stable";

// ── Rate-limited FMP fetch ───────────────────────────────────────────

let lastFetchTime = 0;
const MIN_FETCH_INTERVAL_MS = 300; // ~200 req/min, under 300/min limit

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchFMP<T>(endpoint: string, retries = 2): Promise<T | null> {
  const elapsed = Date.now() - lastFetchTime;
  if (elapsed < MIN_FETCH_INTERVAL_MS) {
    await sleep(MIN_FETCH_INTERVAL_MS - elapsed);
  }
  lastFetchTime = Date.now();

  const sep = endpoint.includes("?") ? "&" : "?";
  const url = `${FMP_BASE}${endpoint}${sep}apikey=${FMP_API_KEY}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (res.status === 429 && retries > 0) {
      console.warn(`[refresh] 429 on ${endpoint}, retry in 3s...`);
      await sleep(3000);
      return fetchFMP<T>(endpoint, retries - 1);
    }
    if (!res.ok) {
      console.error(`[refresh] FMP ${res.status} for ${endpoint}`);
      return null;
    }
    const data = await res.json();
    if (data && typeof data === "object" && "Error Message" in data) {
      console.error(`[refresh] FMP error for ${endpoint}:`, (data as Record<string, string>)["Error Message"]);
      return null;
    }
    return data as T;
  } catch (err) {
    console.error(`[refresh] FMP fetch failed for ${endpoint}:`, err);
    return null;
  }
}

// ── Types ──────────────────────────────────────────────────────────

interface ScreenerResult {
  symbol: string;
  companyName: string;
  marketCap: number;
  sector: string;
  industry: string;
  beta: number;
  price: number;
  lastAnnualDividend: number;
  volume: number;
  exchange: string;
  exchangeShortName: string;
  country: string;
  isEtf: boolean;
  isFund: boolean;
  isActivelyTrading: boolean;
}

interface Quote {
  symbol: string;
  price: number;
  changesPercentage: number;
  dayLow: number;
  dayHigh: number;
  yearHigh: number;
  yearLow: number;
  marketCap: number;
  priceAvg50: number;
  priceAvg200: number;
  volume: number;
  avgVolume: number;
  eps: number;
  pe: number;
  sharesOutstanding: number;
}

interface KeyMetrics {
  peRatio: number;
  pbRatio: number;
  priceToSalesRatio: number;
  debtToEquity: number;
  currentRatio: number;
  roe: number;
  roic: number;
  dividendYield: number;
  payoutRatio: number;
  freeCashFlowPerShare: number;
  revenuePerShare: number;
  netIncomePerShare: number;
  earningsYield: number;
  evToSales: number;
  enterpriseValue: number;
}

interface GrowthData {
  date: string;
  period: string; // "FY", "Q1", "Q2", "Q3", "Q4"
  revenueGrowth: number;
  netIncomeGrowth: number;
  dividendsperShareGrowth: number;
}

interface IncomeData {
  netIncomeRatio: number;
}

// ── Route handler ──────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const adminSecret = process.env.ADMIN_SECRET;
  const authHeader = request.headers.get("authorization");
  const adminHeader = request.headers.get("x-admin-secret");

  const isCron = cronSecret && authHeader === `Bearer ${cronSecret}`;
  const isAdmin = adminSecret ? adminHeader === adminSecret : true;

  if (!isCron && !isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = Date.now();
  if (!isCron && now - lastRefreshAt < RATE_LIMIT_MS) {
    const remaining = Math.ceil((RATE_LIMIT_MS - (now - lastRefreshAt)) / 60000);
    return NextResponse.json(
      { error: `Rate limited. Try again in ${remaining} minutes.` },
      { status: 429 }
    );
  }

  if (!FMP_API_KEY) {
    return NextResponse.json({ error: "FMP API key not configured" }, { status: 400 });
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 400 });
  }

  lastRefreshAt = now;
  const sql = neon(databaseUrl);

  try {
    await ensureStockTables(sql);

    // ── Step 1: Screener ───────────────────────────────────────────
    const results = await fetchFMP<ScreenerResult[]>(
      "/company-screener?marketCapMoreThan=300000000&isEtf=false&isFund=false&isActivelyTrading=true&exchange=NYSE,NASDAQ&limit=3000"
    );
    if (!results || results.length === 0) {
      return NextResponse.json({ error: "FMP screener returned no results — check API key and plan" }, { status: 502 });
    }

    const filtered = results.filter(
      (s) =>
        s.marketCap > 0 &&
        !s.symbol.includes(".") &&
        s.symbol.length <= 5 &&
        !s.isEtf &&
        !s.isFund &&
        s.sector &&
        s.sector.trim() !== ""
    );
    console.log(`[refresh] ${results.length} screener → ${filtered.length} common stocks`);

    for (const s of filtered) {
      await sql`
        INSERT INTO stocks (symbol, company_name, sector, industry, country, exchange, exchange_short_name, market_cap, beta, last_annual_dividend, is_etf, is_actively_trading, updated_at)
        VALUES (${s.symbol}, ${s.companyName}, ${s.sector}, ${s.industry}, ${s.country}, ${s.exchange}, ${s.exchangeShortName}, ${s.marketCap}, ${s.beta || 0}, ${s.lastAnnualDividend || 0}, ${s.isEtf}, ${s.isActivelyTrading}, NOW())
        ON CONFLICT (symbol) DO UPDATE SET
          company_name = EXCLUDED.company_name, sector = EXCLUDED.sector, industry = EXCLUDED.industry,
          country = EXCLUDED.country, exchange = EXCLUDED.exchange, exchange_short_name = EXCLUDED.exchange_short_name,
          market_cap = EXCLUDED.market_cap, beta = EXCLUDED.beta, last_annual_dividend = EXCLUDED.last_annual_dividend,
          is_etf = EXCLUDED.is_etf, is_actively_trading = EXCLUDED.is_actively_trading, updated_at = NOW()
      `;
    }

    // ── Step 2: Enrich top 150 ─────────────────────────────────────
    // 5 API calls per stock: quote + key-metrics + growth-annual + growth-quarterly + income
    const topRows = await sql`SELECT symbol FROM stocks ORDER BY market_cap DESC LIMIT 150`;
    const topSymbols = topRows.map((r) => String(r.symbol));
    let enriched = 0;
    let enrichFailed = 0;

    for (const sym of topSymbols) {
      try {
        const quote = await fetchFMP<Quote[]>(`/quote?symbol=${sym}`).then((r) => r?.[0] || null);
        const metrics = await fetchFMP<KeyMetrics[]>(`/key-metrics?symbol=${sym}&period=annual&limit=1`).then((r) => r?.[0] || null);
        const annualGrowth = await fetchFMP<GrowthData[]>(`/financial-growth?symbol=${sym}&period=annual&limit=8`).then((r) => r || []);
        const quarterlyGrowth = await fetchFMP<GrowthData[]>(`/financial-growth?symbol=${sym}&period=quarter&limit=8`).then((r) => r || []);
        const income = await fetchFMP<IncomeData[]>(`/income-statement?symbol=${sym}&period=annual&limit=1`).then((r) => r || []);

        // Quotes table
        if (quote) {
          await sql`
            INSERT INTO quotes (symbol, price, changes_percentage, day_low, day_high, year_high, year_low, market_cap, price_avg_50, price_avg_200, volume, avg_volume, eps, pe, shares_outstanding, updated_at)
            VALUES (${sym}, ${quote.price || 0}, ${quote.changesPercentage || 0}, ${quote.dayLow || 0}, ${quote.dayHigh || 0}, ${quote.yearHigh || 0}, ${quote.yearLow || 0}, ${quote.marketCap || 0}, ${quote.priceAvg50 || 0}, ${quote.priceAvg200 || 0}, ${quote.volume || 0}, ${quote.avgVolume || 0}, ${quote.eps || 0}, ${quote.pe || 0}, ${quote.sharesOutstanding || 0}, NOW())
            ON CONFLICT (symbol) DO UPDATE SET
              price=EXCLUDED.price, changes_percentage=EXCLUDED.changes_percentage,
              day_low=EXCLUDED.day_low, day_high=EXCLUDED.day_high,
              year_high=EXCLUDED.year_high, year_low=EXCLUDED.year_low,
              market_cap=EXCLUDED.market_cap, price_avg_50=EXCLUDED.price_avg_50,
              price_avg_200=EXCLUDED.price_avg_200, volume=EXCLUDED.volume,
              avg_volume=EXCLUDED.avg_volume, eps=EXCLUDED.eps, pe=EXCLUDED.pe,
              shares_outstanding=EXCLUDED.shares_outstanding, updated_at=NOW()
          `;
        }

        // Ratios table — use key-metrics, fall back to quote for PE
        const peRatio = metrics?.peRatio || quote?.pe || 0;
        await sql`
          INSERT INTO ratios (symbol, pe_ratio, pb_ratio, price_to_sales_ratio, debt_to_equity, current_ratio, roe, roic, dividend_yield, payout_ratio, free_cash_flow_per_share, revenue_per_share, net_income_per_share, earnings_yield, ev_to_sales, enterprise_value, updated_at)
          VALUES (${sym}, ${peRatio}, ${metrics?.pbRatio || 0}, ${metrics?.priceToSalesRatio || 0}, ${metrics?.debtToEquity || 0}, ${metrics?.currentRatio || 0}, ${metrics?.roe || 0}, ${metrics?.roic || 0}, ${metrics?.dividendYield || 0}, ${metrics?.payoutRatio || 0}, ${metrics?.freeCashFlowPerShare || 0}, ${metrics?.revenuePerShare || 0}, ${metrics?.netIncomePerShare || 0}, ${metrics?.earningsYield || 0}, ${metrics?.evToSales || 0}, ${metrics?.enterpriseValue || 0}, NOW())
          ON CONFLICT (symbol) DO UPDATE SET
            pe_ratio=EXCLUDED.pe_ratio, pb_ratio=EXCLUDED.pb_ratio, price_to_sales_ratio=EXCLUDED.price_to_sales_ratio,
            debt_to_equity=EXCLUDED.debt_to_equity, current_ratio=EXCLUDED.current_ratio, roe=EXCLUDED.roe, roic=EXCLUDED.roic,
            dividend_yield=EXCLUDED.dividend_yield, payout_ratio=EXCLUDED.payout_ratio, free_cash_flow_per_share=EXCLUDED.free_cash_flow_per_share,
            revenue_per_share=EXCLUDED.revenue_per_share, net_income_per_share=EXCLUDED.net_income_per_share,
            earnings_yield=EXCLUDED.earnings_yield, ev_to_sales=EXCLUDED.ev_to_sales, enterprise_value=EXCLUDED.enterprise_value, updated_at=NOW()
        `;

        // Profiles table — derive growth stats
        // Quarterly: period is "Q1","Q2","Q3","Q4" in /stable/ API
        const sortedQ = [...quarterlyGrowth]
          .filter((g) => g.period.startsWith("Q"))
          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        let revQ = 0;
        for (const g of sortedQ) { if (g.revenueGrowth > 0) revQ++; else break; }
        let niQ = 0;
        for (const g of sortedQ) { if (g.netIncomeGrowth > 0) niQ++; else break; }

        // Annual: dividend growth years + recent annual growth
        const sortedA = [...annualGrowth]
          .filter((g) => g.period === "FY")
          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        let divYrs = 0;
        for (const g of sortedA) { if (g.dividendsperShareGrowth > 0) divYrs++; else break; }
        const recentAnnual = sortedA[0];

        await sql`
          INSERT INTO profiles (symbol, revenue_growth, net_income_growth, earnings_growth, revenue_growth_quarters, net_income_growth_quarters, dividend_growth_years, profit_margin, historical_returns, updated_at)
          VALUES (${sym}, ${recentAnnual?.revenueGrowth || 0}, ${recentAnnual?.netIncomeGrowth || 0}, ${recentAnnual?.netIncomeGrowth || 0}, ${revQ}, ${niQ}, ${divYrs}, ${income[0]?.netIncomeRatio || 0}, ${'{}'}, NOW())
          ON CONFLICT (symbol) DO UPDATE SET
            revenue_growth=EXCLUDED.revenue_growth, net_income_growth=EXCLUDED.net_income_growth,
            earnings_growth=EXCLUDED.earnings_growth, revenue_growth_quarters=EXCLUDED.revenue_growth_quarters,
            net_income_growth_quarters=EXCLUDED.net_income_growth_quarters, dividend_growth_years=EXCLUDED.dividend_growth_years,
            profit_margin=EXCLUDED.profit_margin, updated_at=NOW()
        `;

        enriched++;
      } catch {
        enrichFailed++;
      }
    }

    // Record metadata
    const timestamp = new Date().toISOString();
    await sql`
      INSERT INTO stock_meta (key, value, updated_at)
      VALUES (${'last_populate'}, ${timestamp}, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `;

    await refreshStockUniverse();

    return NextResponse.json({
      success: true,
      stocks: filtered.length,
      enriched,
      enrichFailed,
    });
  } catch (error) {
    console.error("Refresh error:", error);
    return NextResponse.json(
      { error: "Refresh failed", details: String(error) },
      { status: 500 }
    );
  }
}

export async function GET() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return NextResponse.json({ configured: false, message: "DATABASE_URL not set" });
  }

  try {
    const sql = neon(databaseUrl);
    const meta = await sql`SELECT * FROM stock_meta WHERE key = 'last_populate'`;
    const stockCount = await sql`SELECT count(*) as cnt FROM stocks`;

    return NextResponse.json({
      configured: true,
      lastPopulate: meta[0]?.value || null,
      stockCount: Number(stockCount[0]?.cnt || 0),
      rateLimitResetMinutes:
        lastRefreshAt > 0
          ? Math.max(0, Math.ceil((RATE_LIMIT_MS - (Date.now() - lastRefreshAt)) / 60000))
          : 0,
    });
  } catch {
    return NextResponse.json({ configured: true, error: "Could not query stock_meta — run POST /api/db/init first" });
  }
}
