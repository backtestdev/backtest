import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

// Sector display name mapping (FMP sector text → clean display name)
const SECTOR_DISPLAY: Record<string, string> = {
  "Technology": "Technology",
  "Healthcare": "Healthcare",
  "Financial Services": "Financial",
  "Finance": "Financial",
  "Energy": "Energy",
  "Consumer Cyclical": "Consumer",
  "Consumer Defensive": "Consumer",
  "Industrials": "Industrials",
  "Basic Materials": "Basic Materials",
  "Real Estate": "Real Estate",
  "Utilities": "Utilities",
  "Communication Services": "Communication",
};

function sectorName(raw: unknown): string {
  const s = String(raw || "");
  return SECTOR_DISPLAY[s] || s || "Other";
}

// Factor weights for Backtest Score (multi-factor model)
// Emphasizes: earnings yield (profit/mcap), earnings growth & consistency
const SCORE_FACTORS: { column: string; weight: number; capLow: number; capHigh: number }[] = [
  // Earnings relative to price — strongest signal (higher is better)
  { column: "earnings_yield", weight: 20, capLow: -0.1, capHigh: 0.3 },
  // Earnings growth — capped tight to prevent turnaround distortion (higher is better)
  { column: "earnings_growth", weight: 10, capLow: -0.5, capHigh: 0.5 },
  // Earnings consistency — years of consecutive net income growth (higher is better)
  { column: "consecutive_earnings_growth", weight: 15, capLow: 0, capHigh: 10 },
  // Value (lower is better)
  { column: "pe_ratio", weight: -10, capLow: 0, capHigh: 60 },
  { column: "ev_to_ebitda", weight: -5, capLow: 0, capHigh: 40 },
  // Quality (higher is better)
  { column: "roe", weight: 10, capLow: -0.5, capHigh: 1.0 },
  { column: "profit_margin", weight: 10, capLow: -0.5, capHigh: 0.5 },
  { column: "roic", weight: 5, capLow: -0.3, capHigh: 0.5 },
  // Growth
  { column: "revenue_growth", weight: 5, capLow: -0.5, capHigh: 2.0 },
  // Cash flow (higher is better)
  { column: "free_cash_flow_yield", weight: 5, capLow: -0.2, capHigh: 0.3 },
  // Leverage (lower debt is better)
  { column: "debt_to_equity", weight: -5, capLow: 0, capHigh: 5 },
  // Beta — higher beta stocks show stronger raw returns in signal explorer data.
  // Strongest spread factor; weight aligns with empirical quintile results.
  { column: "beta", weight: 8, capLow: 0, capHigh: 3 },
  // Size confidence — log(market cap in $B). Larger companies have more
  // reliable metrics; prevents micro/small-cap noise from dominating.
  // log10($1B)=0, log10($10B)=1, log10($100B)=2, log10($1T)=3
  { column: "log_market_cap", weight: 12, capLow: -0.5, capHigh: 3.0 },
];

