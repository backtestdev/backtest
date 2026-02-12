/**
 * Admin endpoint to refresh the stock database using bulk FMP API calls.
 *
 * POST /api/admin/refresh-data — Protected by x-admin-secret header.
 *
 * Strategy:
 *   1. Create stocks_new table
 *   2. Fetch stock screener (1 API call) → INSERT into stocks_new
 *   3. Wait 10s, fetch ratios-ttm-bulk (1 API call) → UPDATE stocks_new
 *   4. Wait 10s, fetch key-metrics-ttm-bulk (1 API call) → UPDATE stocks_new
 *   5. Swap: stocks → stocks_old, stocks_new → stocks
 *   6. Log verification counts
 *
 * Total: 3 API calls instead of thousands.
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

async function fetchFMP<T>(endpoint: string, retries = 2): Promise<T | null> {
  const sep = endpoint.includes("?") ? "&" : "?";
  const url = `${FMP_BASE}${endpoint}${sep}apikey=${FMP_API_KEY}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
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
    if (data && typeof data === "object" && "Error Message" in data) {
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

// Name patterns that indicate funds, trusts, SPACs, etc. — NOT operating companies
const EXCLUDE_NAME_PATTERNS = /\b(ETF|ETN|Exchange.Traded|Index Fund|Mutual Fund|Bond Fund|Income Fund|Money Market|Closed.End|Acquisition Corp|Blank Check|SPAC|Special Purpose|Statutory Trust|Capital Trust|Investment Trust|Depositary Shares?|Depositary Receipt|Preferred Shares?|Preferred Stock|Preferred Securities|Fixed.Income)\b|\bTrust [IVX]+\b|\d+\.?\d*% |\bRights$|\bWarrants?$/i;

// ── Field mapping helpers ──────────────────────────────────────────

/**
 * Maps a bulk API field name to the corresponding stocks_new column name.
 * Strips "TTM" suffix and converts camelCase to snake_case.
 */
function bulkFieldToColumn(field: string): string {
  // Strip TTM suffix
  let name = field.replace(/TTM$/, "");
  // Convert camelCase to snake_case
  name = name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  return name;
}

/**
 * Mapping from ratios-ttm-bulk fields (after stripping TTM and converting to snake_case)
 * to the actual column names in our stocks_new table.
 * Only includes fields where the auto-conversion doesn't match the column name.
 */
const RATIOS_FIELD_OVERRIDES: Record<string, string> = {
  "pe_ratio": "price_to_earnings_ratio",
  "price_to_earnings_ratio": "price_to_earnings_ratio",
  "price_to_earnings_growth_ratio": "price_to_earnings_growth_ratio",
  "price_to_book_ratio": "price_to_book_ratio",
  "price_to_sales_ratio": "price_to_sales_ratio",
  "price_to_free_cash_flow_ratio": "price_to_free_cash_flow_ratio",
  "price_to_operating_cash_flow_ratio": "price_to_operating_cash_flow_ratio",
  "price_to_fair_value": "price_to_fair_value",
  "enterprise_value_multiple": "enterprise_value_multiple",
  "gross_profit_margin": "gross_profit_margin",
  "ebit_margin": "ebit_margin",
  "ebitda_margin": "ebitda_margin",
  "operating_profit_margin": "operating_profit_margin",
  "pretax_profit_margin": "pretax_profit_margin",
  "net_profit_margin": "net_profit_margin",
  "effective_tax_rate": "effective_tax_rate",
  "current_ratio": "current_ratio",
  "quick_ratio": "quick_ratio",
  "cash_ratio": "cash_ratio",
  "debt_to_equity_ratio": "debt_to_equity_ratio",
  "debt_to_assets_ratio": "debt_to_assets_ratio",
  "debt_to_capital_ratio": "debt_to_capital_ratio",
  "financial_leverage_ratio": "financial_leverage_ratio",
  "debt_to_market_cap": "debt_to_market_cap",
  "interest_coverage_ratio": "interest_coverage_ratio",
  "dividend_yield": "dividend_yield",
  "dividend_yield_percentage": "dividend_yield_percentage",
  "dividend_payout_ratio": "dividend_payout_ratio",
  "revenue_per_share": "revenue_per_share",
  "net_income_per_share": "net_income_per_share",
  "book_value_per_share": "book_value_per_share",
  "tangible_book_value_per_share": "tangible_book_value_per_share",
  "operating_cash_flow_per_share": "operating_cash_flow_per_share",
  "free_cash_flow_per_share": "free_cash_flow_per_share",
  "cash_per_share": "cash_per_share",
  "asset_turnover": "asset_turnover",
  "inventory_turnover": "inventory_turnover",
  "receivables_turnover": "receivables_turnover",
  "days_of_sales_outstanding": "days_of_sales_outstanding",
  "days_of_inventory_outstanding": "days_of_inventory_outstanding",
  "days_of_payables_outstanding": "days_of_payables_outstanding",
  "cash_conversion_cycle": "cash_conversion_cycle",
  "operating_cash_flow_sales_ratio": "operating_cash_flow_sales_ratio",
  "free_cash_flow_operating_cash_flow_ratio": "free_cash_flow_operating_cash_flow_ratio",
  "price_earnings_ratio": "price_to_earnings_ratio",
  "long_term_debt_to_capital_ratio": "debt_to_capital_ratio",
  "income_quality": "income_quality",
  "earnings_yield": "earnings_yield",
  "free_cash_flow_yield": "free_cash_flow_yield",
  "return_on_assets": "return_on_assets",
  "return_on_equity": "return_on_equity",
  "return_on_invested_capital": "return_on_invested_capital",
  "return_on_capital_employed": "return_on_capital_employed",
  "capex_to_revenue": "capex_to_revenue",
  "graham_number": "graham_number",
  "net_debt_to_e_b_i_t_d_a": "net_debt_to_ebitda",
  "ev_to_sales": "ev_to_sales",
  "ev_to_e_b_i_t_d_a": "ev_to_ebitda",
  "ev_to_operating_cash_flow": "ev_to_operating_cash_flow",
  "ev_to_free_cash_flow": "ev_to_free_cash_flow",
  "research_and_developement_to_revenue": "research_and_development_to_revenue",
  "stock_based_compensation_to_revenue": "stock_based_compensation_to_revenue",
};

