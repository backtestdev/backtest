/**
 * Admin endpoint to refresh the stock database using FMP API calls.
 *
 * POST /api/admin/refresh-data — Protected by x-admin-secret header.
 *
 * Strategy (starter-plan compatible — no bulk TTM endpoints):
 *   1. Create stocks_new table
 *   2. Fetch stock screener (1 API call) → INSERT into stocks_new
 *   3. Enrich top stocks by market cap using per-stock /ratios + /key-metrics
 *      (2 API calls per stock, rate-limited, time-bounded)
 *   4. Swap: stocks → stocks_old, stocks_new → stocks
 *   5. Log verification counts
 *
 * Within a 5-minute Vercel function, this enriches ~500-600 stocks
 * (top by market cap). Remaining stocks have basic screener data
 * (sector, industry, market cap, price) with NULL metric columns.
 * Use POST /api/admin/refresh-stocks for ongoing cron enrichment.
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

// Rate limiting — stay under FMP starter plan 300 req/min limit
let lastFetchTime = 0;
const MIN_FETCH_INTERVAL_MS = 350; // ~170 req/min, safe margin

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchFMP<T>(endpoint: string, retries = 2): Promise<T | null> {
  // Rate limit
  const elapsed = Date.now() - lastFetchTime;
  if (elapsed < MIN_FETCH_INTERVAL_MS) {
    await sleep(MIN_FETCH_INTERVAL_MS - elapsed);
  }
  lastFetchTime = Date.now();

  const sep = endpoint.includes("?") ? "&" : "?";
  const url = `${FMP_BASE}${endpoint}${sep}apikey=${FMP_API_KEY}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (res.status === 429 && retries > 0) {
      console.warn(`[refresh-data] 429 on ${endpoint}, retry in 5s...`);
      await sleep(5000);
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

// Name patterns that indicate funds, trusts, SPACs, etc. — NOT operating companies
const EXCLUDE_NAME_PATTERNS = /\b(ETF|ETN|Exchange.Traded|Index Fund|Mutual Fund|Bond Fund|Income Fund|Money Market|Closed.End|Acquisition Corp|Blank Check|SPAC|Special Purpose|Statutory Trust|Capital Trust|Investment Trust|Depositary Shares?|Depositary Receipt|Preferred Shares?|Preferred Stock|Preferred Securities|Fixed.Income|Senior Notes?|Subordinated|Debentures?)\b|\bTrust [IVX]+\b|\d+\.?\d*% |\bRights$|\bWarrants?$|\bUnits?$|\bL\.?P\.?$|Notes Due/i;

/**
 * 5-letter tickers ending in X under Asset Management are almost always
 * closed-end funds or similar non-operating-company vehicles.
 */
function isAssetManagementFund(s: ScreenerResult): boolean {
  return (
    s.symbol.length === 5 &&
    s.symbol.endsWith("X") &&
    (s.sector === "Asset Management" || s.industry === "Asset Management")
  );
}