function computeBacktestScore(stocks: Record<string, unknown>[]): Map<string, number> {
  const scores = new Map<string, number>();

  for (const factor of SCORE_FACTORS) {
    const values: { symbol: string; value: number }[] = [];
    for (const stock of stocks) {
      const val = Number(stock[factor.column]);
      if (isNaN(val) || !isFinite(val) || stock[factor.column] === null) continue;
      // Exclude negative P/E (unprofitable) — would distort percentile ranking
      if (factor.column === "pe_ratio" && val <= 0) continue;
      const capped = Math.max(factor.capLow, Math.min(factor.capHigh, val));
      values.push({ symbol: stock.symbol as string, value: capped });
    }

    if (values.length < 10) continue;

    values.sort((a, b) => a.value - b.value);
    for (let i = 0; i < values.length; i++) {
      const percentile = i / (values.length - 1);
      const contribution = factor.weight > 0
        ? percentile * Math.abs(factor.weight)
        : (1 - percentile) * Math.abs(factor.weight);

      const prev = scores.get(values[i].symbol) || 0;
      scores.set(values[i].symbol, prev + contribution);
    }
  }

  // Normalize to 1-100
  const rawScores = Array.from(scores.entries());
  if (rawScores.length === 0) return scores;

  const maxRaw = Math.max(...rawScores.map(([, v]) => v));
  const minRaw = Math.min(...rawScores.map(([, v]) => v));
  const range = maxRaw - minRaw || 1;

  for (const [symbol, raw] of rawScores) {
    scores.set(symbol, Math.round(((raw - minRaw) / range) * 99) + 1);
  }

  // Hard penalty for sub-$5B market cap stocks (after normalization).
  // Linear ramp: $0 → -15pts, $5B → 0pts. Stacks with the log_market_cap
  // factor which is a softer gradient; this is a true penalty.
  for (const stock of stocks) {
    const mcapB = Number(stock.market_cap || 0) / 1_000_000_000;
    if (mcapB < 5) {
      const sym = stock.symbol as string;
      const current = scores.get(sym);
      if (current !== undefined) {
        const penalty = Math.round(((5 - mcapB) / 5) * 15);
        scores.set(sym, Math.max(1, current - penalty));
      }
    }
  }

  // Hard penalty for weak/declining revenue (after normalization).
  // Tier 1: YoY growth < 3% but non-negative → mild penalty (up to -5 pts)
  // Tier 2: YoY growth negative (decline) → bigger penalty (-10 pts)
  // Tier 3: Multiple declining years out of last 3 → stacking penalty
  //         2/3 positive = -5, 1/3 = -10, 0/3 = -15
  for (const stock of stocks) {
    const sym = stock.symbol as string;
    const current = scores.get(sym);
    if (current === undefined) continue;

    const yoyGrowth = Number(stock.revenue_growth ?? 0);
    let penalty = 0;

    if (yoyGrowth < 0) {
      // Revenue decline: -10 flat (big red flag)
      penalty = 10;
    } else if (yoyGrowth < 0.03) {
      // Stagnation (0% to 3%): linear ramp, 0% → -5, 3% → 0
      penalty = Math.round(((0.03 - yoyGrowth) / 0.03) * 5);
    }

    // Multi-year decline: penalize based on how many of last 3 years declined
    const positiveYears = Number(stock.revenue_growth_positive_3yr_count ?? 3);
    if (positiveYears < 3) {
      const decliningYears = 3 - positiveYears; // 1, 2, or 3
      penalty += decliningYears * 5; // -5, -10, or -15
    }

    if (penalty > 0) {
      scores.set(sym, Math.max(1, current - penalty));
    }
  }

  return scores;
}

