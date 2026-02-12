/**
 * Admin endpoint to refresh the stock database from FMP API.
 *
 * GET  /api/admin/refresh-stocks — Vercel Cron handler (rotates batches)
 * POST /api/admin/refresh-stocks — Manual trigger (enriches top 150)
 *
 * NOTE: This endpoint uses per-stock enrichment (6 FMP API calls per stock).
 * For bulk refresh (3 total API calls), use POST /api/admin/refresh-data instead.
 *
 * This endpoint works with the unified single `stocks` table.
 * All metrics are stored directly in the stocks table — no separate
 * quotes/ratios/profiles tables.
 *
 * Vercel cron sends GET with Authorization: Bearer <CRON_SECRET>.
 * Each cron run: refreshes ALL screener data + enriches the NEXT batch
 * of 150 stocks. Tracks offset in stock_meta so over ~10 days every
 * stock gets fully enriched.
 *
 * FMP Starter plan: 300 req/min. We throttle to ~200 req/min.
 */

import { NextRequest, NextResponse } from "next/server";
import { neon, NeonQueryFunction } from "@neondatabase/serverless";
import { refreshStockUniverse } from "@/lib/fmpService";
import { ensureStockTables } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 minutes

const ENRICH_BATCH_SIZE = 150;

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
  marketCap: number;
  enterpriseValue: number;
  evToSales: number;
  evToOperatingCashFlow: number;
  evToFreeCashFlow: number;
  evToEBITDA: number;
  netDebtToEBITDA: number;
  currentRatio: number;
  incomeQuality: number;
  grahamNumber: number;
  workingCapital: number;
  investedCapital: number;
  returnOnAssets: number;
  returnOnEquity: number;
  returnOnInvestedCapital: number;
  returnOnCapitalEmployed: number;
  earningsYield: number;
  freeCashFlowYield: number;
  capexToRevenue: number;
  researchAndDevelopementToRevenue: number;
  stockBasedCompensationToRevenue: number;
  tangibleAssetValue: number;
}

interface FinancialRatios {
  grossProfitMargin: number;
  ebitMargin: number;
  ebitdaMargin: number;
  operatingProfitMargin: number;
  pretaxProfitMargin: number;
  netProfitMargin: number;
  effectiveTaxRate: number;
  priceToEarningsRatio: number;
  priceToBookRatio: number;
  priceToSalesRatio: number;
  priceToFreeCashFlowRatio: number;
  priceToOperatingCashFlowRatio: number;
  debtToEquityRatio: number;
  debtToAssetsRatio: number;
  debtToCapitalRatio: number;
  financialLeverageRatio: number;
  interestCoverageRatio: number;
  currentRatio: number;
  quickRatio: number;
  cashRatio: number;
  dividendYield: number;
  dividendYieldPercentage: number;
  dividendPayoutRatio: number;
  revenuePerShare: number;
  netIncomePerShare: number;
  bookValuePerShare: number;
  tangibleBookValuePerShare: number;
  operatingCashFlowPerShare: number;
  freeCashFlowPerShare: number;
  cashPerShare: number;
  assetTurnover: number;
  inventoryTurnover: number;
  receivablesTurnover: number;
  operatingCashFlowSalesRatio: number;
  freeCashFlowOperatingCashFlowRatio: number;
  priceToFairValue: number;
  debtToMarketCap: number;
  enterpriseValueMultiple: number;
  priceToEarningsGrowthRatio: number;
  daysOfSalesOutstanding: number;
  daysOfInventoryOutstanding: number;
  daysOfPayablesOutstanding: number;
  cashConversionCycle: number;
}

// Name patterns that indicate funds, trusts, SPACs, debt instruments, etc.
const EXCLUDE_NAME_PATTERNS = /\b(ETF|ETN|Exchange.Traded|Index Fund|Mutual Fund|Bond Fund|Income Fund|Money Market|Closed.End|Acquisition Corp|Blank Check|SPAC|Special Purpose|Statutory Trust|Capital Trust|Investment Trust|Depositary Shares?|Depositary Receipt|Preferred Shares?|Preferred Stock|Preferred Securities|Fixed.Income)\b|\bTrust [IVX]+\b|\d+\.?\d*% |\bRights$|\bWarrants?$/i;

// ── Shared refresh logic ───────────────────────────────────────────

