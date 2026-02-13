/**
 * Admin endpoint to refresh the stock database from FMP API.
 *
 * GET  /api/admin/refresh-stocks — Vercel Cron handler (rotates batches)
 * POST /api/admin/refresh-stocks — Manual trigger (enriches next batch)
 *
 * Per-stock enrichment uses 3 FMP API calls per stock:
 *   /ratios + /key-metrics + /income-statement (annual)
 * These are called in parallel per stock with slot-based rate limiting.
 *
 * This endpoint works with the unified single `stocks` table.
 * All metrics are stored directly in the stocks table — no separate
 * quotes/ratios/profiles tables.
 *
 * Vercel cron sends GET with Authorization: Bearer <CRON_SECRET>.
 * Each cron run: refreshes ALL screener data + enriches the NEXT batch
 * of 120 stocks. Tracks offset in stock_meta so over ~10 days every
 * stock gets fully enriched.
 *
 * Rate limiting: slot-based queue ensures exactly 4 req/sec (240 req/min),
 * safely under the 300 req/min starter plan limit even with concurrency.
 */

import { NextRequest, NextResponse } from "next/server";
import { neon, NeonQueryFunction } from "@neondatabase/serverless";
import { refreshStockUniverse } from "@/lib/fmpService";
import { ensureStockTables } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 minutes

const ENRICH_BATCH_SIZE = 120;

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
      console.warn(`[refresh-stocks] 429 on ${endpoint}, backing off 10s...`);
      nextSlot = Date.now() + 10000; // pause all requests for 10s
      await sleep(10000);
      return fetchFMP<T>(endpoint, retries - 1);
    }
    if (!res.ok) {
      console.error(`[refresh-stocks] FMP ${res.status} for ${endpoint}`);
      return null;
    }
    const data = await res.json();
    if (data && typeof data === "object" && !Array.isArray(data) && "Error Message" in data) {
      console.error(`[refresh-stocks] FMP error:`, (data as Record<string, string>)["Error Message"]);
      return null;
    }
    return data as T;
  } catch (err) {
    console.error(`[refresh-stocks] fetch failed for ${endpoint}:`, err);
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

// Name patterns that indicate funds, trusts, SPACs, debt instruments, etc.
const EXCLUDE_NAME_PATTERNS = /\b(ETF|ETN|Exchange.Traded|Index Fund|Mutual Fund|Bond Fund|Income Fund|Money Market|Closed.End|Acquisition Corp|Blank Check|SPAC|Special Purpose|Statutory Trust|Capital Trust|Investment Trust|Depositary Shares?|Depositary Receipt|Preferred Shares?|Preferred Stock|Preferred Securities|Fixed.Income|Senior Notes?|Subordinated|Debentures?)\b|\bTrust [IVX]+\b|\d+\.?\d*% |\bRights$|\bWarrants?$|\bUnits?$|\bL\.?P\.?$|Notes Due/i;

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

  return {
    revenueHistory: Object.keys(revHist).length > 0 ? JSON.stringify(revHist) : null,
    netIncomeHistory: Object.keys(niHist).length > 0 ? JSON.stringify(niHist) : null,
    epsHistory: Object.keys(epsHist).length > 0 ? JSON.stringify(epsHist) : null,
    consecutiveRevenueGrowthYears: consRevGrowth,
    consecutiveNetIncomeGrowthYears: consNiGrowth,
    consecutiveEpsGrowthYears: consEpsGrowth,
    revenueGrowth3yrAvg: avgGrowth(e => toNum(e.revenue)),
    netIncomeGrowth3yrAvg: avgGrowth(e => toNum(e.netIncome)),
  };
}

// ── Shared refresh logic ───────────────────────────────────────────

