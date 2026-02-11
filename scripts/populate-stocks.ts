/**
 * One-time stock database population script.
 *
 * Fetches stock data from Financial Modeling Prep API and writes it into
 * PostgreSQL tables (stocks, quotes, ratios, profiles).
 *
 * FMP Starter plan: 300 req/min. We throttle to ~200 req/min with retry
 * on 429 to stay within limits.
 *
 * Budget: ~1500 stocks × 5 calls/stock × 300ms ≈ 37 min
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
  peRatio: number;
  pbRatio: number;
  priceToSalesRatio: number;
  debtToEquity: number;
  currentRatio: number;
  roe: number;
  roic: number;
  dividendYield: number;
  payoutRatio: number;
  freeCashFlowPerShare: number;
  revenuePerShare: number;
  netIncomePerShare: number;
  earningsYield: number;
  evToSales: number;
  enterpriseValue: number;
}

interface GrowthData {
  date: string;
  period: string; // "FY", "Q1", "Q2", "Q3", "Q4"
  revenueGrowth: number;
  netIncomeGrowth: number;
  dividendsperShareGrowth: number;
}

interface IncomeData {
  netIncomeRatio: number;
}

// ---------------------------------------------------------------------------
// Step 1: Fetch screener → insert stocks
// ---------------------------------------------------------------------------

async function populateStocks(): Promise<string[]> {
  console.log("Step 1/3: Fetching stock screener...");
  const results = await fetchFMP<ScreenerResult[]>(
    "/company-screener?marketCapMoreThan=300000000&isEtf=false&isFund=false&isActivelyTrading=true&exchange=NYSE,NASDAQ&limit=3000"
  );

  if (!results || results.length === 0) {
    throw new Error("Screener returned no results");
  }

  // Filter: common stocks only (no ETFs, funds, or sectorless instruments)
  const filtered = results.filter(
    (s) =>
      s.marketCap > 0 &&
      !s.symbol.includes(".") &&
      s.symbol.length <= 5 &&
      !s.isEtf &&
      !s.isFund &&
      s.sector &&
      s.sector.trim() !== ""
  );
  console.log(`  ${results.length} screener results → ${filtered.length} common stocks`);

  for (const s of filtered) {
    await sql`
      INSERT INTO stocks (symbol, company_name, sector, industry, country, exchange, exchange_short_name, market_cap, beta, last_annual_dividend, is_etf, is_actively_trading, updated_at)
      VALUES (${s.symbol}, ${s.companyName}, ${s.sector}, ${s.industry}, ${s.country}, ${s.exchange}, ${s.exchangeShortName}, ${s.marketCap}, ${s.beta || 0}, ${s.lastAnnualDividend || 0}, ${s.isEtf}, ${s.isActivelyTrading}, NOW())
      ON CONFLICT (symbol) DO UPDATE SET
        company_name = EXCLUDED.company_name, sector = EXCLUDED.sector, industry = EXCLUDED.industry,
        country = EXCLUDED.country, exchange = EXCLUDED.exchange, exchange_short_name = EXCLUDED.exchange_short_name,
        market_cap = EXCLUDED.market_cap, beta = EXCLUDED.beta, last_annual_dividend = EXCLUDED.last_annual_dividend,
        is_etf = EXCLUDED.is_etf, is_actively_trading = EXCLUDED.is_actively_trading, updated_at = NOW()
    `;
  }

  console.log(`  Inserted/updated ${filtered.length} stocks`);
  return filtered.map((s) => s.symbol);
}

// ---------------------------------------------------------------------------
// Step 2: Enrich ALL stocks with quote + key-metrics + growth + income
// 5 API calls per stock, sequential, rate-limited
// ---------------------------------------------------------------------------

async function enrichTopStocks() {
  const topRows = await sql`SELECT symbol FROM stocks ORDER BY market_cap DESC`;
  const topSymbols = topRows.map((r) => String(r.symbol));
  console.log(`Step 2/3: Enriching ${topSymbols.length} top stocks (5 API calls each)...`);

  let enriched = 0;
  let failed = 0;

  for (const sym of topSymbols) {
    try {
      // 5 sequential calls per stock, each throttled
      const quote = await fetchFMP<Quote[]>(`/quote?symbol=${sym}`).then((r) => r?.[0] || null);
      const metrics = await fetchFMP<KeyMetrics[]>(`/key-metrics?symbol=${sym}&period=annual&limit=1`).then((r) => r?.[0] || null);
      const annualGrowth = await fetchFMP<GrowthData[]>(`/financial-growth?symbol=${sym}&period=annual&limit=8`).then((r) => r || []);
      const quarterlyGrowth = await fetchFMP<GrowthData[]>(`/financial-growth?symbol=${sym}&period=quarter&limit=8`).then((r) => r || []);
      const income = await fetchFMP<IncomeData[]>(`/income-statement?symbol=${sym}&period=annual&limit=1`).then((r) => r || []);

      // Quotes table
      if (quote) {
        await sql`
          INSERT INTO quotes (symbol, price, changes_percentage, day_low, day_high, year_high, year_low, market_cap, price_avg_50, price_avg_200, volume, avg_volume, eps, pe, shares_outstanding, updated_at)
          VALUES (${sym}, ${quote.price || 0}, ${quote.changesPercentage || 0}, ${quote.dayLow || 0}, ${quote.dayHigh || 0}, ${quote.yearHigh || 0}, ${quote.yearLow || 0}, ${quote.marketCap || 0}, ${quote.priceAvg50 || 0}, ${quote.priceAvg200 || 0}, ${quote.volume || 0}, ${quote.avgVolume || 0}, ${quote.eps || 0}, ${quote.pe || 0}, ${quote.sharesOutstanding || 0}, NOW())
          ON CONFLICT (symbol) DO UPDATE SET
            price = EXCLUDED.price, changes_percentage = EXCLUDED.changes_percentage,
            day_low = EXCLUDED.day_low, day_high = EXCLUDED.day_high,
            year_high = EXCLUDED.year_high, year_low = EXCLUDED.year_low,
            market_cap = EXCLUDED.market_cap, price_avg_50 = EXCLUDED.price_avg_50,
            price_avg_200 = EXCLUDED.price_avg_200, volume = EXCLUDED.volume,
            avg_volume = EXCLUDED.avg_volume, eps = EXCLUDED.eps, pe = EXCLUDED.pe,
            shares_outstanding = EXCLUDED.shares_outstanding, updated_at = NOW()
        `;
      }

      // Ratios table — use key-metrics, fall back to quote for PE
      const peRatio = metrics?.peRatio || quote?.pe || 0;
      await sql`
        INSERT INTO ratios (symbol, pe_ratio, pb_ratio, price_to_sales_ratio, debt_to_equity, current_ratio, roe, roic, dividend_yield, payout_ratio, free_cash_flow_per_share, revenue_per_share, net_income_per_share, earnings_yield, ev_to_sales, enterprise_value, updated_at)
        VALUES (${sym}, ${peRatio}, ${metrics?.pbRatio || 0}, ${metrics?.priceToSalesRatio || 0}, ${metrics?.debtToEquity || 0}, ${metrics?.currentRatio || 0}, ${metrics?.roe || 0}, ${metrics?.roic || 0}, ${metrics?.dividendYield || 0}, ${metrics?.payoutRatio || 0}, ${metrics?.freeCashFlowPerShare || 0}, ${metrics?.revenuePerShare || 0}, ${metrics?.netIncomePerShare || 0}, ${metrics?.earningsYield || 0}, ${metrics?.evToSales || 0}, ${metrics?.enterpriseValue || 0}, NOW())
        ON CONFLICT (symbol) DO UPDATE SET
          pe_ratio = EXCLUDED.pe_ratio, pb_ratio = EXCLUDED.pb_ratio, price_to_sales_ratio = EXCLUDED.price_to_sales_ratio,
          debt_to_equity = EXCLUDED.debt_to_equity, current_ratio = EXCLUDED.current_ratio, roe = EXCLUDED.roe, roic = EXCLUDED.roic,
          dividend_yield = EXCLUDED.dividend_yield, payout_ratio = EXCLUDED.payout_ratio, free_cash_flow_per_share = EXCLUDED.free_cash_flow_per_share,
          revenue_per_share = EXCLUDED.revenue_per_share, net_income_per_share = EXCLUDED.net_income_per_share,
          earnings_yield = EXCLUDED.earnings_yield, ev_to_sales = EXCLUDED.ev_to_sales, enterprise_value = EXCLUDED.enterprise_value, updated_at = NOW()
      `;

      // Profiles table — derive growth stats
      // Quarterly: period is "Q1","Q2","Q3","Q4" in /stable/ API (NOT "Q")
      const sortedQ = [...quarterlyGrowth]
        .filter((g) => g.period.startsWith("Q"))
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      let revQ = 0;
      for (const g of sortedQ) { if (g.revenueGrowth > 0) revQ++; else break; }
      let niQ = 0;
      for (const g of sortedQ) { if (g.netIncomeGrowth > 0) niQ++; else break; }

      // Annual: dividend growth years + recent annual growth rate
      const sortedA = [...annualGrowth]
        .filter((g) => g.period === "FY")
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      let divYrs = 0;
      for (const g of sortedA) { if (g.dividendsperShareGrowth > 0) divYrs++; else break; }
      const recentAnnual = sortedA[0];

      await sql`
        INSERT INTO profiles (symbol, revenue_growth, net_income_growth, earnings_growth, revenue_growth_quarters, net_income_growth_quarters, dividend_growth_years, profit_margin, historical_returns, updated_at)
        VALUES (${sym}, ${recentAnnual?.revenueGrowth || 0}, ${recentAnnual?.netIncomeGrowth || 0}, ${recentAnnual?.netIncomeGrowth || 0}, ${revQ}, ${niQ}, ${divYrs}, ${income[0]?.netIncomeRatio || 0}, ${'{}'}, NOW())
        ON CONFLICT (symbol) DO UPDATE SET
          revenue_growth = EXCLUDED.revenue_growth, net_income_growth = EXCLUDED.net_income_growth,
          earnings_growth = EXCLUDED.earnings_growth, revenue_growth_quarters = EXCLUDED.revenue_growth_quarters,
          net_income_growth_quarters = EXCLUDED.net_income_growth_quarters, dividend_growth_years = EXCLUDED.dividend_growth_years,
          profit_margin = EXCLUDED.profit_margin, updated_at = NOW()
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
// Step 3: Record metadata
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
  const quotesResult = await sql`SELECT count(*) as cnt FROM quotes`;
  const ratiosResult = await sql`SELECT count(*) as cnt FROM ratios`;
  const profilesResult = await sql`SELECT count(*) as cnt FROM profiles`;

  console.log("\nPopulation complete:");
  console.log(`  stocks:   ${countResult[0].cnt}`);
  console.log(`  quotes:   ${quotesResult[0].cnt}`);
  console.log(`  ratios:   ${ratiosResult[0].cnt}`);
  console.log(`  profiles: ${profilesResult[0].cnt}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== Stock Database Population ===\n");
  const start = Date.now();

  await populateStocks();
  await enrichTopStocks();
  await recordMeta();

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsed}s`);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
