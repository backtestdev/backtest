import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { NON_COMPANY_PATTERN } from "@/lib/stockFilters";

export const dynamic = "force-dynamic";

const CURRENT_YEAR = new Date().getFullYear();

interface TopStock {
  symbol: string;
  name: string;
  sector: string;
  metricValue: number;
  marketCap: number;
  yearsOfData?: number;
}

interface QuintileResult {
  metric: string;
  label: string;
  quintiles: { quintile: number; avgReturn: number; stockCount: number }[];
  spread: number; // Q1 - Q5 average annual return difference
  direction: "higher_better" | "lower_better";
  yearsOfData: number;
  type: "static"; // future: "dynamic" when we have historical metric snapshots
  topStocks: TopStock[];
}

// Metrics to analyze - only numeric, filterable ones that are commonly populated.
// `expectedDirection` filters out signals whose computed direction contradicts
// financial intuition. With static (non-point-in-time) analysis, many "lower is
// better" results for quality/cash-flow metrics are artifacts of growth stocks
// dominating returns via survivorship bias. We keep only signals that would hold
// up if the analysis were point-in-time.
//
//   "higher" = only show if higher_better  (profitability, quality, growth, cash flow)
//   "lower"  = only show if lower_better   (valuation multiples, leverage)
//   "either" = show regardless              (beta, market cap - both directions documented)
//
const ANALYZABLE_METRICS: { column: string; label: string; expectedDirection: "higher" | "lower" | "either" }[] = [
  // Valuation - lower multiples = better value
  { column: "pe_ratio", label: "P/E Ratio", expectedDirection: "lower" },
  { column: "price_to_book", label: "Price / Book", expectedDirection: "lower" },
  { column: "peg_ratio", label: "PEG Ratio", expectedDirection: "lower" },
  { column: "ev_to_ebitda", label: "EV / EBITDA", expectedDirection: "lower" },
  // Removed: price_to_fair_value (overlaps with price_to_book - both measure price vs intrinsic value)
  // Removed: earnings_yield (inverse of P/E - identical signal, different direction)
  // Profitability - higher quality = better
  { column: "roe", label: "Return on Equity", expectedDirection: "higher" },
  { column: "roic", label: "Return on Invested Capital", expectedDirection: "higher" },
  { column: "return_on_assets", label: "Return on Assets", expectedDirection: "higher" },
  { column: "profit_margin", label: "Profit Margin", expectedDirection: "higher" },
  { column: "gross_profit_margin", label: "Gross Margin", expectedDirection: "higher" },
  { column: "operating_profit_margin", label: "Operating Margin", expectedDirection: "higher" },
  // Growth - higher growth = better (momentum)
  { column: "revenue_growth", label: "Revenue Growth (YoY)", expectedDirection: "higher" },
  { column: "earnings_growth", label: "Earnings Growth (YoY)", expectedDirection: "higher" },
  { column: "revenue_growth_3yr_avg", label: "Revenue Growth (3yr Avg)", expectedDirection: "higher" },
  // Dividends - higher yield = value signal
  { column: "dividend_yield", label: "Dividend Yield", expectedDirection: "higher" },
  // Payout ratio omitted: ambiguous signal (low payout = reinvestment OR unprofitable)
  // Leverage - lower debt = safer
  { column: "debt_to_equity", label: "Debt / Equity", expectedDirection: "lower" },
  { column: "current_ratio", label: "Current Ratio", expectedDirection: "higher" },
  { column: "interest_coverage_ratio", label: "Interest Coverage", expectedDirection: "higher" },
  // Earnings consistency
  { column: "consecutive_earnings_growth", label: "Consecutive Earnings Growth (Yrs)", expectedDirection: "higher" },
  // Cash Flow - higher = better
  { column: "free_cash_flow_yield", label: "FCF Yield", expectedDirection: "higher" },
  // Removed: free_cash_flow_per_share (absolute metric - FCF Yield is normalized by price and more useful)
  // Market - both directions have academic support
  { column: "market_cap", label: "Market Cap ($B)", expectedDirection: "either" },
  { column: "beta", label: "Beta", expectedDirection: "either" },
];

