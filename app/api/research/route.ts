import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import OpenAI from "openai";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FMP_API_KEY =
  process.env.FINANCIAL_MODELING_PREP_API_KEY ||
  process.env.FMP_API_KEY ||
  "";
const FMP_BASE = "https://financialmodelingprep.com/stable";

// ── FMP data fetching ────────────────────────────────────────────────

async function fetchFMP<T>(endpoint: string): Promise<T | null> {
  if (!FMP_API_KEY) return null;
  const sep = endpoint.includes("?") ? "&" : "?";
  const url = `${FMP_BASE}${endpoint}${sep}apikey=${FMP_API_KEY}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ── FMP Stable API interfaces (field names match actual API response) ──

interface FMPProfile {
  symbol: string;
  companyName: string;
  price: number;
  marketCap: number;
  sector: string;
  industry: string;
  description: string;
  exchange: string;
  currency: string;
  country: string;
  ipoDate: string;
  beta: number;
  volAvg: number;
  isActivelyTrading: boolean;
  image: string;
  // Stable API may also return these as fallbacks
  mktCap?: number;
}

interface FMPIncomeStatement {
  date: string;
  revenue: number;
  grossProfit: number;
  grossProfitRatio: number;
  operatingIncome: number;
  operatingIncomeRatio: number;
  netIncome: number;
  netIncomeRatio: number;
  eps: number;
  epsDiluted: number;
  ebitda: number;
  ebitdaratio: number;
  researchAndDevelopmentExpenses: number;
}

interface FMPKeyMetrics {
  date: string;
  marketCap?: number;
  enterpriseValue?: number;
  evToSales?: number;
  evToEBITDA?: number;
  currentRatio?: number;
  returnOnEquity?: number;
  returnOnInvestedCapital?: number;
  freeCashFlowYield?: number;
  earningsYield?: number;
}

interface FMPRatios {
  date: string;
  priceToEarningsRatio?: number;
  priceToBookRatio?: number;
  priceToSalesRatio?: number;
  debtToEquityRatio?: number;
  currentRatio?: number;
  dividendYield?: number;
  dividendYieldPercentage?: number;
  grossProfitMargin?: number;
  operatingProfitMargin?: number;
  netProfitMargin?: number;
  freeCashFlowPerShare?: number;
  netIncomePerShare?: number;
  revenuePerShare?: number;
}

// ── Build data context for AI ────────────────────────────────────────

function buildFinancialContext(
  profile: FMPProfile,
  income: FMPIncomeStatement[],
  metrics: FMPKeyMetrics[],
  ratios: FMPRatios[]
): string {
  const latest = income[0];
  const prev = income[1];
  const latestMetrics = metrics[0];
  const latestRatios = ratios[0];
  const mktCap = profile.marketCap || profile.mktCap;

  const revenueGrowth =
    latest && prev && prev.revenue > 0
      ? ((latest.revenue - prev.revenue) / prev.revenue) * 100
      : null;

  const lines: string[] = [
    `Company: ${profile.companyName} (${profile.symbol})`,
    `Sector: ${profile.sector} | Industry: ${profile.industry}`,
    `Exchange: ${profile.exchange} | Country: ${profile.country}`,
    `Current Price: $${profile.price?.toFixed(2) || "N/A"}`,
    `Market Cap: $${mktCap ? (mktCap / 1e9).toFixed(1) + "B" : "N/A"}`,
    `Beta: ${profile.beta?.toFixed(2) || "N/A"}`,
    `IPO Date: ${profile.ipoDate || "N/A"}`,
    "",
    "--- Latest Annual Financials ---",
  ];

  if (latest) {
    lines.push(
      `Period: ${latest.date}`,
      `Revenue: $${(latest.revenue / 1e9).toFixed(2)}B`,
      `Revenue Growth: ${revenueGrowth !== null ? revenueGrowth.toFixed(1) + "%" : "N/A"}`,
      `Gross Margin: ${(latest.grossProfitRatio * 100).toFixed(1)}%`,
      `Operating Margin: ${(latest.operatingIncomeRatio * 100).toFixed(1)}%`,
      `Net Margin: ${(latest.netIncomeRatio * 100).toFixed(1)}%`,
      `Net Income: $${(latest.netIncome / 1e9).toFixed(2)}B`,
      `EPS (diluted): $${latest.epsDiluted?.toFixed(2) || "N/A"}`,
      `EBITDA: $${(latest.ebitda / 1e9).toFixed(2)}B`
    );
  }

  if (latestRatios) {
    lines.push(
      "",
      "--- Valuation Ratios ---",
      `P/E Ratio: ${latestRatios.priceToEarningsRatio?.toFixed(1) || "N/A"}`,
      `P/B Ratio: ${latestRatios.priceToBookRatio?.toFixed(1) || "N/A"}`,
      `Debt/Equity: ${latestRatios.debtToEquityRatio?.toFixed(2) || "N/A"}`,
      `Dividend Yield: ${latestRatios.dividendYield ? (latestRatios.dividendYield * 100).toFixed(2) + "%" : "N/A"}`
    );
  }

  if (latestMetrics) {
    lines.push(
      "",
      "--- Key Metrics ---",
      `EV/Sales: ${latestMetrics.evToSales?.toFixed(1) || "N/A"}`,
      `EV/EBITDA: ${latestMetrics.evToEBITDA?.toFixed(1) || "N/A"}`,
      `ROE: ${latestMetrics.returnOnEquity ? (latestMetrics.returnOnEquity * 100).toFixed(1) + "%" : "N/A"}`,
      `ROIC: ${latestMetrics.returnOnInvestedCapital ? (latestMetrics.returnOnInvestedCapital * 100).toFixed(1) + "%" : "N/A"}`,
      `Enterprise Value: $${latestMetrics.enterpriseValue ? (latestMetrics.enterpriseValue / 1e9).toFixed(1) + "B" : "N/A"}`
    );
  }

  // Historical revenue + earnings trend
  if (income.length > 1) {
    lines.push("", "--- Revenue & Earnings Trend ---");
    for (const stmt of income) {
      lines.push(`  ${stmt.date}: Revenue $${(stmt.revenue / 1e9).toFixed(2)}B, Net Income $${(stmt.netIncome / 1e9).toFixed(2)}B (margin: ${(stmt.netIncomeRatio * 100).toFixed(1)}%)`);
    }
  }

  lines.push("", `Description: ${profile.description || "N/A"}`);

  return lines.join("\n");
}

// ── Main handler ─────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const ticker = request.nextUrl.searchParams.get("ticker")?.toUpperCase();
  if (!ticker || !/^[A-Z]{1,5}$/.test(ticker)) {
    return NextResponse.json({ error: "Invalid ticker symbol" }, { status: 400 });
  }

  // Check auth for full report gating
  const { userId } = await auth();
  const isAuthenticated = !!userId;

  // Fetch FMP data in parallel (4 endpoints)
  const [profileArr, incomeArr, metricsArr, ratiosArr] = await Promise.all([
    fetchFMP<FMPProfile[]>(`/profile?symbol=${ticker}`),
    fetchFMP<FMPIncomeStatement[]>(`/income-statement?symbol=${ticker}&period=annual&limit=5`),
    fetchFMP<FMPKeyMetrics[]>(`/key-metrics?symbol=${ticker}&period=annual&limit=4`),
    fetchFMP<FMPRatios[]>(`/ratios?symbol=${ticker}&period=annual&limit=4`),
  ]);

  const profile = profileArr?.[0];
  if (!profile) {
    // Try to fall back to DB data
    const sql = getDb();
    if (sql) {
      const rows = await sql`
        SELECT symbol, company_name, sector, industry, market_cap, price,
               price_to_earnings_ratio, price_to_book_ratio, return_on_equity,
               net_profit_margin, revenue_growth_yoy, dividend_yield, debt_to_equity_ratio,
               beta, ev_to_sales, ev_to_ebitda
        FROM stocks WHERE symbol = ${ticker}
      `;
      if (rows.length > 0) {
        const row = rows[0];
        return NextResponse.json({
          ticker,
          companyName: row.company_name || ticker,
          isAuthenticated,
          source: "database",
          fundamentals: {
            price: row.price ? Number(row.price) : null,
            marketCap: row.market_cap ? Number(row.market_cap) : null,
            sector: row.sector || null,
            industry: row.industry || null,
            peRatio: row.price_to_earnings_ratio ? Number(row.price_to_earnings_ratio) : null,
            pbRatio: row.price_to_book_ratio ? Number(row.price_to_book_ratio) : null,
            roe: row.return_on_equity ? Number(row.return_on_equity) : null,
            netMargin: row.net_profit_margin ? Number(row.net_profit_margin) : null,
            revenueGrowth: row.revenue_growth_yoy ? Number(row.revenue_growth_yoy) : null,
            dividendYield: row.dividend_yield ? Number(row.dividend_yield) : null,
            debtToEquity: row.debt_to_equity_ratio ? Number(row.debt_to_equity_ratio) : null,
            beta: row.beta ? Number(row.beta) : null,
            evToSales: row.ev_to_sales ? Number(row.ev_to_sales) : null,
            evToEbitda: row.ev_to_ebitda ? Number(row.ev_to_ebitda) : null,
          },
          report: null,
          error: "FMP API unavailable. Showing database metrics only.",
        });
      }
    }
    return NextResponse.json({ error: `No data found for ticker: ${ticker}` }, { status: 404 });
  }

  const income = incomeArr || [];
  const ratios = ratiosArr || [];
  const metrics = metricsArr || [];
  const latestMetrics = metrics[0] || null;
  const latestRatios = ratios[0] || null;
  const latestIncome = income[0] || null;
  const prevIncome = income[1] || null;
  const mktCap = profile.marketCap ?? profile.mktCap ?? latestMetrics?.marketCap ?? null;

  const revenueGrowth =
    latestIncome && prevIncome && prevIncome.revenue > 0
      ? ((latestIncome.revenue - prevIncome.revenue) / prevIncome.revenue)
      : null;

  // Helper: null-safe pick (preserves 0 values, only nullifies undefined/null)
  const nn = (v: number | undefined | null): number | null =>
    v != null ? v : null;

  // Supplement FMP live data with DB data for any missing fields
  let dbRow: Record<string, unknown> | null = null;
  const sql = getDb();
  if (sql) {
    try {
      const rows = await sql`
        SELECT market_cap, price, beta,
               price_to_earnings_ratio, price_to_book_ratio, return_on_equity,
               return_on_invested_capital, net_profit_margin, revenue_growth_yoy,
               earnings_growth, dividend_yield, debt_to_equity_ratio, current_ratio,
               ev_to_sales, ev_to_ebitda, free_cash_flow_per_share, enterprise_value,
               earnings_yield, profit_margin, free_cash_flow_yield,
               consecutive_earnings_growth, revenue_growth_positive_3yr_count
        FROM stocks WHERE symbol = ${ticker}
      `;
      dbRow = rows.length > 0 ? (rows[0] as Record<string, unknown>) : null;
    } catch { /* DB not available */ }
  }

  const dbNum = (col: string): number | null => {
    if (!dbRow || dbRow[col] == null) return null;
    return Number(dbRow[col]);
  };

  // Build fundamentals — FMP first, DB fallback for missing fields
  const fundamentals = {
    price: nn(profile.price) ?? dbNum("price"),
    marketCap: mktCap ?? dbNum("market_cap"),
    sector: profile.sector,
    industry: profile.industry,
    beta: nn(profile.beta) ?? dbNum("beta"),
    ipoDate: profile.ipoDate,
    exchange: profile.exchange,
    revenue: nn(latestIncome?.revenue),
    revenueGrowth: revenueGrowth ?? dbNum("revenue_growth_yoy"),
    grossMargin: nn(latestIncome?.grossProfitRatio),
    operatingMargin: nn(latestIncome?.operatingIncomeRatio),
    netMargin: nn(latestIncome?.netIncomeRatio) ?? nn(latestRatios?.netProfitMargin) ?? dbNum("net_profit_margin"),
    eps: nn(latestIncome?.epsDiluted),
    ebitda: nn(latestIncome?.ebitda),
    netIncome: nn(latestIncome?.netIncome),
    peRatio: nn(latestRatios?.priceToEarningsRatio) ?? dbNum("price_to_earnings_ratio"),
    pbRatio: nn(latestRatios?.priceToBookRatio) ?? dbNum("price_to_book_ratio"),
    evToSales: nn(latestMetrics?.evToSales) ?? dbNum("ev_to_sales"),
    evToEbitda: nn(latestMetrics?.evToEBITDA) ?? dbNum("ev_to_ebitda"),
    roe: nn(latestMetrics?.returnOnEquity) ?? dbNum("return_on_equity"),
    roic: nn(latestMetrics?.returnOnInvestedCapital) ?? dbNum("return_on_invested_capital"),
    debtToEquity: nn(latestRatios?.debtToEquityRatio) ?? dbNum("debt_to_equity_ratio"),
    currentRatio: nn(latestRatios?.currentRatio) ?? nn(latestMetrics?.currentRatio) ?? dbNum("current_ratio"),
    dividendYield: nn(latestRatios?.dividendYield) ?? dbNum("dividend_yield"),
    fcfPerShare: nn(latestRatios?.freeCashFlowPerShare) ?? dbNum("free_cash_flow_per_share"),
    enterpriseValue: nn(latestMetrics?.enterpriseValue) ?? dbNum("enterprise_value"),
    // Extra fields from DB for research page
    earningsYield: dbNum("earnings_yield"),
    earningsGrowth: dbNum("earnings_growth"),
    profitMargin: nn(latestIncome?.netIncomeRatio) ?? dbNum("profit_margin"),
    fcfYield: dbNum("free_cash_flow_yield"),
    consecutiveEarningsGrowth: dbNum("consecutive_earnings_growth"),
  };

  // Revenue + earnings trend for charts
  const revenueTrend = income.map((stmt) => ({
    date: stmt.date,
    revenue: stmt.revenue,
    netIncome: stmt.netIncome,
    grossProfit: stmt.grossProfit,
    netMargin: stmt.netIncomeRatio,
    eps: stmt.epsDiluted,
  })).reverse();

  // Historical prices for chart (from DB)
  let priceHistory: { date: string; price: number }[] = [];
  if (sql) {
    try {
      const priceRows = await sql`
        SELECT date, close_price FROM stock_prices
        WHERE symbol = ${ticker}
        ORDER BY date ASC
      `;
      priceHistory = priceRows.map((r) => ({
        date: String(r.date),
        price: Number(r.close_price),
      }));
    } catch {
      // DB not available, skip price history
    }
  }

  // Generate AI report only for authenticated users
  let report: ResearchReport | null = null;

  if (isAuthenticated) {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) {
      try {
        const openai = new OpenAI({ apiKey: openaiKey });
        const context = buildFinancialContext(profile, income, metrics, ratios);

        const response = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          max_tokens: 1500,
          messages: [
            {
              role: "system",
              content: `You are a senior equity research analyst at a top investment bank. Write a structured research report based on the financial data provided.

You MUST respond with valid JSON matching this exact structure:
{
  "executiveSummary": "2-3 sentence overview of the company and investment thesis",
  "bullCase": { "targetPrice": <number>, "probability": <number 0-100>, "rationale": "2-3 sentences" },
  "baseCase": { "targetPrice": <number>, "probability": <number 0-100>, "rationale": "2-3 sentences" },
  "bearCase": { "targetPrice": <number>, "probability": <number 0-100>, "rationale": "2-3 sentences" },
  "riskFactors": ["risk1", "risk2", "risk3", "risk4"],
  "recommendation": "STRONG_BUY" | "BUY" | "HOLD" | "SELL" | "STRONG_SELL",
  "recommendationRationale": "1-2 sentence justification"
}

Rules:
- All price targets must be reasonable given the current price and fundamentals
- Probabilities across bull/base/bear must sum to 100
- Be specific about financial metrics in your rationale
- Risk factors should be concise (1 sentence each)
- Base recommendation on the probability-weighted expected return vs current price
- Use STRONG_BUY for >20% expected upside, BUY for 10-20%, HOLD for -10% to 10%, SELL for -10% to -20%, STRONG_SELL for >20% downside
- CRITICAL: The probability-weighted target must be CONSISTENT with the recommendation. If recommending SELL or STRONG_SELL, the weighted average target MUST be below the current price. If recommending BUY or STRONG_BUY, it MUST be above.
- Do NOT include any text outside the JSON object`,
            },
            {
              role: "user",
              content: `Generate a research report for this stock:\n\n${context}`,
            },
          ],
        });

        const content = response.choices[0]?.message?.content;
        if (content) {
          const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
          report = JSON.parse(cleaned) as ResearchReport;
        }
      } catch (e) {
        console.error("Research AI generation failed:", e);
      }
    }
  }

  return NextResponse.json({
    ticker: profile.symbol,
    companyName: profile.companyName,
    description: profile.description,
    image: profile.image,
    isAuthenticated,
    source: "fmp",
    fundamentals,
    revenueTrend,
    priceHistory,
    report,
  });
}

interface ResearchReport {
  executiveSummary: string;
  bullCase: { targetPrice: number; probability: number; rationale: string };
  baseCase: { targetPrice: number; probability: number; rationale: string };
  bearCase: { targetPrice: number; probability: number; rationale: string };
  riskFactors: string[];
  recommendation: "STRONG_BUY" | "BUY" | "HOLD" | "SELL" | "STRONG_SELL";
  recommendationRationale: string;
}
