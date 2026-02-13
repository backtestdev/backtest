/**
 * Admin endpoint to refresh the stock database using FMP API calls.
 *
 * POST /api/admin/refresh-data — Protected by x-admin-secret header.
 *
 * Strategy (starter-plan compatible):
 *   1. Create stocks_new table
 *   2. Fetch stock screener (1 API call) → INSERT into stocks_new
 *   3. Enrich top stocks by market cap using per-stock
 *      /ratios + /key-metrics + /income-statement (3 API calls per stock)
 *   4. Swap: stocks → stocks_old, stocks_new → stocks
 *   5. Log verification counts
 *
 * Rate limiting: slot-based queue ensures exactly 4 req/sec (240 req/min),
 * safely under the 300 req/min starter plan limit even with concurrency.
 *
 * Use POST /api/admin/refresh-stocks for ongoing cron enrichment of
 * remaining stocks (rotating batches of 120).
 */

import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { createStocksNewTable } from "@/lib/db";
import { refreshStockUniverse } from "@/lib/fmpService";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 minutes

const FMP_API_KEY =
  process.env.FINANCIAL_MODELING_PREP_API_KEY ||
  process.env.FMP_API_KEY ||
  "";
const FMP_BASE = "https://financialmodelingprep.com/stable";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Slot-based rate limiter ─────────────────────────────────────────
// Each call atomically claims a time slot. Even with concurrent calls,
// JS single-threading ensures each gets a unique slot spaced 250ms apart.
// This guarantees ≤240 req/min regardless of concurrency.
let nextSlot = 0;