async function runRefresh(
  sql: NeonQueryFunction<false, false>,
  enrichOffset: number
): Promise<{ stocks: number; enriched: number; enrichFailed: number; noData: number; nextOffset: number }> {
  await ensureStockTables(sql);

  // Step 1: Screener — always refresh ALL stocks basic data
  const results = await fetchFMP<ScreenerResult[]>(
    "/company-screener?marketCapMoreThan=300000000&isEtf=false&isFund=false&isActivelyTrading=true&exchange=NYSE,NASDAQ&limit=5000"
  );
  if (!results || results.length === 0) {
    throw new Error("FMP screener returned no results — check API key and plan");
  }

  const filtered = results.filter(
    (s) =>
      s.marketCap > 0 &&
      !s.symbol.includes(".") &&
      s.symbol.length <= 5 &&
      !s.isEtf &&
      !s.isFund &&
      s.sector &&
      s.sector.trim() !== "" &&
      !EXCLUDE_NAME_PATTERNS.test(s.companyName) &&
      !(s.symbol.length === 5 && s.symbol.endsWith("X") && (s.sector === "Asset Management" || s.industry === "Asset Management"))
  );
  console.log(`[refresh-stocks] ${results.length} screener → ${filtered.length} common stocks`);

  // Insert into unified stocks table
  for (const s of filtered) {
    await sql`
      INSERT INTO stocks (symbol, company_name, sector, industry, country, exchange, market_cap, beta, last_dividend, price, volume, is_etf, is_fund, is_actively_trading, updated_at)
      VALUES (${s.symbol}, ${s.companyName}, ${s.sector}, ${s.industry}, ${s.country}, ${s.exchange}, ${s.marketCap}, ${toNum(s.beta)}, ${toNum(s.lastAnnualDividend)}, ${toNum(s.price)}, ${toNum(s.volume)}, ${s.isEtf}, ${s.isFund || false}, ${s.isActivelyTrading}, NOW())
      ON CONFLICT (symbol) DO UPDATE SET
        company_name = EXCLUDED.company_name, sector = EXCLUDED.sector, industry = EXCLUDED.industry,
        country = EXCLUDED.country, exchange = EXCLUDED.exchange,
        market_cap = EXCLUDED.market_cap, beta = EXCLUDED.beta, last_dividend = EXCLUDED.last_dividend,
        price = EXCLUDED.price, volume = EXCLUDED.volume,
        is_etf = EXCLUDED.is_etf, is_fund = EXCLUDED.is_fund, is_actively_trading = EXCLUDED.is_actively_trading, updated_at = NOW()
    `;
  }

  // Step 2: Enrich a batch of stocks starting at enrichOffset
  const allRows = await sql`SELECT symbol FROM stocks ORDER BY market_cap DESC NULLS LAST`;
  const allSymbols = allRows.map((r) => String(r.symbol));
  const totalStocks = allSymbols.length;

  const safeOffset = enrichOffset >= totalStocks ? 0 : enrichOffset;
  const batch = allSymbols.slice(safeOffset, safeOffset + ENRICH_BATCH_SIZE);
  console.log(`[refresh-stocks] Enriching batch ${safeOffset}–${safeOffset + batch.length - 1} of ${totalStocks} (${batch.length} stocks)`);

  let enriched = 0;
  let enrichFailed = 0;
  let noDataCount = 0;

  const CONCURRENCY = 2;
  const TIME_BUDGET_MS = 240_000; // 4 minutes
  const enrichStart = Date.now();

  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    if (Date.now() - enrichStart > TIME_BUDGET_MS) {
      console.log(`[refresh-stocks] Time budget reached after enriching ${enriched}/${batch.length}`);
      break;
    }

    const chunk = batch.slice(i, i + CONCURRENCY);
    const results2 = await Promise.allSettled(
      chunk.map(async (sym) => {
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

        // Update all metrics directly in the unified stocks table
        await sql`
          UPDATE stocks SET
            -- Quote data
            year_high = COALESCE(${toNum(quote?.yearHigh)}, year_high),
            year_low = COALESCE(${toNum(quote?.yearLow)}, year_low),
            avg_volume = COALESCE(${toNum(quote?.avgVolume)}, avg_volume),

            -- Valuation
            price_to_earnings_ratio = COALESCE(${toNum(finRatios?.priceToEarningsRatio)}, price_to_earnings_ratio),
            price_to_earnings_growth_ratio = COALESCE(${toNum(finRatios?.priceToEarningsGrowthRatio)}, price_to_earnings_growth_ratio),
            price_to_book_ratio = COALESCE(${toNum(finRatios?.priceToBookRatio)}, price_to_book_ratio),
            price_to_sales_ratio = COALESCE(${toNum(finRatios?.priceToSalesRatio)}, price_to_sales_ratio),
            price_to_free_cash_flow_ratio = COALESCE(${toNum(finRatios?.priceToFreeCashFlowRatio)}, price_to_free_cash_flow_ratio),
            price_to_operating_cash_flow_ratio = COALESCE(${toNum(finRatios?.priceToOperatingCashFlowRatio)}, price_to_operating_cash_flow_ratio),
            price_to_fair_value = COALESCE(${toNum(finRatios?.priceToFairValue)}, price_to_fair_value),
            enterprise_value_multiple = COALESCE(${toNum(finRatios?.enterpriseValueMultiple)}, enterprise_value_multiple),

            -- Profitability
            gross_profit_margin = COALESCE(${toNum(finRatios?.grossProfitMargin)}, gross_profit_margin),
            ebit_margin = COALESCE(${toNum(finRatios?.ebitMargin)}, ebit_margin),
            ebitda_margin = COALESCE(${toNum(finRatios?.ebitdaMargin)}, ebitda_margin),
            operating_profit_margin = COALESCE(${toNum(finRatios?.operatingProfitMargin)}, operating_profit_margin),
            pretax_profit_margin = COALESCE(${toNum(finRatios?.pretaxProfitMargin)}, pretax_profit_margin),
            net_profit_margin = COALESCE(${toNum(finRatios?.netProfitMargin)}, net_profit_margin),
            effective_tax_rate = COALESCE(${toNum(finRatios?.effectiveTaxRate)}, effective_tax_rate),

            -- Returns
            return_on_assets = COALESCE(${toNum(metrics?.returnOnAssets)}, return_on_assets),
            return_on_equity = COALESCE(${toNum(metrics?.returnOnEquity)}, return_on_equity),
            return_on_invested_capital = COALESCE(${toNum(metrics?.returnOnInvestedCapital)}, return_on_invested_capital),
            return_on_capital_employed = COALESCE(${toNum(metrics?.returnOnCapitalEmployed)}, return_on_capital_employed),
            earnings_yield = COALESCE(${toNum(metrics?.earningsYield)}, earnings_yield),
            free_cash_flow_yield = COALESCE(${toNum(metrics?.freeCashFlowYield)}, free_cash_flow_yield),

            -- Liquidity
            current_ratio = COALESCE(${toNum(metrics?.currentRatio ?? finRatios?.currentRatio)}, current_ratio),
            quick_ratio = COALESCE(${toNum(finRatios?.quickRatio)}, quick_ratio),
            cash_ratio = COALESCE(${toNum(finRatios?.cashRatio)}, cash_ratio),

            -- Leverage
            debt_to_equity_ratio = COALESCE(${toNum(finRatios?.debtToEquityRatio)}, debt_to_equity_ratio),
            debt_to_assets_ratio = COALESCE(${toNum(finRatios?.debtToAssetsRatio)}, debt_to_assets_ratio),
            debt_to_capital_ratio = COALESCE(${toNum(finRatios?.debtToCapitalRatio)}, debt_to_capital_ratio),
            financial_leverage_ratio = COALESCE(${toNum(finRatios?.financialLeverageRatio)}, financial_leverage_ratio),
            debt_to_market_cap = COALESCE(${toNum(finRatios?.debtToMarketCap)}, debt_to_market_cap),
            interest_coverage_ratio = COALESCE(${toNum(finRatios?.interestCoverageRatio)}, interest_coverage_ratio),

            -- Dividends
            dividend_yield = COALESCE(${toNum(finRatios?.dividendYield)}, dividend_yield),
            dividend_yield_percentage = COALESCE(${toNum(finRatios?.dividendYieldPercentage)}, dividend_yield_percentage),
            dividend_payout_ratio = COALESCE(${toNum(finRatios?.dividendPayoutRatio)}, dividend_payout_ratio),

            -- Per share
            revenue_per_share = COALESCE(${toNum(finRatios?.revenuePerShare)}, revenue_per_share),
            net_income_per_share = COALESCE(${toNum(finRatios?.netIncomePerShare)}, net_income_per_share),
            book_value_per_share = COALESCE(${toNum(finRatios?.bookValuePerShare)}, book_value_per_share),
            tangible_book_value_per_share = COALESCE(${toNum(finRatios?.tangibleBookValuePerShare)}, tangible_book_value_per_share),
            operating_cash_flow_per_share = COALESCE(${toNum(finRatios?.operatingCashFlowPerShare)}, operating_cash_flow_per_share),
            free_cash_flow_per_share = COALESCE(${toNum(finRatios?.freeCashFlowPerShare)}, free_cash_flow_per_share),
            cash_per_share = COALESCE(${toNum(finRatios?.cashPerShare)}, cash_per_share),

            -- Efficiency
            asset_turnover = COALESCE(${toNum(finRatios?.assetTurnover)}, asset_turnover),
            inventory_turnover = COALESCE(${toNum(finRatios?.inventoryTurnover)}, inventory_turnover),
            receivables_turnover = COALESCE(${toNum(finRatios?.receivablesTurnover)}, receivables_turnover),
            days_of_sales_outstanding = COALESCE(${toNum(finRatios?.daysOfSalesOutstanding)}, days_of_sales_outstanding),
            days_of_inventory_outstanding = COALESCE(${toNum(finRatios?.daysOfInventoryOutstanding)}, days_of_inventory_outstanding),
            days_of_payables_outstanding = COALESCE(${toNum(finRatios?.daysOfPayablesOutstanding)}, days_of_payables_outstanding),
            cash_conversion_cycle = COALESCE(${toNum(finRatios?.cashConversionCycle)}, cash_conversion_cycle),

            -- Enterprise Value
            enterprise_value = COALESCE(${toNum(metrics?.enterpriseValue)}, enterprise_value),
            ev_to_sales = COALESCE(${toNum(metrics?.evToSales)}, ev_to_sales),
            ev_to_ebitda = COALESCE(${toNum(metrics?.evToEBITDA)}, ev_to_ebitda),
            ev_to_operating_cash_flow = COALESCE(${toNum(metrics?.evToOperatingCashFlow)}, ev_to_operating_cash_flow),
            ev_to_free_cash_flow = COALESCE(${toNum(metrics?.evToFreeCashFlow)}, ev_to_free_cash_flow),
            net_debt_to_ebitda = COALESCE(${toNum(metrics?.netDebtToEBITDA)}, net_debt_to_ebitda),

            -- Cash Flow
            capex_to_revenue = COALESCE(${toNum(metrics?.capexToRevenue)}, capex_to_revenue),
            operating_cash_flow_sales_ratio = COALESCE(${toNum(finRatios?.operatingCashFlowSalesRatio)}, operating_cash_flow_sales_ratio),
            free_cash_flow_operating_cash_flow_ratio = COALESCE(${toNum(finRatios?.freeCashFlowOperatingCashFlowRatio)}, free_cash_flow_operating_cash_flow_ratio),
            income_quality = COALESCE(${toNum(metrics?.incomeQuality)}, income_quality),

            -- Other
            graham_number = COALESCE(${toNum(metrics?.grahamNumber)}, graham_number),
            working_capital = COALESCE(${toNum(metrics?.workingCapital)}, working_capital),
            invested_capital = COALESCE(${toNum(metrics?.investedCapital)}, invested_capital),
            tangible_asset_value = COALESCE(${toNum(metrics?.tangibleAssetValue)}, tangible_asset_value),
            research_and_development_to_revenue = COALESCE(${toNum(metrics?.researchAndDevelopementToRevenue)}, research_and_development_to_revenue),
            stock_based_compensation_to_revenue = COALESCE(${toNum(metrics?.stockBasedCompensationToRevenue)}, stock_based_compensation_to_revenue),

            -- Growth / Income History
            revenue_history = COALESCE(${growth?.revenueHistory ?? null}::jsonb, revenue_history),
            net_income_history = COALESCE(${growth?.netIncomeHistory ?? null}::jsonb, net_income_history),
            eps_history = COALESCE(${growth?.epsHistory ?? null}::jsonb, eps_history),
            consecutive_revenue_growth_years = COALESCE(${growth?.consecutiveRevenueGrowthYears ?? null}, consecutive_revenue_growth_years),
            consecutive_net_income_growth_years = COALESCE(${growth?.consecutiveNetIncomeGrowthYears ?? null}, consecutive_net_income_growth_years),
            consecutive_eps_growth_years = COALESCE(${growth?.consecutiveEpsGrowthYears ?? null}, consecutive_eps_growth_years),
            revenue_growth_3yr_avg = COALESCE(${growth?.revenueGrowth3yrAvg ?? null}, revenue_growth_3yr_avg),
            net_income_growth_3yr_avg = COALESCE(${growth?.netIncomeGrowth3yrAvg ?? null}, net_income_growth_3yr_avg),

            updated_at = NOW()
          WHERE symbol = ${sym}
        `;
      })
    );

    for (const r of results2) {
      if (r.status === "fulfilled") enriched++;
      else enrichFailed++;
    }

    // Log progress every ~50 stocks
    if ((i + CONCURRENCY) % 50 < CONCURRENCY) {
      const elapsed = Math.round((Date.now() - enrichStart) / 1000);
      console.log(`[refresh-stocks]   ...enriched ${enriched}/${batch.length} (${elapsed}s elapsed)`);
    }
  }

  // Calculate next offset (wrap around)
  const nextOffset = safeOffset + ENRICH_BATCH_SIZE >= totalStocks ? 0 : safeOffset + ENRICH_BATCH_SIZE;

  // Save next offset + timestamp
  const timestamp = new Date().toISOString();
  await sql`
    INSERT INTO stock_meta (key, value, updated_at)
    VALUES (${'last_populate'}, ${timestamp}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `;
  await sql`
    INSERT INTO stock_meta (key, value, updated_at)
    VALUES (${'enrich_offset'}, ${String(nextOffset)}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `;

  // Cleanup: remove non-company entries
  const NON_COMPANY_PATTERN_PG = [
    '\\y(ETF|ETN)\\y',
    'Exchange.Traded',
    '\\y(Index Fund|Mutual Fund|Bond Fund|Income Fund|Money Market)\\y',
    'Closed.End',
    '\\y(Acquisition Corp|Blank Check|SPAC|Special Purpose)\\y',
    '\\y(Statutory Trust|Capital Trust|Investment Trust)\\y',
    'Trust [IVX]+\\y',
    'Depositary (Shares?|Receipt)',
    'Preferred (Shares?|Stock|Securities)',
    '\\d+\\.?\\d*% ',
    'Fixed.Income',
    '\\yRights$',
    '\\yWarrants?$',
    '\\yUnits?$',
    '\\ySenior Notes?\\y',
    'Notes Due',
    '\\ySubordinated\\y',
    '\\yDebentures?\\y',
    'L\\.P\\.?$',
  ].join('|');

  const purged = await sql`
    DELETE FROM stocks
    WHERE is_etf = true
       OR sector IS NULL OR TRIM(sector) = ''
       OR symbol LIKE '%.%'
       OR LENGTH(symbol) > 5
       OR company_name ~* ${NON_COMPANY_PATTERN_PG}
       OR (LENGTH(symbol) = 5 AND symbol LIKE '%X' AND (sector = 'Asset Management' OR industry = 'Asset Management'))
    RETURNING symbol
  `;
  if (purged.length > 0) {
    console.log(`[refresh-stocks] Purged ${purged.length} non-company entries`);
  }

  // Remove stale stocks not refreshed in the last 7 days
  await sql`DELETE FROM stocks WHERE updated_at < NOW() - INTERVAL '7 days'`;

  await refreshStockUniverse();

  return { stocks: filtered.length, enriched, enrichFailed, noData: noDataCount, nextOffset };
}