async function runRefresh(
  sql: NeonQueryFunction<false, false>,
  enrichOffset: number
): Promise<{ stocks: number; enriched: number; enrichFailed: number; nextOffset: number }> {
  await ensureStockTables(sql);

  // Step 1: Screener — always refresh ALL stocks basic data
  const results = await fetchFMP<ScreenerResult[]>(
    "/company-screener?marketCapMoreThan=300000000&isEtf=false&isFund=false&isActivelyTrading=true&exchange=NYSE,NASDAQ&limit=3000"
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
      !EXCLUDE_NAME_PATTERNS.test(s.companyName)
  );
  console.log(`[refresh] ${results.length} screener → ${filtered.length} common stocks`);

  // Insert into unified stocks table
  for (const s of filtered) {
    await sql`
      INSERT INTO stocks (symbol, company_name, sector, industry, country, exchange, market_cap, beta, last_dividend, price, volume, is_etf, is_fund, is_actively_trading, updated_at)
      VALUES (${s.symbol}, ${s.companyName}, ${s.sector}, ${s.industry}, ${s.country}, ${s.exchange}, ${s.marketCap}, ${s.beta || 0}, ${s.lastAnnualDividend || 0}, ${s.price || 0}, ${s.volume || 0}, ${s.isEtf}, ${s.isFund || false}, ${s.isActivelyTrading}, NOW())
      ON CONFLICT (symbol) DO UPDATE SET
        company_name = EXCLUDED.company_name, sector = EXCLUDED.sector, industry = EXCLUDED.industry,
        country = EXCLUDED.country, exchange = EXCLUDED.exchange,
        market_cap = EXCLUDED.market_cap, beta = EXCLUDED.beta, last_dividend = EXCLUDED.last_dividend,
        price = EXCLUDED.price, volume = EXCLUDED.volume,
        is_etf = EXCLUDED.is_etf, is_fund = EXCLUDED.is_fund, is_actively_trading = EXCLUDED.is_actively_trading, updated_at = NOW()
    `;
  }

  // Step 2: Enrich a batch of stocks starting at enrichOffset
  const allRows = await sql`SELECT symbol FROM stocks ORDER BY market_cap DESC`;
  const allSymbols = allRows.map((r) => String(r.symbol));
  const totalStocks = allSymbols.length;

  const safeOffset = enrichOffset >= totalStocks ? 0 : enrichOffset;
  const batch = allSymbols.slice(safeOffset, safeOffset + ENRICH_BATCH_SIZE);
  console.log(`[refresh] Enriching batch ${safeOffset}–${safeOffset + batch.length - 1} of ${totalStocks} (${batch.length} stocks)`);

  let enriched = 0;
  let enrichFailed = 0;

  for (const sym of batch) {
    try {
      const quote = await fetchFMP<Quote[]>(`/quote?symbol=${sym}`).then((r) => r?.[0] || null);
      const metrics = await fetchFMP<KeyMetrics[]>(`/key-metrics?symbol=${sym}&period=annual&limit=1`).then((r) => r?.[0] || null);
      const finRatios = await fetchFMP<FinancialRatios[]>(`/ratios?symbol=${sym}&period=annual&limit=1`).then((r) => r?.[0] || null);

      // Update all metrics directly in the unified stocks table
      await sql`
        UPDATE stocks SET
          price = ${quote?.price || null},
          volume = ${quote?.volume || null},
          avg_volume = ${quote?.avgVolume || null},
          market_cap = ${quote?.marketCap || null},

          -- Valuation
          price_to_earnings_ratio = ${finRatios?.priceToEarningsRatio || quote?.pe || null},
          price_to_earnings_growth_ratio = ${finRatios?.priceToEarningsGrowthRatio || null},
          price_to_book_ratio = ${finRatios?.priceToBookRatio || null},
          price_to_sales_ratio = ${finRatios?.priceToSalesRatio || null},
          price_to_free_cash_flow_ratio = ${finRatios?.priceToFreeCashFlowRatio || null},
          price_to_operating_cash_flow_ratio = ${finRatios?.priceToOperatingCashFlowRatio || null},
          price_to_fair_value = ${finRatios?.priceToFairValue || null},
          enterprise_value_multiple = ${finRatios?.enterpriseValueMultiple || null},

          -- Profitability
          gross_profit_margin = ${finRatios?.grossProfitMargin || null},
          ebit_margin = ${finRatios?.ebitMargin || null},
          ebitda_margin = ${finRatios?.ebitdaMargin || null},
          operating_profit_margin = ${finRatios?.operatingProfitMargin || null},
          pretax_profit_margin = ${finRatios?.pretaxProfitMargin || null},
          net_profit_margin = ${finRatios?.netProfitMargin || null},
          effective_tax_rate = ${finRatios?.effectiveTaxRate || null},

          -- Returns
          return_on_assets = ${metrics?.returnOnAssets || null},
          return_on_equity = ${metrics?.returnOnEquity || null},
          return_on_invested_capital = ${metrics?.returnOnInvestedCapital || null},
          return_on_capital_employed = ${metrics?.returnOnCapitalEmployed || null},
          earnings_yield = ${metrics?.earningsYield || null},
          free_cash_flow_yield = ${metrics?.freeCashFlowYield || null},

          -- Liquidity
          current_ratio = ${metrics?.currentRatio || finRatios?.currentRatio || null},
          quick_ratio = ${finRatios?.quickRatio || null},
          cash_ratio = ${finRatios?.cashRatio || null},

          -- Leverage
          debt_to_equity_ratio = ${finRatios?.debtToEquityRatio || null},
          debt_to_assets_ratio = ${finRatios?.debtToAssetsRatio || null},
          debt_to_capital_ratio = ${finRatios?.debtToCapitalRatio || null},
          financial_leverage_ratio = ${finRatios?.financialLeverageRatio || null},
          debt_to_market_cap = ${finRatios?.debtToMarketCap || null},
          interest_coverage_ratio = ${finRatios?.interestCoverageRatio || null},

          -- Dividends
          dividend_yield = ${finRatios?.dividendYield || null},
          dividend_yield_percentage = ${finRatios?.dividendYieldPercentage || null},
          dividend_payout_ratio = ${finRatios?.dividendPayoutRatio || null},

          -- Per share
          revenue_per_share = ${finRatios?.revenuePerShare || null},
          net_income_per_share = ${finRatios?.netIncomePerShare || null},
          book_value_per_share = ${finRatios?.bookValuePerShare || null},
          tangible_book_value_per_share = ${finRatios?.tangibleBookValuePerShare || null},
          operating_cash_flow_per_share = ${finRatios?.operatingCashFlowPerShare || null},
          free_cash_flow_per_share = ${finRatios?.freeCashFlowPerShare || null},
          cash_per_share = ${finRatios?.cashPerShare || null},

          -- Efficiency
          asset_turnover = ${finRatios?.assetTurnover || null},
          inventory_turnover = ${finRatios?.inventoryTurnover || null},
          receivables_turnover = ${finRatios?.receivablesTurnover || null},
          days_of_sales_outstanding = ${finRatios?.daysOfSalesOutstanding || null},
          days_of_inventory_outstanding = ${finRatios?.daysOfInventoryOutstanding || null},
          days_of_payables_outstanding = ${finRatios?.daysOfPayablesOutstanding || null},
          cash_conversion_cycle = ${finRatios?.cashConversionCycle || null},

          -- Enterprise Value
          enterprise_value = ${metrics?.enterpriseValue || null},
          ev_to_sales = ${metrics?.evToSales || null},
          ev_to_ebitda = ${metrics?.evToEBITDA || null},
          ev_to_operating_cash_flow = ${metrics?.evToOperatingCashFlow || null},
          ev_to_free_cash_flow = ${metrics?.evToFreeCashFlow || null},
          net_debt_to_ebitda = ${metrics?.netDebtToEBITDA || null},

          -- Cash Flow
          capex_to_revenue = ${metrics?.capexToRevenue || null},
          operating_cash_flow_sales_ratio = ${finRatios?.operatingCashFlowSalesRatio || null},
          free_cash_flow_operating_cash_flow_ratio = ${finRatios?.freeCashFlowOperatingCashFlowRatio || null},
          income_quality = ${metrics?.incomeQuality || null},

          -- Other
          graham_number = ${metrics?.grahamNumber || null},
          working_capital = ${metrics?.workingCapital || null},
          invested_capital = ${metrics?.investedCapital || null},
          tangible_asset_value = ${metrics?.tangibleAssetValue || null},
          research_and_development_to_revenue = ${metrics?.researchAndDevelopementToRevenue || null},
          stock_based_compensation_to_revenue = ${metrics?.stockBasedCompensationToRevenue || null},

          updated_at = NOW()
        WHERE symbol = ${sym}
      `;

      enriched++;
    } catch {
      enrichFailed++;
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
  ].join('|');

  const purged = await sql`
    DELETE FROM stocks
    WHERE is_etf = true
       OR sector IS NULL OR TRIM(sector) = ''
       OR symbol LIKE '%.%'
       OR LENGTH(symbol) > 5
       OR company_name ~* ${NON_COMPANY_PATTERN_PG}
    RETURNING symbol
  `;
  if (purged.length > 0) {
    console.log(`[refresh] Purged ${purged.length} non-company entries`);
  }

  // Remove stale stocks not refreshed in the last 7 days
  await sql`DELETE FROM stocks WHERE updated_at < NOW() - INTERVAL '7 days'`;

  await refreshStockUniverse();

  return { stocks: filtered.length, enriched, enrichFailed, nextOffset };
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
      const lastPopulate = meta.find((r) => r.key === "last_populate")?.value || null;
      const lastRefresh = meta.find((r) => r.key === "last_refresh")?.value || null;
      const enrichOffset = meta.find((r) => r.key === "enrich_offset")?.value || "0";
      return NextResponse.json({
        configured: true,
        lastPopulate,
        lastRefresh,
        enrichOffset: Number(enrichOffset),
        stockCount: Number(stockCount[0]?.cnt || 0),
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