// All valid column names in the stocks_new table (for validation)
const VALID_COLUMNS = new Set([
  "symbol", "company_name", "exchange", "sector", "industry", "country",
  "market_cap", "price", "beta", "volume", "avg_volume", "last_dividend",
  "ipo_date", "is_etf", "is_fund", "is_actively_trading", "description",
  "full_time_employees",
  "price_to_earnings_ratio", "price_to_earnings_growth_ratio",
  "price_to_book_ratio", "price_to_sales_ratio",
  "price_to_free_cash_flow_ratio", "price_to_operating_cash_flow_ratio",
  "price_to_fair_value", "enterprise_value_multiple",
  "gross_profit_margin", "ebit_margin", "ebitda_margin",
  "operating_profit_margin", "pretax_profit_margin", "net_profit_margin",
  "effective_tax_rate",
  "return_on_assets", "return_on_equity", "return_on_invested_capital",
  "return_on_capital_employed", "earnings_yield", "free_cash_flow_yield",
  "current_ratio", "quick_ratio", "cash_ratio",
  "debt_to_equity_ratio", "debt_to_assets_ratio", "debt_to_capital_ratio",
  "financial_leverage_ratio", "debt_to_market_cap", "interest_coverage_ratio",
  "dividend_yield", "dividend_yield_percentage", "dividend_payout_ratio",
  "revenue_per_share", "net_income_per_share", "book_value_per_share",
  "tangible_book_value_per_share", "operating_cash_flow_per_share",
  "free_cash_flow_per_share", "cash_per_share",
  "asset_turnover", "inventory_turnover", "receivables_turnover",
  "days_of_sales_outstanding", "days_of_inventory_outstanding",
  "days_of_payables_outstanding", "cash_conversion_cycle",
  "enterprise_value", "ev_to_sales", "ev_to_ebitda",
  "ev_to_operating_cash_flow", "ev_to_free_cash_flow", "net_debt_to_ebitda",
  "capex_to_revenue", "free_cash_flow_operating_cash_flow_ratio",
  "operating_cash_flow_sales_ratio", "income_quality",
  "graham_number", "working_capital", "invested_capital", "tangible_asset_value",
  "research_and_development_to_revenue", "stock_based_compensation_to_revenue",
]);

/**
 * Resolves a bulk API field name to a valid column name, or null if no match.
 */
