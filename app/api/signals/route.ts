import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

const CURRENT_YEAR = new Date().getFullYear();

interface QuintileResult {
  metric: string;
  label: string;
  quintiles: { quintile: number; avgReturn: number; stockCount: number }[];
  spread: number; // Q1 - Q5 average annual return difference
  direction: "higher_better" | "lower_better";
  yearsOfData: number;
  type: "static"; // future: "dynamic" when we have historical metric snapshots
}

// Metrics to analyze — only numeric, filterable ones that are commonly populated
const ANALYZABLE_METRICS: { column: string; label: string }[] = [
  // Valuation
  { column: "pe_ratio", label: "P/E Ratio" },
  { column: "price_to_book", label: "Price / Book" },
  { column: "peg_ratio", label: "PEG Ratio" },
  { column: "ev_to_ebitda", label: "EV / EBITDA" },
  { column: "price_to_fair_value", label: "Price / Fair Value" },
  { column: "earnings_yield", label: "Earnings Yield" },
  // Profitability
  { column: "roe", label: "Return on Equity" },
  { column: "roic", label: "Return on Invested Capital" },
  { column: "return_on_assets", label: "Return on Assets" },
  { column: "profit_margin", label: "Profit Margin" },
  { column: "gross_profit_margin", label: "Gross Margin" },
  { column: "operating_profit_margin", label: "Operating Margin" },
  // Growth
  { column: "revenue_growth", label: "Revenue Growth (YoY)" },
  { column: "earnings_growth", label: "Earnings Growth (YoY)" },
  { column: "revenue_growth_3yr_avg", label: "Revenue Growth (3yr Avg)" },
  // Dividends
  { column: "dividend_yield", label: "Dividend Yield" },
  { column: "payout_ratio", label: "Payout Ratio" },
  // Leverage
  { column: "debt_to_equity", label: "Debt / Equity" },
  { column: "current_ratio", label: "Current Ratio" },
  { column: "interest_coverage_ratio", label: "Interest Coverage" },
  // Earnings consistency
  { column: "consecutive_earnings_growth", label: "Consecutive Earnings Growth (Yrs)" },
  // Cash Flow
  { column: "free_cash_flow_yield", label: "FCF Yield" },
  { column: "free_cash_flow_per_share", label: "FCF / Share" },
  // Market
  { column: "market_cap", label: "Market Cap ($B)" },
  { column: "beta", label: "Beta" },
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
      SELECT s.symbol,
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

    // Find min/max year for metadata
    const yearsSet = new Set<number>();
    returnRows.forEach((row) => yearsSet.add(Number(row.year)));
    const yearsOfData = yearsSet.size;

    const results: QuintileResult[] = [];

    for (const metric of ANALYZABLE_METRICS) {
      // Get stocks with non-null values for this metric
      const stocksWithMetric = stockRows
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

      results.push({
        metric: metric.column,
        label: metric.label,
        quintiles,
        spread: Math.abs(spread),
        direction,
        yearsOfData,
        type: "static",
      });
    }

    // Sort by strongest signal (largest spread)
    results.sort((a, b) => b.spread - a.spread);

    return NextResponse.json({
      signals: results,
      stockCount: stockRows.length,
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