export async function GET(request: NextRequest) {
  const sql = getDb();
  if (!sql) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const sortBy = searchParams.get("sort") || "backtest_score";
  const sortDir = searchParams.get("dir") || "desc";
  const sectorFilter = searchParams.get("sector") || "";
  const search = (searchParams.get("search") || "").trim();
  const minMarketCap = Number(searchParams.get("minCap")) || 0;
  const maxMarketCap = Number(searchParams.get("maxCap")) || 0;
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const perPage = search ? 10 : 50;

  try {
    const allStocks = await sql`
      SELECT symbol, company_name AS name, sector,
             price_to_earnings_ratio AS pe_ratio,
             price_to_book_ratio AS price_to_book,
             price_to_earnings_growth_ratio AS peg_ratio,
             ev_to_ebitda, price_to_fair_value, earnings_yield,
             return_on_equity AS roe,
             return_on_invested_capital AS roic,
             return_on_assets,
             net_profit_margin AS profit_margin,
             gross_profit_margin, operating_profit_margin,
             revenue_growth_yoy AS revenue_growth,
             earnings_growth_yoy AS earnings_growth,
             dividend_yield,
             dividend_payout_ratio AS payout_ratio,
             debt_to_equity_ratio AS debt_to_equity,
             current_ratio, interest_coverage_ratio,
             free_cash_flow_yield, free_cash_flow_per_share,
             market_cap, beta,
             consecutive_net_income_growth_years AS consecutive_earnings_growth,
             revenue_growth_positive_3yr_count,
             CASE WHEN year_high > 0 THEN price / year_high ELSE 0 END AS week52_high_pct
      FROM stocks
      WHERE market_cap IS NOT NULL AND market_cap > 0.1
    `;

    // Enrich with computed log_market_cap for size-confidence scoring
    const enriched = allStocks.map((stock) => {
      const mcapBillions = (Number(stock.market_cap) || 0) / 1_000_000_000;
      return {
        ...(stock as unknown as Record<string, unknown>),
        log_market_cap: mcapBillions > 0 ? Math.log10(mcapBillions) : -1,
      };
    });

    const scoreMap = computeBacktestScore(enriched);

    // Build result with all fields
    let filtered = allStocks.map((stock) => ({
      symbol: stock.symbol as string,
      name: stock.name as string,
      sector: sectorName(stock.sector),
      marketCap: (Number(stock.market_cap) || 0) / 1_000_000_000,
      peRatio: stock.pe_ratio !== null && Number(stock.pe_ratio) > 0 ? Number(stock.pe_ratio) : null,
      roe: stock.roe !== null ? Number(stock.roe) : null,
      revenueGrowth: stock.revenue_growth !== null ? Number(stock.revenue_growth) : null,
      earningsGrowth: stock.earnings_growth !== null ? Number(stock.earnings_growth) : null,
      earningsYield: stock.earnings_yield !== null ? Number(stock.earnings_yield) : null,
      profitMargin: stock.profit_margin !== null ? Number(stock.profit_margin) : null,
      dividendYield: stock.dividend_yield !== null ? Number(stock.dividend_yield) : null,
      debtToEquity: stock.debt_to_equity !== null ? Number(stock.debt_to_equity) : null,
      beta: stock.beta !== null ? Number(stock.beta) : null,
      evToEbitda: stock.ev_to_ebitda !== null ? Number(stock.ev_to_ebitda) : null,
      freeCashFlowYield: stock.free_cash_flow_yield !== null ? Number(stock.free_cash_flow_yield) : null,
      consecutiveEarningsGrowth: Number(stock.consecutive_earnings_growth) || 0,
      currentRatio: stock.current_ratio !== null ? Number(stock.current_ratio) : null,
      backtestScore: scoreMap.get(stock.symbol as string) || 0,
    }));

    // Search filter
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(
        (s) => s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
      );
    }

    // Sector filter
    if (sectorFilter) {
      filtered = filtered.filter((s) => s.sector.toLowerCase() === sectorFilter.toLowerCase());
    }
    if (minMarketCap > 0) {
      filtered = filtered.filter((s) => s.marketCap >= minMarketCap);
    }
    if (maxMarketCap > 0) {
      filtered = filtered.filter((s) => s.marketCap <= maxMarketCap);
    }

    // Sort
    type StockResult = typeof filtered[0];
    const sortKey: keyof StockResult = sortBy === "backtest_score" ? "backtestScore"
      : sortBy === "market_cap" ? "marketCap"
      : sortBy === "pe_ratio" ? "peRatio"
      : sortBy === "roe" ? "roe"
      : sortBy === "earnings_yield" ? "earningsYield"
      : sortBy === "earnings_growth" ? "earningsGrowth"
      : sortBy === "revenue_growth" ? "revenueGrowth"
      : sortBy === "dividend_yield" ? "dividendYield"
      : "backtestScore";

    filtered.sort((a, b) => {
      const aVal = (a[sortKey] as number | null) ?? -Infinity;
      const bVal = (b[sortKey] as number | null) ?? -Infinity;
      return sortDir === "desc" ? bVal - aVal : aVal - bVal;
    });

    const totalCount = filtered.length;
    const paginated = filtered.slice((page - 1) * perPage, page * perPage);

    // Unique sectors for filter dropdown
    const sectors = Array.from(new Set(allStocks.map((s) => sectorName(s.sector)).filter((s) => s !== "Other"))).sort();

    return NextResponse.json({
      stocks: paginated,
      totalCount,
      page,
      perPage,
      sectors,
    });
  } catch (error) {
    console.error("Screener error:", error);
    return NextResponse.json({ error: "Failed to load stocks" }, { status: 500 });
  }
}