export async function GET(request: NextRequest) {
  const sql = getDb();
  if (!sql) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 }
    );
  }

  // Time period: 5, 10, or 20 years. Default 10.
  const { searchParams } = new URL(request.url);
  const periodParam = Number(searchParams.get("period")) || 10;
  const period = [5, 10, 20].includes(periodParam) ? periodParam : 10;
  const minYear = CURRENT_YEAR - period;

  try {
    // Get all stocks with their annual returns in one query
    const stockRows = await sql`
      SELECT s.symbol, s.company_name, s.sector,
             s.price_to_earnings_ratio AS pe_ratio,
             s.price_to_book_ratio AS price_to_book,
             s.price_to_earnings_growth_ratio AS peg_ratio,
             s.ev_to_ebitda, s.price_to_fair_value, s.earnings_yield,
             s.return_on_equity AS roe,
             s.return_on_invested_capital AS roic,
             s.return_on_assets,
             s.net_profit_margin AS profit_margin,
             s.gross_profit_margin, s.operating_profit_margin,
             s.revenue_growth_yoy AS revenue_growth,
             s.earnings_growth_yoy AS earnings_growth,
             s.revenue_growth_3yr_avg,
             s.dividend_yield,
             s.dividend_payout_ratio AS payout_ratio,
             s.debt_to_equity_ratio AS debt_to_equity,
             s.current_ratio, s.interest_coverage_ratio,
             s.free_cash_flow_yield, s.free_cash_flow_per_share,
             s.market_cap, s.beta,
             s.consecutive_net_income_growth_years AS consecutive_earnings_growth
      FROM stocks s
      WHERE s.market_cap IS NOT NULL AND s.market_cap > 0.1
        AND s.is_etf IS NOT TRUE
        AND s.company_name !~* ${NON_COMPANY_PATTERN}
    `;

    const returnRows = await sql`
      SELECT symbol, year, annual_return FROM stock_annual_returns
      WHERE year >= ${minYear} AND year < ${CURRENT_YEAR}
    `;

    // Build returns lookup: symbol -> { year -> return }
    const returnsMap = new Map<string, Map<number, number>>();
    for (const row of returnRows) {
      if (!returnsMap.has(row.symbol)) {
        returnsMap.set(row.symbol, new Map());
      }
      returnsMap.get(row.symbol)!.set(Number(row.year), Number(row.annual_return));
    }

    // Count years of return data per symbol (for listing recency)
    const yearsOfDataPerSymbol = new Map<string, number>();
    returnsMap.forEach((yearMap, symbol) => {
      yearsOfDataPerSymbol.set(symbol, yearMap.size);
    });

    // Find min/max year for metadata
    const yearsSet = new Set<number>();
    returnRows.forEach((row) => yearsSet.add(Number(row.year)));
    const yearsOfData = yearsSet.size;

    const results: QuintileResult[] = [];

    // Sector display name mapping
    const SECTOR_DISPLAY: Record<string, string> = {
      "Technology": "Technology", "Healthcare": "Healthcare",
      "Financial Services": "Financial", "Finance": "Financial",
      "Energy": "Energy", "Consumer Cyclical": "Consumer",
      "Consumer Defensive": "Consumer", "Industrials": "Industrials",
      "Basic Materials": "Basic Materials", "Real Estate": "Real Estate",
      "Utilities": "Utilities", "Communication Services": "Communication",
    };
    const sectorName = (raw: unknown) => {
      const s = String(raw || "");
      return SECTOR_DISPLAY[s] || s || "Other";
    };

    // Deduplicate GOOG/GOOGL - keep GOOGL (Class A), drop GOOG (Class C)
    const googlExists = stockRows.some((s) => s.symbol === "GOOGL");
    const dedupedRows = googlExists
      ? stockRows.filter((s) => s.symbol !== "GOOG")
      : stockRows;

    // Build a lookup for stock metadata
    const stockMeta = new Map<string, { name: string; sector: string; marketCap: number }>();
    for (const row of dedupedRows) {
      stockMeta.set(row.symbol as string, {
        name: (row.company_name as string) || "",
        sector: sectorName(row.sector),
        marketCap: Number(row.market_cap || 0) / 1_000_000_000,
      });
    }

    for (const metric of ANALYZABLE_METRICS) {
      // Get stocks with non-null values for this metric
      const stocksWithMetric = dedupedRows
        .filter((s) => s[metric.column] !== null && s[metric.column] !== undefined)
        .map((s) => ({
          symbol: s.symbol as string,
          value: Number(s[metric.column]),
        }))
        .filter((s) => !isNaN(s.value) && isFinite(s.value));

      if (stocksWithMetric.length < 50) continue; // need enough data

      // Sort by metric value and assign quintiles
      stocksWithMetric.sort((a, b) => a.value - b.value);
      const quintileSize = Math.ceil(stocksWithMetric.length / 5);

      const quintileReturns: { totalReturn: number; count: number; stockCount: number }[] = [
        { totalReturn: 0, count: 0, stockCount: 0 },
        { totalReturn: 0, count: 0, stockCount: 0 },
        { totalReturn: 0, count: 0, stockCount: 0 },
        { totalReturn: 0, count: 0, stockCount: 0 },
        { totalReturn: 0, count: 0, stockCount: 0 },
      ];

      for (let i = 0; i < stocksWithMetric.length; i++) {
        const q = Math.min(Math.floor(i / quintileSize), 4);
        const stockReturns = returnsMap.get(stocksWithMetric[i].symbol);
        if (!stockReturns) continue;

        quintileReturns[q].stockCount++;
        stockReturns.forEach((ret) => {
          quintileReturns[q].totalReturn += ret;
          quintileReturns[q].count++;
        });
      }

      // Compute average annual returns per quintile
      const quintiles = quintileReturns.map((qr, i) => ({
        quintile: i + 1,
        avgReturn: qr.count > 0 ? qr.totalReturn / qr.count : 0,
        stockCount: qr.stockCount,
      }));

      // Skip if quintiles are too sparse
      if (quintiles[0].stockCount < 5 || quintiles[4].stockCount < 5) continue;

      const q1Avg = quintiles[0].avgReturn;
      const q5Avg = quintiles[4].avgReturn;
      const spread = q1Avg - q5Avg;
      const direction: "higher_better" | "lower_better" = spread < 0 ? "higher_better" : "lower_better";

      // Skip signals where the computed direction contradicts financial intuition.
      // These are almost always artifacts of static (non-point-in-time) analysis.
      if (metric.expectedDirection !== "either") {
        const expected = metric.expectedDirection === "higher" ? "higher_better" : "lower_better";
        if (direction !== expected) continue;
      }

      // Top stocks from the winner quintile, sorted by metric value (most extreme first).
      // Winner = Q5 for higher_better (highest values), Q1 for lower_better (lowest values).
      // Return up to 20 so the client can compute composite top stocks across signals.
      const winnerStart = direction === "higher_better"
        ? stocksWithMetric.length - quintileSize
        : 0;
      const winnerEnd = direction === "higher_better"
        ? stocksWithMetric.length
        : quintileSize;
      const winnerSlice = stocksWithMetric.slice(winnerStart, winnerEnd);
      // Sort by metric value: best-in-class first
      const sortedWinners = winnerSlice
        .filter((s) => {
          const meta = stockMeta.get(s.symbol);
          return meta && meta.marketCap >= 1; // ≥$1B market cap for relevance
        })
        .sort((a, b) =>
          direction === "higher_better" ? b.value - a.value : a.value - b.value
        );
      const topStocks = sortedWinners
        .slice(0, 20)
        .map((s) => {
          const meta = stockMeta.get(s.symbol);
          const yrs = yearsOfDataPerSymbol.get(s.symbol) ?? 0;
          return {
            symbol: s.symbol,
            name: meta?.name || "",
            sector: meta?.sector || "Other",
            metricValue: s.value,
            marketCap: meta?.marketCap || 0,
            yearsOfData: yrs < 3 ? yrs : undefined, // only include if recently listed
          };
        });

      results.push({
        metric: metric.column,
        label: metric.label,
        quintiles,
        spread: Math.abs(spread),
        direction,
        yearsOfData,
        type: "static",
        topStocks,
      });
    }

    // Sort by strongest signal (largest spread)
    results.sort((a, b) => b.spread - a.spread);

    return NextResponse.json({
      signals: results,
      stockCount: dedupedRows.length,
      yearsAnalyzed: yearsOfData,
      period,
      methodology: "static",
    });
  } catch (error) {
    console.error("Signal analysis error:", error);
    return NextResponse.json(
      { error: "Failed to compute signals" },
      { status: 500 }
    );
  }
}
