import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

// Factor weights for Backtest Score (multi-factor model)
// Positive weight = higher is better, negative weight = lower is better
const SCORE_FACTORS: { column: string; weight: number; capLow: number; capHigh: number }[] = [
  // Value (lower is better)
  { column: "pe_ratio", weight: -15, capLow: 0, capHigh: 60 },
  { column: "price_to_book", weight: -10, capLow: 0, capHigh: 15 },
  { column: "ev_to_ebitda", weight: -5, capLow: 0, capHigh: 40 },
  // Quality (higher is better)
  { column: "roe", weight: 15, capLow: -0.5, capHigh: 1.0 },
  { column: "roic", weight: 10, capLow: -0.3, capHigh: 0.5 },
  { column: "profit_margin", weight: 10, capLow: -0.5, capHigh: 0.5 },
  // Growth (higher is better)
  { column: "revenue_growth", weight: 10, capLow: -0.5, capHigh: 2.0 },
  { column: "earnings_growth", weight: 10, capLow: -1.0, capHigh: 3.0 },
  // Cash flow (higher is better)
  { column: "free_cash_flow_yield", weight: 10, capLow: -0.2, capHigh: 0.3 },
  // Leverage (lower debt is better)
  { column: "debt_to_equity", weight: -5, capLow: 0, capHigh: 5 },
  // Dividends
  { column: "dividend_yield", weight: 5, capLow: 0, capHigh: 0.12 },
  // Momentum
  { column: "week52_high_pct", weight: 5, capLow: 0, capHigh: 1.0 },
];

function computeBacktestScore(stocks: Record<string, unknown>[]): Map<string, number> {
  const scores = new Map<string, number>();
  const totalWeight = SCORE_FACTORS.reduce((sum, f) => sum + Math.abs(f.weight), 0);

  // For each factor, compute percentile rank across all stocks
  for (const factor of SCORE_FACTORS) {
    const values: { symbol: string; value: number }[] = [];
    for (const stock of stocks) {
      const val = Number(stock[factor.column]);
      if (isNaN(val) || !isFinite(val) || stock[factor.column] === null) continue;
      const capped = Math.max(factor.capLow, Math.min(factor.capHigh, val));
      values.push({ symbol: stock.symbol as string, value: capped });
    }

    if (values.length < 10) continue;

    // Sort and assign percentile (0-1)
    values.sort((a, b) => a.value - b.value);
    for (let i = 0; i < values.length; i++) {
      const percentile = i / (values.length - 1); // 0 = lowest, 1 = highest
      // If higher is better (positive weight), higher percentile = better
      // If lower is better (negative weight), lower percentile = better
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
  const minMarketCap = Number(searchParams.get("minCap")) || 0;
  const maxMarketCap = Number(searchParams.get("maxCap")) || 0;
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const perPage = 50;

  try {
    // Fetch all stocks for scoring
    const allStocks = await sql`
      SELECT symbol, name, sector,
             pe_ratio, forward_pe, price_to_book, peg_ratio, ev_to_ebitda,
             price_to_fair_value, earnings_yield,
             roe, roic, return_on_assets, profit_margin,
             gross_profit_margin, operating_profit_margin,
             revenue_growth, earnings_growth,
             dividend_yield, payout_ratio,
             debt_to_equity, current_ratio, interest_coverage_ratio,
             free_cash_flow_yield, free_cash_flow_per_share,
             market_cap, beta, week52_high_pct
      FROM stocks
      WHERE market_cap IS NOT NULL AND market_cap > 0.1
    `;

    // Compute backtest scores for all stocks
    const scoreMap = computeBacktestScore(allStocks as unknown as Record<string, unknown>[]);

    // Sector name mapping
    const sectorNames: Record<number, string> = {
      1: "Technology", 2: "Healthcare", 3: "Financial", 4: "Energy",
      5: "Consumer", 6: "Industrials", 7: "Basic Materials", 8: "Real Estate",
      9: "Utilities", 10: "Communication Services",
    };

    // Apply filters and build result
    let filtered = allStocks.map((stock) => ({
      symbol: stock.symbol as string,
      name: stock.name as string,
      sector: sectorNames[Number(stock.sector)] || "Other",
      sectorId: Number(stock.sector),
      marketCap: Number(stock.market_cap) || 0,
      peRatio: stock.pe_ratio !== null ? Number(stock.pe_ratio) : null,
      roe: stock.roe !== null ? Number(stock.roe) : null,
      revenueGrowth: stock.revenue_growth !== null ? Number(stock.revenue_growth) : null,
      profitMargin: stock.profit_margin !== null ? Number(stock.profit_margin) : null,
      dividendYield: stock.dividend_yield !== null ? Number(stock.dividend_yield) : null,
      debtToEquity: stock.debt_to_equity !== null ? Number(stock.debt_to_equity) : null,
      beta: stock.beta !== null ? Number(stock.beta) : null,
      backtestScore: scoreMap.get(stock.symbol as string) || 0,
    }));

    // Apply filters
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
    const sortKey = sortBy === "backtest_score" ? "backtestScore"
      : sortBy === "market_cap" ? "marketCap"
      : sortBy === "pe_ratio" ? "peRatio"
      : sortBy === "roe" ? "roe"
      : sortBy === "revenue_growth" ? "revenueGrowth"
      : sortBy === "dividend_yield" ? "dividendYield"
      : "backtestScore";

    filtered.sort((a, b) => {
      const aVal = a[sortKey as keyof typeof a] ?? -Infinity;
      const bVal = b[sortKey as keyof typeof b] ?? -Infinity;
      return sortDir === "desc"
        ? (bVal as number) - (aVal as number)
        : (aVal as number) - (bVal as number);
    });

    const totalCount = filtered.length;
    const paginated = filtered.slice((page - 1) * perPage, page * perPage);

    // Get unique sectors for filter dropdown
    const sectors = [...new Set(allStocks.map((s) => sectorNames[Number(s.sector)]).filter(Boolean))].sort();

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