async function fetchFMP<T>(endpoint: string, retries = 2): Promise<T | null> {
  const now = Date.now();
  const mySlot = Math.max(now, nextSlot);
  nextSlot = mySlot + 250; // 240 req/min
  const waitMs = mySlot - now;
  if (waitMs > 0) await sleep(waitMs);

  const sep = endpoint.includes("?") ? "&" : "?";
  const url = `${FMP_BASE}${endpoint}${sep}apikey=${FMP_API_KEY}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (res.status === 429 && retries > 0) {
      console.warn(`[refresh-data] 429 on ${endpoint}, backing off 10s...`);
      nextSlot = Date.now() + 10000; // pause all requests for 10s
      await sleep(10000);
      return fetchFMP<T>(endpoint, retries - 1);
    }
    if (!res.ok) {
      console.error(`[refresh-data] FMP ${res.status} for ${endpoint}`);
      return null;
    }
    const data = await res.json();
    if (data && typeof data === "object" && !Array.isArray(data) && "Error Message" in data) {
      console.error(`[refresh-data] FMP error:`, (data as Record<string, string>)["Error Message"]);
      return null;
    }
    return data as T;
  } catch (err) {
    console.error(`[refresh-data] fetch failed for ${endpoint}:`, err);
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

interface KeyMetrics {
  marketCap?: number;
  enterpriseValue?: number;
  evToSales?: number;
  evToOperatingCashFlow?: number;
  evToFreeCashFlow?: number;
  evToEBITDA?: number;
  netDebtToEBITDA?: number;
  currentRatio?: number;
  incomeQuality?: number;
  grahamNumber?: number;
  workingCapital?: number;
  investedCapital?: number;
  returnOnAssets?: number;
  returnOnEquity?: number;
  returnOnInvestedCapital?: number;
  returnOnCapitalEmployed?: number;
  earningsYield?: number;
  freeCashFlowYield?: number;
  capexToRevenue?: number;
  researchAndDevelopementToRevenue?: number;
  stockBasedCompensationToRevenue?: number;
  tangibleAssetValue?: number;
}

interface FinancialRatios {
  grossProfitMargin?: number;
  ebitMargin?: number;
  ebitdaMargin?: number;
  operatingProfitMargin?: number;
  pretaxProfitMargin?: number;
  netProfitMargin?: number;
  effectiveTaxRate?: number;
  priceToEarningsRatio?: number;
  priceToBookRatio?: number;
  priceToSalesRatio?: number;
  priceToFreeCashFlowRatio?: number;
  priceToOperatingCashFlowRatio?: number;
  debtToEquityRatio?: number;
  debtToAssetsRatio?: number;
  debtToCapitalRatio?: number;
  financialLeverageRatio?: number;
  interestCoverageRatio?: number;
  currentRatio?: number;
  quickRatio?: number;
  cashRatio?: number;
  dividendYield?: number;
  dividendYieldPercentage?: number;
  dividendPayoutRatio?: number;
  revenuePerShare?: number;
  netIncomePerShare?: number;
  bookValuePerShare?: number;
  tangibleBookValuePerShare?: number;
  operatingCashFlowPerShare?: number;
  freeCashFlowPerShare?: number;
  cashPerShare?: number;
  assetTurnover?: number;
  inventoryTurnover?: number;
  receivablesTurnover?: number;
  operatingCashFlowSalesRatio?: number;
  freeCashFlowOperatingCashFlowRatio?: number;
  priceToFairValue?: number;
  debtToMarketCap?: number;
  enterpriseValueMultiple?: number;
  priceToEarningsGrowthRatio?: number;
  daysOfSalesOutstanding?: number;
  daysOfInventoryOutstanding?: number;
  daysOfPayablesOutstanding?: number;
  cashConversionCycle?: number;
}

interface IncomeStatementEntry {
  date: string;
  revenue: number;
  netIncome: number;
  eps: number;
  epsDiluted: number;
}

interface Quote {
  symbol: string;
  price: number;
  yearHigh: number;
  yearLow: number;
  marketCap: number;
  volume: number;
  avgVolume: number;
}

// Name patterns that indicate funds, trusts, SPACs, etc.
const EXCLUDE_NAME_PATTERNS = /\b(ETF|ETN|Exchange.Traded|Index Fund|Mutual Fund|Bond Fund|Income Fund|Money Market|Closed.End|Acquisition Corp|Blank Check|SPAC|Special Purpose|Statutory Trust|Capital Trust|Investment Trust|Depositary Shares?|Depositary Receipt|Preferred Shares?|Preferred Stock|Preferred Securities|Fixed.Income|Senior Notes?|Subordinated|Debentures?)\b|\bTrust [IVX]+\b|\d+\.?\d*% |\bRights$|\bWarrants?$|\bUnits?$|\bL\.?P\.?$|Notes Due/i;

function isAssetManagementFund(s: ScreenerResult): boolean {
  return (
    s.symbol.length === 5 &&
    s.symbol.endsWith("X") &&
    (s.sector === "Asset Management" || s.industry === "Asset Management")
  );
}

// ── Helpers ─────────────────────────────────────────────────────────

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

interface GrowthData {
  revenueHistory: string | null;
  netIncomeHistory: string | null;
  epsHistory: string | null;
  consecutiveRevenueGrowthYears: number;
  consecutiveNetIncomeGrowthYears: number;
  consecutiveEpsGrowthYears: number;
  revenueGrowth3yrAvg: number | null;
  netIncomeGrowth3yrAvg: number | null;
  revenueGrowthYoy: number | null;
  earningsGrowthYoy: number | null;
  epsGrowthYoy: number | null;
}

function computeGrowthData(entries: IncomeStatementEntry[] | null): GrowthData | null {
  if (!entries || entries.length < 2) return null;

  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date));

  const revHist: Record<string, number> = {};
  const niHist: Record<string, number> = {};
  const epsHist: Record<string, number> = {};

  for (const e of sorted) {
    const year = e.date.substring(0, 4);
    if (e.revenue != null) revHist[year] = e.revenue;
    if (e.netIncome != null) niHist[year] = e.netIncome;
    const epsVal = e.epsDiluted ?? e.eps;
    if (epsVal != null) epsHist[year] = epsVal;
  }

  let consRevGrowth = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i].revenue > sorted[i + 1].revenue && sorted[i + 1].revenue > 0) consRevGrowth++;
    else break;
  }

  let consNiGrowth = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i].netIncome > sorted[i + 1].netIncome && sorted[i + 1].netIncome > 0) consNiGrowth++;
    else break;
  }

  let consEpsGrowth = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const curr = sorted[i].epsDiluted ?? sorted[i].eps;
    const prev = sorted[i + 1].epsDiluted ?? sorted[i + 1].eps;
    if (curr != null && prev != null && curr > prev && prev > 0) consEpsGrowth++;
    else break;
  }

  function avgGrowth(getter: (e: IncomeStatementEntry) => number | null): number | null {
    const rates: number[] = [];
    for (let i = 0; i < Math.min(3, sorted.length - 1); i++) {
      const curr = getter(sorted[i]);
      const prev = getter(sorted[i + 1]);
      if (curr != null && prev != null && prev !== 0) {
        rates.push((curr - prev) / Math.abs(prev));
      }
    }
    return rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : null;
  }

  // YoY growth: most recent year vs prior year
  function yoyGrowth(curr: number | null, prev: number | null): number | null {
    if (curr == null || prev == null || prev === 0) return null;
    return (curr - prev) / Math.abs(prev);
  }

  const revYoy = sorted.length >= 2 ? yoyGrowth(sorted[0].revenue, sorted[1].revenue) : null;
  const niYoy = sorted.length >= 2 ? yoyGrowth(sorted[0].netIncome, sorted[1].netIncome) : null;
  const epsYoy = sorted.length >= 2
    ? yoyGrowth(sorted[0].epsDiluted ?? sorted[0].eps, sorted[1].epsDiluted ?? sorted[1].eps)
    : null;

  return {
    revenueHistory: Object.keys(revHist).length > 0 ? JSON.stringify(revHist) : null,
    netIncomeHistory: Object.keys(niHist).length > 0 ? JSON.stringify(niHist) : null,
    epsHistory: Object.keys(epsHist).length > 0 ? JSON.stringify(epsHist) : null,
    consecutiveRevenueGrowthYears: consRevGrowth,
    consecutiveNetIncomeGrowthYears: consNiGrowth,
    consecutiveEpsGrowthYears: consEpsGrowth,
    revenueGrowth3yrAvg: avgGrowth(e => toNum(e.revenue)),
    netIncomeGrowth3yrAvg: avgGrowth(e => toNum(e.netIncome)),
    revenueGrowthYoy: revYoy,
    earningsGrowthYoy: niYoy,
    epsGrowthYoy: epsYoy,
  };
}

// ── Main refresh logic ─────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const adminSecret = process.env.ADMIN_SECRET;
  const adminHeader = request.headers.get("x-admin-secret");
  const isAdmin = adminSecret ? adminHeader === adminSecret : true;

  if (!isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!FMP_API_KEY) {
    return NextResponse.json({ error: "FMP API key not configured" }, { status: 400 });
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 400 });
  }

  const sql = neon(databaseUrl);
  const log: string[] = [];
  // Reset rate limiter for this request
  nextSlot = 0;

  try {
    // ── Step 0: Clean up stale tables from previous failed runs ──
    await sql`DROP TABLE IF EXISTS stocks_old CASCADE`;
    log.push("Cleaned up stale tables");

    // ── Step 1: Create stocks_new table ──────────────────────────
    log.push("Creating stocks_new table...");
    await createStocksNewTable(sql);

    // ── Step 2: Fetch stock screener ─────────────────────────────
    log.push("Fetching stock screener...");
    const screenerResults = await fetchFMP<ScreenerResult[]>(
      "/company-screener?marketCapMoreThan=300000000&isEtf=false&isFund=false&isActivelyTrading=true&exchange=NYSE,NASDAQ&limit=5000"
    );

    if (!screenerResults || screenerResults.length === 0) {
      throw new Error("FMP screener returned no results — check API key and plan");
    }

    const filtered = screenerResults.filter(
      (s) =>
        s.marketCap > 0 &&
        !s.symbol.includes(".") &&
        s.symbol.length <= 5 &&
        !s.isEtf &&
        !s.isFund &&
        s.sector &&
        s.sector.trim() !== "" &&
        !EXCLUDE_NAME_PATTERNS.test(s.companyName) &&
        !isAssetManagementFund(s)
    );
    log.push(`Screener: ${screenerResults.length} total → ${filtered.length} filtered companies`);

    // Insert all into stocks_new
    let insertedCount = 0;
    for (const s of filtered) {
      await sql`
        INSERT INTO stocks_new (symbol, company_name, market_cap, sector, industry, price, beta, volume, exchange, country, is_etf, is_fund, is_actively_trading, last_dividend, updated_at)
        VALUES (${s.symbol}, ${s.companyName}, ${s.marketCap}, ${s.sector}, ${s.industry}, ${s.price || null}, ${s.beta || null}, ${s.volume || null}, ${s.exchange}, ${s.country || 'US'}, ${s.isEtf || false}, ${s.isFund || false}, ${s.isActivelyTrading}, ${s.lastAnnualDividend || null}, NOW())
        ON CONFLICT (symbol) DO UPDATE SET
          company_name = EXCLUDED.company_name, market_cap = EXCLUDED.market_cap,
          sector = EXCLUDED.sector, industry = EXCLUDED.industry, price = EXCLUDED.price,
          beta = EXCLUDED.beta, volume = EXCLUDED.volume, exchange = EXCLUDED.exchange,
          country = EXCLUDED.country, is_etf = EXCLUDED.is_etf, is_fund = EXCLUDED.is_fund,
          is_actively_trading = EXCLUDED.is_actively_trading, last_dividend = EXCLUDED.last_dividend,
          updated_at = NOW()
      `;
      insertedCount++;
    }
    log.push(`Inserted/updated ${insertedCount} stocks into stocks_new`);

    // ── Step 3: Per-stock enrichment ─────────────────────────────
    log.push("Starting per-stock enrichment (ratios + key-metrics + income-statement)...");

    const symbolRows = await sql`SELECT symbol FROM stocks_new ORDER BY market_cap DESC NULLS LAST`;
    const allSymbols = symbolRows.map((r) => r.symbol as string);

    const CONCURRENCY = 2;
    const TIME_BUDGET_MS = 240_000; // 4 minutes
    const enrichStart = Date.now();
    let enriched = 0;
    let enrichFailed = 0;
    let noDataCount = 0;

    for (let i = 0; i < allSymbols.length; i += CONCURRENCY) {
      if (Date.now() - enrichStart > TIME_BUDGET_MS) {
        log.push(`Time budget reached after enriching ${enriched}/${allSymbols.length} stocks`);
        break;
      }

      const batch = allSymbols.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (sym) => {
          const [ratiosData, metricsData, incomeData, quoteData] = await Promise.all([
            fetchFMP<FinancialRatios[]>(`/ratios?symbol=${sym}&period=annual&limit=1`),
            fetchFMP<KeyMetrics[]>(`/key-metrics?symbol=${sym}&period=annual&limit=1`),
            fetchFMP<IncomeStatementEntry[]>(`/income-statement?symbol=${sym}&period=annual&limit=5`),
            fetchFMP<Quote[]>(`/quote?symbol=${sym}`),
          ]);

          const finRatios = ratiosData?.[0] ?? null;
          const metrics = metricsData?.[0] ?? null;
          const growth = computeGrowthData(incomeData);
          const quote = quoteData?.[0] ?? null;

          if (!finRatios && !metrics && !growth && !quote) {
            noDataCount++;
            return;
          }

          await sql`
            UPDATE stocks_new SET
              year_high = COALESCE(${toNum(quote?.yearHigh)}, year_high),
              year_low = COALESCE(${toNum(quote?.yearLow)}, year_low),
              avg_volume = COALESCE(${toNum(quote?.avgVolume)}, avg_volume),
              price_to_earnings_ratio = COALESCE(${toNum(finRatios?.priceToEarningsRatio)}, price_to_earnings_ratio),
              price_to_earnings_growth_ratio = COALESCE(${toNum(finRatios?.priceToEarningsGrowthRatio)}, price_to_earnings_growth_ratio),
              price_to_book_ratio = COALESCE(${toNum(finRatios?.priceToBookRatio)}, price_to_book_ratio),
              price_to_sales_ratio = COALESCE(${toNum(finRatios?.priceToSalesRatio)}, price_to_sales_ratio),
              price_to_free_cash_flow_ratio = COALESCE(${toNum(finRatios?.priceToFreeCashFlowRatio)}, price_to_free_cash_flow_ratio),
              price_to_operating_cash_flow_ratio = COALESCE(${toNum(finRatios?.priceToOperatingCashFlowRatio)}, price_to_operating_cash_flow_ratio),
              price_to_fair_value = COALESCE(${toNum(finRatios?.priceToFairValue)}, price_to_fair_value),
              enterprise_value_multiple = COALESCE(${toNum(finRatios?.enterpriseValueMultiple)}, enterprise_value_multiple),
              gross_profit_margin = COALESCE(${toNum(finRatios?.grossProfitMargin)}, gross_profit_margin),
              ebit_margin = COALESCE(${toNum(finRatios?.ebitMargin)}, ebit_margin),
              ebitda_margin = COALESCE(${toNum(finRatios?.ebitdaMargin)}, ebitda_margin),
              operating_profit_margin = COALESCE(${toNum(finRatios?.operatingProfitMargin)}, operating_profit_margin),
              pretax_profit_margin = COALESCE(${toNum(finRatios?.pretaxProfitMargin)}, pretax_profit_margin),
              net_profit_margin = COALESCE(${toNum(finRatios?.netProfitMargin)}, net_profit_margin),
              effective_tax_rate = COALESCE(${toNum(finRatios?.effectiveTaxRate)}, effective_tax_rate),
              return_on_assets = COALESCE(${toNum(metrics?.returnOnAssets)}, return_on_assets),
              return_on_equity = COALESCE(${toNum(metrics?.returnOnEquity)}, return_on_equity),
              return_on_invested_capital = COALESCE(${toNum(metrics?.returnOnInvestedCapital)}, return_on_invested_capital),
              return_on_capital_employed = COALESCE(${toNum(metrics?.returnOnCapitalEmployed)}, return_on_capital_employed),
              earnings_yield = COALESCE(${toNum(metrics?.earningsYield)}, earnings_yield),
              free_cash_flow_yield = COALESCE(${toNum(metrics?.freeCashFlowYield)}, free_cash_flow_yield),
              current_ratio = COALESCE(${toNum(metrics?.currentRatio ?? finRatios?.currentRatio)}, current_ratio),
              quick_ratio = COALESCE(${toNum(finRatios?.quickRatio)}, quick_ratio),
              cash_ratio = COALESCE(${toNum(finRatios?.cashRatio)}, cash_ratio),
              debt_to_equity_ratio = COALESCE(${toNum(finRatios?.debtToEquityRatio)}, debt_to_equity_ratio),
              debt_to_assets_ratio = COALESCE(${toNum(finRatios?.debtToAssetsRatio)}, debt_to_assets_ratio),
              debt_to_capital_ratio = COALESCE(${toNum(finRatios?.debtToCapitalRatio)}, debt_to_capital_ratio),
              financial_leverage_ratio = COALESCE(${toNum(finRatios?.financialLeverageRatio)}, financial_leverage_ratio),
              debt_to_market_cap = COALESCE(${toNum(finRatios?.debtToMarketCap)}, debt_to_market_cap),
              interest_coverage_ratio = COALESCE(${toNum(finRatios?.interestCoverageRatio)}, interest_coverage_ratio),
              dividend_yield = COALESCE(${toNum(finRatios?.dividendYield)}, dividend_yield),
              dividend_yield_percentage = COALESCE(${toNum(finRatios?.dividendYieldPercentage)}, dividend_yield_percentage),
              dividend_payout_ratio = COALESCE(${toNum(finRatios?.dividendPayoutRatio)}, dividend_payout_ratio),
              revenue_per_share = COALESCE(${toNum(finRatios?.revenuePerShare)}, revenue_per_share),
              net_income_per_share = COALESCE(${toNum(finRatios?.netIncomePerShare)}, net_income_per_share),
              book_value_per_share = COALESCE(${toNum(finRatios?.bookValuePerShare)}, book_value_per_share),
              tangible_book_value_per_share = COALESCE(${toNum(finRatios?.tangibleBookValuePerShare)}, tangible_book_value_per_share),
              operating_cash_flow_per_share = COALESCE(${toNum(finRatios?.operatingCashFlowPerShare)}, operating_cash_flow_per_share),
              free_cash_flow_per_share = COALESCE(${toNum(finRatios?.freeCashFlowPerShare)}, free_cash_flow_per_share),
              cash_per_share = COALESCE(${toNum(finRatios?.cashPerShare)}, cash_per_share),
              asset_turnover = COALESCE(${toNum(finRatios?.assetTurnover)}, asset_turnover),
              inventory_turnover = COALESCE(${toNum(finRatios?.inventoryTurnover)}, inventory_turnover),
              receivables_turnover = COALESCE(${toNum(finRatios?.receivablesTurnover)}, receivables_turnover),
              days_of_sales_outstanding = COALESCE(${toNum(finRatios?.daysOfSalesOutstanding)}, days_of_sales_outstanding),
              days_of_inventory_outstanding = COALESCE(${toNum(finRatios?.daysOfInventoryOutstanding)}, days_of_inventory_outstanding),
              days_of_payables_outstanding = COALESCE(${toNum(finRatios?.daysOfPayablesOutstanding)}, days_of_payables_outstanding),
              cash_conversion_cycle = COALESCE(${toNum(finRatios?.cashConversionCycle)}, cash_conversion_cycle),
              enterprise_value = COALESCE(${toNum(metrics?.enterpriseValue)}, enterprise_value),
              ev_to_sales = COALESCE(${toNum(metrics?.evToSales)}, ev_to_sales),
              ev_to_ebitda = COALESCE(${toNum(metrics?.evToEBITDA)}, ev_to_ebitda),
              ev_to_operating_cash_flow = COALESCE(${toNum(metrics?.evToOperatingCashFlow)}, ev_to_operating_cash_flow),
              ev_to_free_cash_flow = COALESCE(${toNum(metrics?.evToFreeCashFlow)}, ev_to_free_cash_flow),
              net_debt_to_ebitda = COALESCE(${toNum(metrics?.netDebtToEBITDA)}, net_debt_to_ebitda),
              capex_to_revenue = COALESCE(${toNum(metrics?.capexToRevenue)}, capex_to_revenue),
              operating_cash_flow_sales_ratio = COALESCE(${toNum(finRatios?.operatingCashFlowSalesRatio)}, operating_cash_flow_sales_ratio),
              free_cash_flow_operating_cash_flow_ratio = COALESCE(${toNum(finRatios?.freeCashFlowOperatingCashFlowRatio)}, free_cash_flow_operating_cash_flow_ratio),
              income_quality = COALESCE(${toNum(metrics?.incomeQuality)}, income_quality),
              graham_number = COALESCE(${toNum(metrics?.grahamNumber)}, graham_number),
              working_capital = COALESCE(${toNum(metrics?.workingCapital)}, working_capital),
              invested_capital = COALESCE(${toNum(metrics?.investedCapital)}, invested_capital),
              tangible_asset_value = COALESCE(${toNum(metrics?.tangibleAssetValue)}, tangible_asset_value),
              research_and_development_to_revenue = COALESCE(${toNum(metrics?.researchAndDevelopementToRevenue)}, research_and_development_to_revenue),
              stock_based_compensation_to_revenue = COALESCE(${toNum(metrics?.stockBasedCompensationToRevenue)}, stock_based_compensation_to_revenue),
              revenue_history = COALESCE(${growth?.revenueHistory ?? null}::jsonb, revenue_history),
              net_income_history = COALESCE(${growth?.netIncomeHistory ?? null}::jsonb, net_income_history),
              eps_history = COALESCE(${growth?.epsHistory ?? null}::jsonb, eps_history),
              consecutive_revenue_growth_years = COALESCE(${growth?.consecutiveRevenueGrowthYears ?? null}, consecutive_revenue_growth_years),
              consecutive_net_income_growth_years = COALESCE(${growth?.consecutiveNetIncomeGrowthYears ?? null}, consecutive_net_income_growth_years),
              consecutive_eps_growth_years = COALESCE(${growth?.consecutiveEpsGrowthYears ?? null}, consecutive_eps_growth_years),
              revenue_growth_3yr_avg = COALESCE(${growth?.revenueGrowth3yrAvg ?? null}, revenue_growth_3yr_avg),
              net_income_growth_3yr_avg = COALESCE(${growth?.netIncomeGrowth3yrAvg ?? null}, net_income_growth_3yr_avg),
              revenue_growth_yoy = COALESCE(${growth?.revenueGrowthYoy ?? null}, revenue_growth_yoy),
              earnings_growth_yoy = COALESCE(${growth?.earningsGrowthYoy ?? null}, earnings_growth_yoy),
              eps_growth_yoy = COALESCE(${growth?.epsGrowthYoy ?? null}, eps_growth_yoy),
              updated_at = NOW()
            WHERE symbol = ${sym}
          `;
        })
      );

      for (const r of results) {
        if (r.status === "fulfilled") enriched++;
        else enrichFailed++;
      }

      // Log progress every ~50 stocks
      if ((i + CONCURRENCY) % 50 < CONCURRENCY) {
        const elapsed = Math.round((Date.now() - enrichStart) / 1000);
        log.push(`  ...enriched ${enriched}/${allSymbols.length} (${elapsed}s elapsed, ${noDataCount} no data)`);
      }
    }

    log.push(
      `Per-stock enrichment: ${enriched} enriched, ${enrichFailed} failed, ${noDataCount} no data, ${allSymbols.length - enriched - enrichFailed} skipped (timeout)`
    );

    // ── Step 4: Swap tables ───────────────────────────────────────
    log.push("Swapping tables...");
    await sql`DROP TABLE IF EXISTS stocks_old CASCADE`;

    const oldTableExists = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables WHERE table_name = 'stocks' AND table_schema = 'public'
      ) as exists
    `;

    if (oldTableExists[0]?.exists) {
      await sql`ALTER TABLE stocks RENAME TO stocks_old`;
      log.push("Renamed stocks → stocks_old");
    }

    await sql`ALTER TABLE stocks_new RENAME TO stocks`;
    log.push("Renamed stocks_new → stocks");

    await sql`CREATE INDEX IF NOT EXISTS idx_stocks_symbol ON stocks(symbol)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_stocks_sector ON stocks(sector)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_stocks_industry ON stocks(industry)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_stocks_market_cap ON stocks(market_cap)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_stocks_pe ON stocks(price_to_earnings_ratio)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_stocks_pb ON stocks(price_to_book_ratio)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_stocks_div_yield ON stocks(dividend_yield)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_stocks_roe ON stocks(return_on_equity)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_stocks_price ON stocks(price)`;
    log.push("Recreated indexes");

    // Drop stocks_old now that swap succeeded
    await sql`DROP TABLE IF EXISTS stocks_old CASCADE`;

    // ── Verification ─────────────────────────────────────────────
    const totalCount = await sql`SELECT COUNT(*) as cnt FROM stocks`;
    const peCount = await sql`SELECT COUNT(*) as cnt FROM stocks WHERE price_to_earnings_ratio IS NOT NULL`;
    const roeCount = await sql`SELECT COUNT(*) as cnt FROM stocks WHERE return_on_equity IS NOT NULL`;
    const divCount = await sql`SELECT COUNT(*) as cnt FROM stocks WHERE dividend_yield IS NOT NULL`;
    const histCount = await sql`SELECT COUNT(*) as cnt FROM stocks WHERE revenue_history IS NOT NULL`;

    const verification = {
      total: Number(totalCount[0]?.cnt || 0),
      has_pe: Number(peCount[0]?.cnt || 0),
      has_roe: Number(roeCount[0]?.cnt || 0),
      has_div_yield: Number(divCount[0]?.cnt || 0),
      has_revenue_history: Number(histCount[0]?.cnt || 0),
    };
    log.push(`Verification: ${JSON.stringify(verification)}`);

    const aapl = await sql`
      SELECT symbol, price_to_earnings_ratio, price_to_book_ratio, return_on_equity,
             dividend_yield, market_cap, sector, consecutive_revenue_growth_years
      FROM stocks WHERE symbol = 'AAPL'
    `;
    if (aapl.length > 0) {
      log.push(`AAPL check: PE=${aapl[0].price_to_earnings_ratio}, PB=${aapl[0].price_to_book_ratio}, ROE=${aapl[0].return_on_equity}, sector=${aapl[0].sector}, rev_growth_yrs=${aapl[0].consecutive_revenue_growth_years}`);
    } else {
      log.push("WARNING: AAPL not found in stocks table");
    }

    // Update stock_meta timestamp
    await sql`
      CREATE TABLE IF NOT EXISTS stock_meta (
        key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    const timestamp = new Date().toISOString();
    await sql`
      INSERT INTO stock_meta (key, value, updated_at) VALUES ('last_refresh', ${timestamp}, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `;

    await refreshStockUniverse();

    return NextResponse.json({
      success: true,
      verification,
      enrichment: { enriched, failed: enrichFailed, noData: noDataCount, skipped: allSymbols.length - enriched - enrichFailed, total: allSymbols.length },
      aapl: aapl[0] || null,
      log,
    });
  } catch (error) {
    console.error("Refresh-data error:", error);
    try { await sql`DROP TABLE IF EXISTS stocks_new`; } catch { /* ignore */ }
    return NextResponse.json({ error: "Refresh failed", details: String(error), log }, { status: 500 });
  }
}