// Helper: convert value to number or null for SQL
function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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

    // Filter out non-companies
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

    // ── Step 3: Per-stock enrichment (starter-plan compatible) ───
    log.push("Starting per-stock enrichment (ratios + key-metrics)...");

    // Get all symbols ordered by market cap (most important first)
    const symbolRows = await sql`SELECT symbol FROM stocks_new ORDER BY market_cap DESC NULLS LAST`;
    const allSymbols = symbolRows.map((r) => r.symbol as string);

    const CONCURRENCY = 3;
    const TIME_BUDGET_MS = 240_000; // 4 minutes for enrichment
    const enrichStart = Date.now();
    let enriched = 0;
    let enrichFailed = 0;

    for (let i = 0; i < allSymbols.length; i += CONCURRENCY) {
      if (Date.now() - enrichStart > TIME_BUDGET_MS) {
        log.push(
          `Time budget reached after enriching ${enriched}/${allSymbols.length} stocks`
        );
        break;
      }

      const batch = allSymbols.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (sym) => {
          // Fetch ratios and key-metrics in parallel per stock
          const [ratiosData, metricsData] = await Promise.all([
            fetchFMP<FinancialRatios[]>(
              `/ratios?symbol=${sym}&period=annual&limit=1`
            ),
            fetchFMP<KeyMetrics[]>(
              `/key-metrics?symbol=${sym}&period=annual&limit=1`
            ),
          ]);

          const finRatios = ratiosData?.[0] || null;
          const metrics = metricsData?.[0] || null;

          if (!finRatios && !metrics) return; // Nothing to update

          // Update using tagged template literal — same pattern as refresh-stocks
          await sql`
            UPDATE stocks_new SET
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

              updated_at = NOW()
            WHERE symbol = ${sym}
          `;
        })
      );

      for (const r of results) {
        if (r.status === "fulfilled") enriched++;
        else enrichFailed++;
      }

      // Log progress every 50 stocks
      if ((i + CONCURRENCY) % 51 < CONCURRENCY) {
        const elapsed = Math.round((Date.now() - enrichStart) / 1000);
        log.push(
          `  ...enriched ${enriched}/${allSymbols.length} (${elapsed}s elapsed)`
        );
      }
    }

    log.push(
      `Per-stock enrichment: ${enriched} enriched, ${enrichFailed} failed, ${allSymbols.length - enriched - enrichFailed} skipped (timeout)`
    );

    // ── Step 4: Swap tables ───────────────────────────────────────
    log.push("Swapping tables...");

    // Drop old backup if it exists
    await sql`DROP TABLE IF EXISTS stocks_old CASCADE`;

    // Check if old stocks table exists and rename it
    const oldTableExists = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'stocks'
        AND table_schema = 'public'
      ) as exists
    `;

    if (oldTableExists[0]?.exists) {
      await sql`ALTER TABLE stocks RENAME TO stocks_old`;
      log.push("Renamed stocks → stocks_old");
    }

    // Rename stocks_new → stocks
    await sql`ALTER TABLE stocks_new RENAME TO stocks`;
    log.push("Renamed stocks_new → stocks");

    // Recreate indexes on the newly renamed table
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

    // ── Verification ─────────────────────────────────────────────
    const totalCount = await sql`SELECT COUNT(*) as cnt FROM stocks`;
    const peCount = await sql`SELECT COUNT(*) as cnt FROM stocks WHERE price_to_earnings_ratio IS NOT NULL`;
    const roeCount = await sql`SELECT COUNT(*) as cnt FROM stocks WHERE return_on_equity IS NOT NULL`;
    const divCount = await sql`SELECT COUNT(*) as cnt FROM stocks WHERE dividend_yield IS NOT NULL`;

    const verification = {
      total: Number(totalCount[0]?.cnt || 0),
      has_pe: Number(peCount[0]?.cnt || 0),
      has_roe: Number(roeCount[0]?.cnt || 0),
      has_div_yield: Number(divCount[0]?.cnt || 0),
    };
    log.push(`Verification: ${JSON.stringify(verification)}`);

    // Check AAPL specifically
    const aapl = await sql`
      SELECT symbol, price_to_earnings_ratio, price_to_book_ratio, return_on_equity,
             dividend_yield, market_cap, sector
      FROM stocks
      WHERE symbol = 'AAPL'
    `;
    if (aapl.length > 0) {
      log.push(`AAPL check: PE=${aapl[0].price_to_earnings_ratio}, PB=${aapl[0].price_to_book_ratio}, ROE=${aapl[0].return_on_equity}, sector=${aapl[0].sector}`);
    } else {
      log.push("WARNING: AAPL not found in stocks table");
    }

    // Update stock_meta timestamp
    await sql`
      CREATE TABLE IF NOT EXISTS stock_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    const timestamp = new Date().toISOString();
    await sql`
      INSERT INTO stock_meta (key, value, updated_at)
      VALUES ('last_refresh', ${timestamp}, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `;

    // Refresh in-memory cache
    await refreshStockUniverse();

    return NextResponse.json({
      success: true,
      verification,
      enrichment: {
        enriched,
        failed: enrichFailed,
        skipped: allSymbols.length - enriched - enrichFailed,
        total: allSymbols.length,
      },
      aapl: aapl[0] || null,
      log,
    });
  } catch (error) {
    console.error("Refresh-data error:", error);
    // Try to clean up stocks_new if it exists
    try {
      await sql`DROP TABLE IF EXISTS stocks_new`;
    } catch { /* ignore cleanup error */ }

    return NextResponse.json(
      { error: "Refresh failed", details: String(error), log },
      { status: 500 }
    );
  }
}
