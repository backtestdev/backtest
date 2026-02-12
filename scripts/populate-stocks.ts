/**
 * One-time stock database population script.
 *
 * Fetches stock data from Financial Modeling Prep API and writes it into
 * the unified PostgreSQL `stocks` table (single table for all metrics).
 *
 * FMP Starter plan: 300 req/min. We throttle to ~200 req/min with retry
 * on 429 to stay within limits.
 *
 * Budget: ~1500 stocks × 3 calls/stock × 300ms ≈ 22 min
 *
 * Usage:
 *   npx tsx scripts/populate-stocks.ts
 *
 * Required env vars:
 *   DATABASE_URL                       - Neon PostgreSQL connection string
 *   FINANCIAL_MODELING_PREP_API_KEY    - FMP API key (or FMP_API_KEY)
 *
 * The script is idempotent — it uses upserts so running it again refreshes data.
 */

import { neon } from "@neondatabase/serverless";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const FMP_API_KEY =
  process.env.FINANCIAL_MODELING_PREP_API_KEY ||
  process.env.FMP_API_KEY ||
  "";
const FMP_BASE = "https://financialmodelingprep.com/stable";
const DATABASE_URL = process.env.DATABASE_URL || "";

if (!FMP_API_KEY) {
  console.error("ERROR: Set FINANCIAL_MODELING_PREP_API_KEY or FMP_API_KEY");
  process.exit(1);
}
if (!DATABASE_URL) {
  console.error("ERROR: Set DATABASE_URL");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

// ---------------------------------------------------------------------------
// Rate-limited FMP fetch helper
// ---------------------------------------------------------------------------

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

  const url = `${FMP_BASE}${endpoint}${endpoint.includes("?") ? "&" : "?"}apikey=${FMP_API_KEY}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (res.status === 429 && retries > 0) {
      console.warn(`  FMP 429 rate limited on ${endpoint}, retrying in 3s...`);
      await sleep(3000);
      return fetchFMP<T>(endpoint, retries - 1);
    }
    if (!res.ok) {
      console.error(`  FMP ${res.status} for ${endpoint}`);
      return null;
    }
    const data = await res.json();
    if (data && typeof data === "object" && "Error Message" in data) {
      console.error(`  FMP error: ${(data as Record<string, string>)["Error Message"]}`);
      return null;
    }
    return data as T;
  } catch (e) {
    console.error(`  FMP network error for ${endpoint}:`, e instanceof Error ? e.message : e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Types (mirrors FMP /stable/ response shapes — all camelCase)
// ---------------------------------------------------------------------------

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
  price: number;
  marketCap: number;
  volume: number;
  avgVolume: number;
  pe: number;
}

interface KeyMetrics {
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
  priceToEarningsGrowthRatio: number;
  priceToBookRatio: number;
  priceToSalesRatio: number;
  priceToFreeCashFlowRatio: number;
  priceToOperatingCashFlowRatio: number;
  debtToEquityRatio: number;
  debtToAssetsRatio: number;
  debtToCapitalRatio: number;
  financialLeverageRatio: number;
  interestCoverageRatio: number;
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
  daysOfSalesOutstanding: number;
  daysOfInventoryOutstanding: number;
  daysOfPayablesOutstanding: number;
  cashConversionCycle: number;
  operatingCashFlowSalesRatio: number;
  freeCashFlowOperatingCashFlowRatio: number;
  priceToFairValue: number;
  debtToMarketCap: number;
  enterpriseValueMultiple: number;
}

// Name patterns that indicate funds, trusts, SPACs, etc.
const EXCLUDE_NAME_PATTERNS = /\b(ETF|ETN|Exchange.Traded|Index Fund|Mutual Fund|Bond Fund|Income Fund|Money Market|Closed.End|Acquisition Corp|Blank Check|SPAC|Special Purpose|Statutory Trust|Capital Trust|Investment Trust|Depositary Shares?|Depositary Receipt|Preferred Shares?|Preferred Stock|Preferred Securities|Fixed.Income|Senior Notes?|Subordinated|Debentures?)\b|\bTrust [IVX]+\b|\d+\.?\d*% |\bRights$|\bWarrants?$|\bUnits?$|\bL\.?P\.?$|Notes Due/i;

// ---------------------------------------------------------------------------
// Step 1: Ensure unified stocks table exists
// ---------------------------------------------------------------------------

async function ensureTables() {
  console.log("Ensuring unified stocks table exists...");
  await sql`
    CREATE TABLE IF NOT EXISTS stocks (
      id SERIAL PRIMARY KEY,
      symbol VARCHAR(10) UNIQUE NOT NULL,
      company_name VARCHAR(255),
      exchange VARCHAR(50),
      sector VARCHAR(100),
      industry VARCHAR(100),
      country VARCHAR(50) DEFAULT 'US',
      market_cap BIGINT,
      price DECIMAL(12,4),
      beta DECIMAL(8,4),
      volume BIGINT,
      avg_volume BIGINT,
      last_dividend DECIMAL(8,4),
      ipo_date DATE,
      is_etf BOOLEAN DEFAULT FALSE,
      is_fund BOOLEAN DEFAULT FALSE,
      is_actively_trading BOOLEAN DEFAULT TRUE,
      description TEXT,
      full_time_employees INT,
      price_to_earnings_ratio DECIMAL(16,8),
      price_to_earnings_growth_ratio DECIMAL(16,8),
      price_to_book_ratio DECIMAL(16,8),
      price_to_sales_ratio DECIMAL(16,8),
      price_to_free_cash_flow_ratio DECIMAL(16,8),
      price_to_operating_cash_flow_ratio DECIMAL(16,8),
      price_to_fair_value DECIMAL(16,8),
      enterprise_value_multiple DECIMAL(16,8),
      gross_profit_margin DECIMAL(16,8),
      ebit_margin DECIMAL(16,8),
      ebitda_margin DECIMAL(16,8),
      operating_profit_margin DECIMAL(16,8),
      pretax_profit_margin DECIMAL(16,8),
      net_profit_margin DECIMAL(16,8),
      effective_tax_rate DECIMAL(16,8),
      return_on_assets DECIMAL(16,8),
      return_on_equity DECIMAL(16,8),
      return_on_invested_capital DECIMAL(16,8),
      return_on_capital_employed DECIMAL(16,8),
      earnings_yield DECIMAL(16,8),
      free_cash_flow_yield DECIMAL(16,8),
      current_ratio DECIMAL(16,8),
      quick_ratio DECIMAL(16,8),
      cash_ratio DECIMAL(16,8),
      debt_to_equity_ratio DECIMAL(16,8),
      debt_to_assets_ratio DECIMAL(16,8),
      debt_to_capital_ratio DECIMAL(16,8),
      financial_leverage_ratio DECIMAL(16,8),
      debt_to_market_cap DECIMAL(16,8),
      interest_coverage_ratio DECIMAL(16,8),
      dividend_yield DECIMAL(16,8),
      dividend_yield_percentage DECIMAL(16,8),
      dividend_payout_ratio DECIMAL(16,8),
      revenue_per_share DECIMAL(16,8),
      net_income_per_share DECIMAL(16,8),
      book_value_per_share DECIMAL(16,8),
      tangible_book_value_per_share DECIMAL(16,8),
      operating_cash_flow_per_share DECIMAL(16,8),
      free_cash_flow_per_share DECIMAL(16,8),
      cash_per_share DECIMAL(16,8),
      asset_turnover DECIMAL(16,8),
      inventory_turnover DECIMAL(16,8),
      receivables_turnover DECIMAL(16,8),
      days_of_sales_outstanding DECIMAL(16,8),
      days_of_inventory_outstanding DECIMAL(16,8),
      days_of_payables_outstanding DECIMAL(16,8),
      cash_conversion_cycle DECIMAL(16,8),
      enterprise_value BIGINT,
      ev_to_sales DECIMAL(16,8),
      ev_to_ebitda DECIMAL(16,8),
      ev_to_operating_cash_flow DECIMAL(16,8),
      ev_to_free_cash_flow DECIMAL(16,8),
      net_debt_to_ebitda DECIMAL(16,8),
      capex_to_revenue DECIMAL(16,8),
      free_cash_flow_operating_cash_flow_ratio DECIMAL(16,8),
      operating_cash_flow_sales_ratio DECIMAL(16,8),
      income_quality DECIMAL(16,8),
      graham_number DECIMAL(16,8),
      working_capital BIGINT,
      invested_capital BIGINT,
      tangible_asset_value BIGINT,
      research_and_development_to_revenue DECIMAL(16,8),
      stock_based_compensation_to_revenue DECIMAL(16,8),
      revenue_history JSONB,
      net_income_history JSONB,
      eps_history JSONB,
      consecutive_revenue_growth_years INT DEFAULT 0,
      consecutive_net_income_growth_years INT DEFAULT 0,
      consecutive_dividend_growth_years INT DEFAULT 0,
      consecutive_eps_growth_years INT DEFAULT 0,
      revenue_growth_3yr_avg DECIMAL(16,8),
      revenue_growth_5yr_avg DECIMAL(16,8),
      net_income_growth_3yr_avg DECIMAL(16,8),
      net_income_growth_5yr_avg DECIMAL(16,8),
      revenue_growth_positive_3yr_count INT DEFAULT 0,
      net_income_growth_positive_3yr_count INT DEFAULT 0,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_stocks_symbol ON stocks(symbol)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_stocks_sector ON stocks(sector)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_stocks_market_cap ON stocks(market_cap)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_stocks_pe ON stocks(price_to_earnings_ratio)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_stocks_roe ON stocks(return_on_equity)`;

  await sql`
    CREATE TABLE IF NOT EXISTS stock_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
}

// ---------------------------------------------------------------------------
// Step 2: Fetch screener → insert stocks
// ---------------------------------------------------------------------------

async function populateStocks(): Promise<string[]> {
  console.log("Step 1/3: Fetching stock screener...");
  const results = await fetchFMP<ScreenerResult[]>(
    "/company-screener?marketCapMoreThan=300000000&isEtf=false&isFund=false&isActivelyTrading=true&exchange=NYSE,NASDAQ&limit=3000"
  );

  if (!results || results.length === 0) {
    throw new Error("Screener returned no results");
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
  console.log(`  ${results.length} screener results → ${filtered.length} common stocks`);

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

  console.log(`  Inserted/updated ${filtered.length} stocks`);
  return filtered.map((s) => s.symbol);
}

// ---------------------------------------------------------------------------
// Step 3: Enrich ALL stocks — UPDATE the unified table directly
// ---------------------------------------------------------------------------

async function enrichAllStocks() {
  const topRows = await sql`SELECT symbol FROM stocks ORDER BY market_cap DESC`;
  const topSymbols = topRows.map((r) => String(r.symbol));
  console.log(`Step 2/3: Enriching ${topSymbols.length} stocks (3 API calls each)...`);

  let enriched = 0;
  let failed = 0;

  for (const sym of topSymbols) {
    try {
      const quote = await fetchFMP<Quote[]>(`/quote?symbol=${sym}`).then((r) => r?.[0] || null);
      const metrics = await fetchFMP<KeyMetrics[]>(`/key-metrics?symbol=${sym}&period=annual&limit=1`).then((r) => r?.[0] || null);
      const finRatios = await fetchFMP<FinancialRatios[]>(`/ratios?symbol=${sym}&period=annual&limit=1`).then((r) => r?.[0] || null);

      await sql`
        UPDATE stocks SET
          price = ${quote?.price || null},
          volume = ${quote?.volume || null},
          avg_volume = ${quote?.avgVolume || null},
          market_cap = ${quote?.marketCap || null},

          price_to_earnings_ratio = ${finRatios?.priceToEarningsRatio || quote?.pe || null},
          price_to_earnings_growth_ratio = ${finRatios?.priceToEarningsGrowthRatio || null},
          price_to_book_ratio = ${finRatios?.priceToBookRatio || null},
          price_to_sales_ratio = ${finRatios?.priceToSalesRatio || null},
          price_to_free_cash_flow_ratio = ${finRatios?.priceToFreeCashFlowRatio || null},
          price_to_operating_cash_flow_ratio = ${finRatios?.priceToOperatingCashFlowRatio || null},
          price_to_fair_value = ${finRatios?.priceToFairValue || null},
          enterprise_value_multiple = ${finRatios?.enterpriseValueMultiple || null},

          gross_profit_margin = ${finRatios?.grossProfitMargin || null},
          ebit_margin = ${finRatios?.ebitMargin || null},
          ebitda_margin = ${finRatios?.ebitdaMargin || null},
          operating_profit_margin = ${finRatios?.operatingProfitMargin || null},
          pretax_profit_margin = ${finRatios?.pretaxProfitMargin || null},
          net_profit_margin = ${finRatios?.netProfitMargin || null},
          effective_tax_rate = ${finRatios?.effectiveTaxRate || null},

          return_on_assets = ${metrics?.returnOnAssets || null},
          return_on_equity = ${metrics?.returnOnEquity || null},
          return_on_invested_capital = ${metrics?.returnOnInvestedCapital || null},
          return_on_capital_employed = ${metrics?.returnOnCapitalEmployed || null},
          earnings_yield = ${metrics?.earningsYield || null},
          free_cash_flow_yield = ${metrics?.freeCashFlowYield || null},

          current_ratio = ${metrics?.currentRatio || null},
          quick_ratio = ${finRatios?.quickRatio || null},
          cash_ratio = ${finRatios?.cashRatio || null},

          debt_to_equity_ratio = ${finRatios?.debtToEquityRatio || null},
          debt_to_assets_ratio = ${finRatios?.debtToAssetsRatio || null},
          debt_to_capital_ratio = ${finRatios?.debtToCapitalRatio || null},
          financial_leverage_ratio = ${finRatios?.financialLeverageRatio || null},
          debt_to_market_cap = ${finRatios?.debtToMarketCap || null},
          interest_coverage_ratio = ${finRatios?.interestCoverageRatio || null},

          dividend_yield = ${finRatios?.dividendYield || null},
          dividend_yield_percentage = ${finRatios?.dividendYieldPercentage || null},
          dividend_payout_ratio = ${finRatios?.dividendPayoutRatio || null},

          revenue_per_share = ${finRatios?.revenuePerShare || null},
          net_income_per_share = ${finRatios?.netIncomePerShare || null},
          book_value_per_share = ${finRatios?.bookValuePerShare || null},
          tangible_book_value_per_share = ${finRatios?.tangibleBookValuePerShare || null},
          operating_cash_flow_per_share = ${finRatios?.operatingCashFlowPerShare || null},
          free_cash_flow_per_share = ${finRatios?.freeCashFlowPerShare || null},
          cash_per_share = ${finRatios?.cashPerShare || null},

          asset_turnover = ${finRatios?.assetTurnover || null},
          inventory_turnover = ${finRatios?.inventoryTurnover || null},
          receivables_turnover = ${finRatios?.receivablesTurnover || null},
          days_of_sales_outstanding = ${finRatios?.daysOfSalesOutstanding || null},
          days_of_inventory_outstanding = ${finRatios?.daysOfInventoryOutstanding || null},
          days_of_payables_outstanding = ${finRatios?.daysOfPayablesOutstanding || null},
          cash_conversion_cycle = ${finRatios?.cashConversionCycle || null},

          enterprise_value = ${metrics?.enterpriseValue || null},
          ev_to_sales = ${metrics?.evToSales || null},
          ev_to_ebitda = ${metrics?.evToEBITDA || null},
          ev_to_operating_cash_flow = ${metrics?.evToOperatingCashFlow || null},
          ev_to_free_cash_flow = ${metrics?.evToFreeCashFlow || null},
          net_debt_to_ebitda = ${metrics?.netDebtToEBITDA || null},

          capex_to_revenue = ${metrics?.capexToRevenue || null},
          operating_cash_flow_sales_ratio = ${finRatios?.operatingCashFlowSalesRatio || null},
          free_cash_flow_operating_cash_flow_ratio = ${finRatios?.freeCashFlowOperatingCashFlowRatio || null},
          income_quality = ${metrics?.incomeQuality || null},

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
      if (enriched % 25 === 0) console.log(`  Enriched ${enriched}/${topSymbols.length}...`);
    } catch (e) {
      failed++;
      console.error(`  Error enriching ${sym}:`, e instanceof Error ? e.message : e);
    }
  }

  console.log(`  Enriched ${enriched} stocks (${failed} failed)`);
}

// ---------------------------------------------------------------------------
// Step 4: Record metadata
// ---------------------------------------------------------------------------

async function recordMeta() {
  console.log("Step 3/3: Recording metadata...");
  const timestamp = new Date().toISOString();
  await sql`
    INSERT INTO stock_meta (key, value, updated_at)
    VALUES (${'last_populate'}, ${timestamp}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `;

  const countResult = await sql`SELECT count(*) as cnt FROM stocks`;
  const peCount = await sql`SELECT count(*) as cnt FROM stocks WHERE price_to_earnings_ratio IS NOT NULL`;
  const roeCount = await sql`SELECT count(*) as cnt FROM stocks WHERE return_on_equity IS NOT NULL`;
  const divCount = await sql`SELECT count(*) as cnt FROM stocks WHERE dividend_yield IS NOT NULL`;

  console.log("\nPopulation complete:");
  console.log(`  stocks:       ${countResult[0].cnt}`);
  console.log(`  with PE:      ${peCount[0].cnt}`);
  console.log(`  with ROE:     ${roeCount[0].cnt}`);
  console.log(`  with div yld: ${divCount[0].cnt}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== Stock Database Population (Unified Table) ===\n");
  const start = Date.now();

  await ensureTables();
  await populateStocks();
  await enrichAllStocks();
  await recordMeta();

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsed}s`);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
