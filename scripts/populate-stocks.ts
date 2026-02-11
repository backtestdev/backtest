/**
 * One-time stock database population script.
 *
 * Fetches stock data from Financial Modeling Prep API and writes it into
 * PostgreSQL tables (stocks, quotes, ratios, profiles).
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
// FMP fetch helper
// ---------------------------------------------------------------------------

async function fetchFMP<T>(endpoint: string): Promise<T | null> {
  const url = `${FMP_BASE}${endpoint}${endpoint.includes("?") ? "&" : "?"}apikey=${FMP_API_KEY}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) {
      console.error(`  FMP ${res.status} for ${endpoint}`);
      return null;
    }
    const data = await res.json();
    if (data && typeof data === "object" && "Error Message" in data) {
      console.error(`  FMP error: ${data["Error Message"]}`);
      return null;
    }
    return data as T;
  } catch (e) {
    console.error(`  FMP network error for ${endpoint}:`, e instanceof Error ? e.message : e);
    return null;
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Types (mirrors FMP response shapes)
// ---------------------------------------------------------------------------

interface FMPScreenerResult {
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
  isActivelyTrading: boolean;
}

interface FMPQuote {
  symbol: string;
  name: string;
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

interface FMPKeyMetrics {
  symbol: string;
  pbRatio: number;
  peRatio: number;
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

interface FMPFinancialGrowth {
  symbol: string;
  date: string;
  period: string;
  revenueGrowth: number;
  netIncomeGrowth: number;
  epsgrowth: number;
  dividendsperShareGrowth: number;
}

interface FMPIncomeStatement {
  symbol: string;
  netIncomeRatio: number;
}

// ---------------------------------------------------------------------------
// Step 1: Fetch screener → insert stocks
// ---------------------------------------------------------------------------

async function populateStocks(): Promise<string[]> {
  console.log("Step 1/4: Fetching stock screener...");
  const results = await fetchFMP<FMPScreenerResult[]>(
    "/company-screener?marketCapMoreThan=300000000&isEtf=false&isActivelyTrading=true&exchange=NYSE,NASDAQ&limit=3000"
  );

  if (!results || results.length === 0) {
    throw new Error("Screener returned no results");
  }

  const filtered = results.filter(
    (s) => s.marketCap > 0 && !s.symbol.includes(".") && s.symbol.length <= 5 && !s.isEtf
  );
  console.log(`  Found ${filtered.length} common stocks`);

  // Upsert individually using tagged templates (neon auto-parameterizes)
  for (const s of filtered) {
    await sql`
      INSERT INTO stocks (symbol, company_name, sector, industry, country, exchange, exchange_short_name, market_cap, beta, last_annual_dividend, is_etf, is_actively_trading, updated_at)
      VALUES (${s.symbol}, ${s.companyName}, ${s.sector}, ${s.industry}, ${s.country}, ${s.exchange}, ${s.exchangeShortName}, ${s.marketCap}, ${s.beta || 0}, ${s.lastAnnualDividend || 0}, ${s.isEtf}, ${s.isActivelyTrading}, NOW())
      ON CONFLICT (symbol) DO UPDATE SET
        company_name = EXCLUDED.company_name,
        sector = EXCLUDED.sector,
        industry = EXCLUDED.industry,
        country = EXCLUDED.country,
        exchange = EXCLUDED.exchange,
        exchange_short_name = EXCLUDED.exchange_short_name,
        market_cap = EXCLUDED.market_cap,
        beta = EXCLUDED.beta,
        last_annual_dividend = EXCLUDED.last_annual_dividend,
        is_etf = EXCLUDED.is_etf,
        is_actively_trading = EXCLUDED.is_actively_trading,
        updated_at = NOW()
    `;
  }

  console.log(`  Inserted/updated ${filtered.length} stocks`);
  return filtered.map((s) => s.symbol);
}

// ---------------------------------------------------------------------------
// Step 2: Fetch batch quotes → insert quotes
// ---------------------------------------------------------------------------

async function populateQuotes(symbols: string[]) {
  console.log("Step 2/4: Fetching batch quotes...");
  const BATCH = 100;
  let count = 0;

  for (let i = 0; i < Math.min(symbols.length, 2000); i += BATCH) {
    const batch = symbols.slice(i, i + BATCH);
    const joined = batch.join(",");
    const quotes = await fetchFMP<FMPQuote[]>(`/batch-quote?symbols=${joined}`);

    if (!quotes) {
      console.warn(`  Skipping quote batch at ${i}`);
      continue;
    }

    for (const q of quotes) {
      await sql`
        INSERT INTO quotes (symbol, price, changes_percentage, day_low, day_high, year_high, year_low, market_cap, price_avg_50, price_avg_200, volume, avg_volume, eps, pe, shares_outstanding, updated_at)
        VALUES (${q.symbol}, ${q.price || 0}, ${q.changesPercentage || 0}, ${q.dayLow || 0}, ${q.dayHigh || 0}, ${q.yearHigh || 0}, ${q.yearLow || 0}, ${q.marketCap || 0}, ${q.priceAvg50 || 0}, ${q.priceAvg200 || 0}, ${q.volume || 0}, ${q.avgVolume || 0}, ${q.eps || 0}, ${q.pe || 0}, ${q.sharesOutstanding || 0}, NOW())
        ON CONFLICT (symbol) DO UPDATE SET
          price = EXCLUDED.price,
          changes_percentage = EXCLUDED.changes_percentage,
          day_low = EXCLUDED.day_low,
          day_high = EXCLUDED.day_high,
          year_high = EXCLUDED.year_high,
          year_low = EXCLUDED.year_low,
          market_cap = EXCLUDED.market_cap,
          price_avg_50 = EXCLUDED.price_avg_50,
          price_avg_200 = EXCLUDED.price_avg_200,
          volume = EXCLUDED.volume,
          avg_volume = EXCLUDED.avg_volume,
          eps = EXCLUDED.eps,
          pe = EXCLUDED.pe,
          shares_outstanding = EXCLUDED.shares_outstanding,
          updated_at = NOW()
      `;
      count++;
    }

    if (i + BATCH < symbols.length) await sleep(200);
  }

  console.log(`  Inserted/updated ${count} quotes`);
}

// ---------------------------------------------------------------------------
// Step 3: Enrich top 300 with key metrics + growth + income → ratios + profiles
// ---------------------------------------------------------------------------

async function enrichTopStocks() {
  // Sort by market cap from stocks table to get top 300
  const topRows = await sql`SELECT symbol FROM stocks ORDER BY market_cap DESC LIMIT 300`;
  const topSymbols = topRows.map((r) => String(r.symbol));
  console.log(`Step 3/4: Enriching ${topSymbols.length} top stocks with detailed metrics...`);

  const BATCH = 5;
  let enriched = 0;

  for (let i = 0; i < topSymbols.length; i += BATCH) {
    const batch = topSymbols.slice(i, i + BATCH);

    await Promise.all(
      batch.map(async (sym) => {
        try {
          const [metrics, growth, income] = await Promise.all([
            fetchFMP<FMPKeyMetrics[]>(`/key-metrics?symbol=${sym}&period=annual&limit=1`).then((r) => r?.[0] || null),
            fetchFMP<FMPFinancialGrowth[]>(`/financial-growth?symbol=${sym}&period=quarter&limit=8`).then((r) => r || []),
            fetchFMP<FMPIncomeStatement[]>(`/income-statement?symbol=${sym}&period=annual&limit=1`).then((r) => r || []),
          ]);

          // Upsert ratios
          if (metrics) {
            await sql`
              INSERT INTO ratios (symbol, pe_ratio, pb_ratio, price_to_sales_ratio, debt_to_equity, current_ratio, roe, roic, dividend_yield, payout_ratio, free_cash_flow_per_share, revenue_per_share, net_income_per_share, earnings_yield, ev_to_sales, enterprise_value, updated_at)
              VALUES (${sym}, ${metrics.peRatio || 0}, ${metrics.pbRatio || 0}, ${metrics.priceToSalesRatio || 0}, ${metrics.debtToEquity || 0}, ${metrics.currentRatio || 0}, ${metrics.roe || 0}, ${metrics.roic || 0}, ${metrics.dividendYield || 0}, ${metrics.payoutRatio || 0}, ${metrics.freeCashFlowPerShare || 0}, ${metrics.revenuePerShare || 0}, ${metrics.netIncomePerShare || 0}, ${metrics.earningsYield || 0}, ${metrics.evToSales || 0}, ${metrics.enterpriseValue || 0}, NOW())
              ON CONFLICT (symbol) DO UPDATE SET
                pe_ratio = EXCLUDED.pe_ratio,
                pb_ratio = EXCLUDED.pb_ratio,
                price_to_sales_ratio = EXCLUDED.price_to_sales_ratio,
                debt_to_equity = EXCLUDED.debt_to_equity,
                current_ratio = EXCLUDED.current_ratio,
                roe = EXCLUDED.roe,
                roic = EXCLUDED.roic,
                dividend_yield = EXCLUDED.dividend_yield,
                payout_ratio = EXCLUDED.payout_ratio,
                free_cash_flow_per_share = EXCLUDED.free_cash_flow_per_share,
                revenue_per_share = EXCLUDED.revenue_per_share,
                net_income_per_share = EXCLUDED.net_income_per_share,
                earnings_yield = EXCLUDED.earnings_yield,
                ev_to_sales = EXCLUDED.ev_to_sales,
                enterprise_value = EXCLUDED.enterprise_value,
                updated_at = NOW()
            `;
          }

          // Compute growth stats
          const revenueGrowthQ = consecutivePositive(growth, "revenueGrowth");
          const netIncomeGrowthQ = consecutivePositive(growth, "netIncomeGrowth");
          const divGrowthYears = dividendGrowthYears(growth);
          const recentGrowth = growth.find((g) => g.period === "FY") || growth[0];
          const profitMargin = income[0]?.netIncomeRatio || 0;

          await sql`
            INSERT INTO profiles (symbol, revenue_growth, net_income_growth, earnings_growth, revenue_growth_quarters, net_income_growth_quarters, dividend_growth_years, profit_margin, historical_returns, updated_at)
            VALUES (${sym}, ${recentGrowth?.revenueGrowth || 0}, ${recentGrowth?.netIncomeGrowth || 0}, ${recentGrowth?.netIncomeGrowth || 0}, ${revenueGrowthQ}, ${netIncomeGrowthQ}, ${divGrowthYears}, ${profitMargin}, ${'{}'}, NOW())
            ON CONFLICT (symbol) DO UPDATE SET
              revenue_growth = EXCLUDED.revenue_growth,
              net_income_growth = EXCLUDED.net_income_growth,
              earnings_growth = EXCLUDED.earnings_growth,
              revenue_growth_quarters = EXCLUDED.revenue_growth_quarters,
              net_income_growth_quarters = EXCLUDED.net_income_growth_quarters,
              dividend_growth_years = EXCLUDED.dividend_growth_years,
              profit_margin = EXCLUDED.profit_margin,
              updated_at = NOW()
          `;

          enriched++;
        } catch (e) {
          console.error(`  Error enriching ${sym}:`, e instanceof Error ? e.message : e);
        }
      })
    );

    if (i + BATCH < topSymbols.length) await sleep(500);
    if (enriched % 50 === 0) console.log(`  Enriched ${enriched}/${topSymbols.length}...`);
  }

  console.log(`  Enriched ${enriched} stocks`);
}

// ---------------------------------------------------------------------------
// Step 4: Record metadata
// ---------------------------------------------------------------------------

async function recordMeta() {
  console.log("Step 4/4: Recording metadata...");
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
// Helpers
// ---------------------------------------------------------------------------

function consecutivePositive(
  data: FMPFinancialGrowth[],
  field: "revenueGrowth" | "netIncomeGrowth"
): number {
  const sorted = [...data]
    .filter((d) => d.period === "Q")
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  let count = 0;
  for (const item of sorted) {
    if (item[field] > 0) count++;
    else break;
  }
  return count;
}

function dividendGrowthYears(data: FMPFinancialGrowth[]): number {
  const annual = [...data]
    .filter((d) => d.period === "FY")
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  let years = 0;
  for (const item of annual) {
    if (item.dividendsperShareGrowth > 0) years++;
    else break;
  }
  return years;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== Stock Database Population ===\n");
  const start = Date.now();

  const symbols = await populateStocks();
  await populateQuotes(symbols);
  await enrichTopStocks();
  await recordMeta();

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsed}s`);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