function resolveColumn(apiField: string): string | null {
  if (apiField === "symbol") return null; // Don't update symbol
  const snaked = bulkFieldToColumn(apiField);
  // Check override first
  if (RATIOS_FIELD_OVERRIDES[snaked] && VALID_COLUMNS.has(RATIOS_FIELD_OVERRIDES[snaked])) {
    return RATIOS_FIELD_OVERRIDES[snaked];
  }
  // Direct match
  if (VALID_COLUMNS.has(snaked)) {
    return snaked;
  }
  return null;
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
    // ── Step 1: Create stocks_new table ──────────────────────────
    log.push("Creating stocks_new table...");
    await createStocksNewTable(sql);

    // ── Step 2a: Fetch stock screener ────────────────────────────
    log.push("Fetching stock screener...");
    const screenerResults = await fetchFMP<ScreenerResult[]>(
      "/stock-screener?country=US&isEtf=false&isActivelyTrading=true&limit=10000"
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
        !EXCLUDE_NAME_PATTERNS.test(s.companyName)
    );
    log.push(`Screener: ${screenerResults.length} total → ${filtered.length} filtered companies`);

    // Insert all into stocks_new
    let insertedCount = 0;
    // Batch insert in chunks of 50 for efficiency
    for (let i = 0; i < filtered.length; i += 50) {
      const batch = filtered.slice(i, i + 50);
      for (const s of batch) {
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
    }
    log.push(`Inserted/updated ${insertedCount} stocks into stocks_new`);

    // ── Step 2b: Wait 10s, then fetch Ratios TTM Bulk ────────────
    log.push("Waiting 10 seconds before ratios-ttm-bulk call...");
    await sleep(10000);

    log.push("Fetching ratios-ttm-bulk...");
    const ratiosBulk = await fetchFMP<Record<string, unknown>[]>("/ratios-ttm-bulk");

    if (ratiosBulk && ratiosBulk.length > 0) {
      log.push(`Ratios TTM bulk: ${ratiosBulk.length} entries received`);
      let ratiosUpdated = 0;

      for (const entry of ratiosBulk) {
        const symbol = entry.symbol as string;
        if (!symbol) continue;

        // Build SET clause dynamically from available fields
        const updates: Record<string, number> = {};
        for (const [key, value] of Object.entries(entry)) {
          if (key === "symbol") continue;
          const col = resolveColumn(key);
          if (col && value != null && typeof value === "number" && Number.isFinite(value)) {
            updates[col] = value;
          }
        }

        if (Object.keys(updates).length === 0) continue;

        // Build dynamic UPDATE query
        // We need to use raw SQL for dynamic column updates
        const setClauses = Object.entries(updates)
          .map(([col, val]) => `${col} = ${val}`)
          .join(", ");

        try {
          await (sql as unknown as (q: string, p: unknown[]) => Promise<unknown>)(
            `UPDATE stocks_new SET ${setClauses}, updated_at = NOW() WHERE symbol = $1`,
            [symbol]
          );
          ratiosUpdated++;
        } catch {
          // Symbol not in our screened list — skip
        }
      }
      log.push(`Ratios TTM: updated ${ratiosUpdated} stocks`);
    } else {
      log.push("WARNING: ratios-ttm-bulk returned no data");
    }

    // ── Step 2c: Wait 10s, then fetch Key Metrics TTM Bulk ───────
    log.push("Waiting 10 seconds before key-metrics-ttm-bulk call...");
    await sleep(10000);

    log.push("Fetching key-metrics-ttm-bulk...");
    const metricsBulk = await fetchFMP<Record<string, unknown>[]>("/key-metrics-ttm-bulk");

    if (metricsBulk && metricsBulk.length > 0) {
      log.push(`Key Metrics TTM bulk: ${metricsBulk.length} entries received`);
      let metricsUpdated = 0;

      for (const entry of metricsBulk) {
        const symbol = entry.symbol as string;
        if (!symbol) continue;

        const updates: Record<string, number> = {};
        for (const [key, value] of Object.entries(entry)) {
          if (key === "symbol") continue;
          const col = resolveColumn(key);
          if (col && value != null && typeof value === "number" && Number.isFinite(value)) {
            updates[col] = value;
          }
        }

        if (Object.keys(updates).length === 0) continue;

        const setClauses = Object.entries(updates)
          .map(([col, val]) => `${col} = ${val}`)
          .join(", ");

        try {
          await (sql as unknown as (q: string, p: unknown[]) => Promise<unknown>)(
            `UPDATE stocks_new SET ${setClauses}, updated_at = NOW() WHERE symbol = $1`,
            [symbol]
          );
          metricsUpdated++;
        } catch {
          // Symbol not in our screened list — skip
        }
      }
      log.push(`Key Metrics TTM: updated ${metricsUpdated} stocks`);
    } else {
      log.push("WARNING: key-metrics-ttm-bulk returned no data");
    }

    // ── Step 2d: Swap tables ─────────────────────────────────────
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