// ── GET: Vercel Cron handler + status ──────────────────────────────

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  const isCron = cronSecret && authHeader === `Bearer ${cronSecret}`;

  if (!isCron) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      return NextResponse.json({ configured: false, message: "DATABASE_URL not set" });
    }
    try {
      const sql = neon(databaseUrl);
      const meta = await sql`SELECT * FROM stock_meta WHERE key IN ('last_populate', 'enrich_offset', 'last_refresh')`;
      const stockCount = await sql`SELECT count(*) as cnt FROM stocks`;
      const enrichedCount = await sql`SELECT count(*) as cnt FROM stocks WHERE price_to_earnings_ratio IS NOT NULL OR return_on_equity IS NOT NULL`;
      const historyCount = await sql`SELECT count(*) as cnt FROM stocks WHERE revenue_history IS NOT NULL`;
      const lastPopulate = meta.find((r) => r.key === "last_populate")?.value || null;
      const lastRefresh = meta.find((r) => r.key === "last_refresh")?.value || null;
      const enrichOffset = meta.find((r) => r.key === "enrich_offset")?.value || "0";
      return NextResponse.json({
        configured: true,
        lastPopulate,
        lastRefresh,
        enrichOffset: Number(enrichOffset),
        stockCount: Number(stockCount[0]?.cnt || 0),
        enrichedCount: Number(enrichedCount[0]?.cnt || 0),
        historyCount: Number(historyCount[0]?.cnt || 0),
      });
    } catch {
      return NextResponse.json({ configured: true, error: "Could not query stock_meta — run POST /api/db/init first" });
    }
  }

  // Cron request — run refresh with rotating batch
  if (!FMP_API_KEY) {
    return NextResponse.json({ error: "FMP API key not configured" }, { status: 400 });
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 400 });
  }

  const sql = neon(databaseUrl);
  // Reset rate limiter for this request
  nextSlot = 0;

  try {
    await ensureStockTables(sql);
    let offset = 0;
    try {
      const offsetRow = await sql`SELECT value FROM stock_meta WHERE key = 'enrich_offset'`;
      if (offsetRow[0]?.value) offset = parseInt(offsetRow[0].value as string, 10) || 0;
    } catch { /* first run, start at 0 */ }

    console.log(`[cron] Starting refresh, enrich offset: ${offset}`);
    const result = await runRefresh(sql, offset);

    return NextResponse.json({
      success: true,
      ...result,
      message: `Enriched batch ${offset}–${offset + result.enriched - 1}, next batch starts at ${result.nextOffset}`,
    });
  } catch (error) {
    console.error("Cron refresh error:", error);
    return NextResponse.json({ error: "Refresh failed", details: String(error) }, { status: 500 });
  }
}

// ── POST: Manual trigger ───────────────────────────────────────────

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
  // Reset rate limiter for this request
  nextSlot = 0;

  try {
    await ensureStockTables(sql);
    let offset = 0;
    try {
      const offsetRow = await sql`SELECT value FROM stock_meta WHERE key = 'enrich_offset'`;
      if (offsetRow[0]?.value) offset = parseInt(offsetRow[0].value as string, 10) || 0;
    } catch { /* first run */ }

    const result = await runRefresh(sql, offset);
    return NextResponse.json({
      success: true,
      ...result,
      message: `Enriched batch ${offset}–${offset + result.enriched - 1}, next batch starts at ${result.nextOffset}`,
    });
  } catch (error) {
    console.error("Refresh error:", error);
    return NextResponse.json({ error: "Refresh failed", details: String(error) }, { status: 500 });
  }
}
