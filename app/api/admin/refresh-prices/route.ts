/**
 * Admin endpoint to populate historical annual returns and monthly prices
 * from Yahoo Finance.
 *
 * GET  /api/admin/refresh-prices - Vercel Cron handler (weekly)
 * POST /api/admin/refresh-prices - Manual trigger via admin UI
 *
 * Fetches 20+ years of monthly price data from Yahoo Finance for all
 * stocks in the database (plus SPY for benchmark), computes annual
 * returns, and stores them in stock_annual_returns. Also stores monthly
 * close prices in stock_prices (used by Signal Tracker charts).
 *
 * This is a separate step from refresh-data (FMP fundamentals) because:
 *   - Yahoo Finance is free with no API key required
 *   - It provides 20+ years of history vs FMP's 5-year limit
 *   - It can run independently and be re-run without affecting fundamentals
 *
 * Usage:
 *   curl -X POST http://localhost:3000/api/admin/refresh-prices \
 *     -H "x-admin-secret: $ADMIN_SECRET"
 */

import { NextRequest, NextResponse } from "next/server";
import { NeonQueryFunction, neon } from "@neondatabase/serverless";
import { fetchBulkAnnualReturns } from "@/lib/yahooFinance";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 minutes

// ── Core refresh logic ─────────────────────────────────────────────

async function runPriceRefresh(sql: NeonQueryFunction<false, false>) {
  const log: string[] = [];

  // Ensure table exists
  await sql`
    CREATE TABLE IF NOT EXISTS stock_annual_returns (
      symbol VARCHAR(10) NOT NULL,
      year INT NOT NULL,
      annual_return DECIMAL(10,6) NOT NULL,
      year_end_close DECIMAL(12,4),
      PRIMARY KEY (symbol, year)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_annual_returns_symbol ON stock_annual_returns(symbol)`;

  // Get all stock symbols from the database
  const symbolRows = await sql`
    SELECT symbol FROM stocks
    WHERE is_actively_trading = true AND is_etf = false
    ORDER BY market_cap DESC NULLS LAST
  `;

  const stockSymbols = symbolRows.map((r) => r.symbol as string);
  // Always include SPY for benchmark returns
  const allSymbols = ["SPY", ...stockSymbols.filter((s) => s !== "SPY")];

  log.push(`Found ${stockSymbols.length} stocks in database. Fetching Yahoo Finance data for ${allSymbols.length} symbols (including SPY)...`);

  // Fetch annual returns from Yahoo Finance
  let succeeded = 0;
  let failed = 0;
  const failedSymbols: string[] = [];

  const returns = await fetchBulkAnnualReturns(
    allSymbols,
    5, // concurrency
    21, // years of history
    (done, total, symbol, ok) => {
      if (ok) succeeded++;
      else {
        failed++;
        failedSymbols.push(symbol);
      }
      if (done % 100 === 0 || done === total) {
        log.push(`  Progress: ${done}/${total} (${succeeded} ok, ${failed} failed)`);
      }
    }
  );

  log.push(`Yahoo Finance fetch complete: ${succeeded} succeeded, ${failed} failed`);

  if (failedSymbols.length > 0 && failedSymbols.length <= 50) {
    log.push(`Failed symbols: ${failedSymbols.join(", ")}`);
  } else if (failedSymbols.length > 50) {
    log.push(`Failed symbols (first 50): ${failedSymbols.slice(0, 50).join(", ")}...`);
  }

  // Store results in database
  log.push("Writing annual returns to database...");

  // Clear existing data and insert new (batched for performance)
  await sql`DELETE FROM stock_annual_returns`;

  // Flatten all rows into a single array for batched inserts
  const allRows: { symbol: string; year: number; annualReturn: number; yearEndClose: number | null }[] = [];
  for (const [symbol, priceResult] of Array.from(returns.entries())) {
    for (const ret of priceResult.annualReturns) {
      allRows.push({ symbol, year: ret.year, annualReturn: ret.annualReturn, yearEndClose: ret.yearEndClose });
    }
  }

  let insertedRows = 0;
  const BATCH_SIZE = 500;
  for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
    const batch = allRows.slice(i, i + BATCH_SIZE);
    const placeholders = batch.map((_, idx) => {
      const b = idx * 4;
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4})`;
    }).join(", ");
    const params = batch.flatMap(r => [r.symbol, r.year, r.annualReturn, r.yearEndClose]);
    const query = `INSERT INTO stock_annual_returns (symbol, year, annual_return, year_end_close)
       VALUES ${placeholders}
       ON CONFLICT (symbol, year) DO UPDATE SET
         annual_return = EXCLUDED.annual_return,
         year_end_close = EXCLUDED.year_end_close`;
    await sql.query(query, params);
    insertedRows += batch.length;
  }

  log.push(`Inserted ${insertedRows} annual return records for ${returns.size} symbols`);

  // ── Store monthly prices in stock_prices ───────────────────────────
  log.push("Writing monthly prices to stock_prices...");

  // Ensure stock_prices table exists (matches db.ts schema: close_price)
  await sql`
    CREATE TABLE IF NOT EXISTS stock_prices (
      id SERIAL PRIMARY KEY,
      symbol VARCHAR(10) NOT NULL,
      date DATE NOT NULL,
      close_price DECIMAL(12,4) NOT NULL,
      UNIQUE(symbol, date)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_prices_symbol_date ON stock_prices(symbol, date)`;

  // Clear and re-insert
  await sql`DELETE FROM stock_prices`;

  const allPriceRows: { symbol: string; date: string; close: number }[] = [];
  for (const [symbol, priceResult] of Array.from(returns.entries())) {
    for (const mp of priceResult.monthlyPrices) {
      allPriceRows.push({ symbol, date: mp.date, close: mp.close });
    }
  }

  let insertedPrices = 0;
  for (let i = 0; i < allPriceRows.length; i += BATCH_SIZE) {
    const batch = allPriceRows.slice(i, i + BATCH_SIZE);
    const placeholders = batch.map((_, idx) => {
      const b = idx * 3;
      return `($${b + 1}, $${b + 2}, $${b + 3})`;
    }).join(", ");
    const params = batch.flatMap(r => [r.symbol, r.date, r.close]);
    const query = `INSERT INTO stock_prices (symbol, date, close_price)
       VALUES ${placeholders}
       ON CONFLICT (symbol, date) DO UPDATE SET close_price = EXCLUDED.close_price`;
    await sql.query(query, params);
    insertedPrices += batch.length;
  }

  log.push(`Inserted ${insertedPrices} monthly price records for ${returns.size} symbols`);

  // Update metadata
  await sql`
    CREATE TABLE IF NOT EXISTS stock_meta (
      key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  const timestamp = new Date().toISOString();
  await sql`
    INSERT INTO stock_meta (key, value, updated_at)
    VALUES ('last_price_refresh', ${timestamp}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `;

  // Verify SPY data
  const spyCheck = await sql`
    SELECT year, annual_return FROM stock_annual_returns
    WHERE symbol = 'SPY' ORDER BY year
  `;
  log.push(`SPY: ${spyCheck.length} years of data (${spyCheck.length > 0 ? spyCheck[0].year : '?'}-${spyCheck.length > 0 ? spyCheck[spyCheck.length - 1].year : '?'})`);

  // Verify a sample stock
  const aaplCheck = await sql`
    SELECT year, annual_return FROM stock_annual_returns
    WHERE symbol = 'AAPL' ORDER BY year
  `;
  log.push(`AAPL: ${aaplCheck.length} years of data`);
  if (aaplCheck.length > 0) {
    const last3 = aaplCheck.slice(-3).map(r => `${r.year}: ${(Number(r.annual_return) * 100).toFixed(1)}%`);
    log.push(`  Recent AAPL returns: ${last3.join(", ")}`);
  }

  return {
    symbols: { total: allSymbols.length, succeeded, failed },
    annualReturnRecords: insertedRows,
    monthlyPriceRecords: insertedPrices,
    spy: {
      years: spyCheck.length,
      range: spyCheck.length > 0
        ? `${spyCheck[0].year}-${spyCheck[spyCheck.length - 1].year}`
        : null,
    },
    log,
  };
}

// ── Auto-refresh staleness threshold ────────────────────────────────
const AUTO_REFRESH_STALE_DAYS = 8; // prices are weekly, trigger after 8 days

// ── GET: Vercel Cron handler + auto-refresh + status ───────────────

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  const isCron = cronSecret && authHeader === `Bearer ${cronSecret}`;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    if (isCron) return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 400 });
    return NextResponse.json({ configured: false, message: "DATABASE_URL not set" });
  }

  const sql = neon(databaseUrl);

  // ── Determine if we should run a refresh ─────────────────────────
  let shouldRefresh = !!isCron;
  let isAutoRefresh = false;

  if (!shouldRefresh) {
    try {
      const meta = await sql`SELECT key, value FROM stock_meta WHERE key IN ('last_price_refresh', 'price_refresh_lock')`;
      const lastRefreshStr = meta.find(r => r.key === 'last_price_refresh')?.value as string | undefined;
      const lockStr = meta.find(r => r.key === 'price_refresh_lock')?.value as string | undefined;

      const lastRefreshMs = lastRefreshStr ? new Date(lastRefreshStr).getTime() : 0;
      const daysSinceRefresh = (Date.now() - lastRefreshMs) / (1000 * 60 * 60 * 24);

      if (daysSinceRefresh > AUTO_REFRESH_STALE_DAYS) {
        // Check lock
        if (lockStr) {
          const lockAgeMin = (Date.now() - new Date(lockStr).getTime()) / (1000 * 60);
          if (lockAgeMin < 10) {
            return NextResponse.json({
              configured: true,
              stale: true,
              refreshInProgress: true,
              daysSinceRefresh: Math.round(daysSinceRefresh * 10) / 10,
            });
          }
        }
        shouldRefresh = true;
        isAutoRefresh = true;
        console.log(`[auto-refresh] Price data is ${Math.round(daysSinceRefresh)}d stale, triggering refresh`);
      }
    } catch {
      // Tables may not exist yet
    }
  }

  // ── Status response (data is fresh) ──────────────────────────────
  if (!shouldRefresh) {
    try {
      const meta = await sql`SELECT value FROM stock_meta WHERE key = 'last_price_refresh'`;
      const countResult = await sql`SELECT count(*) as cnt FROM stock_annual_returns`;
      const symbolCount = await sql`SELECT count(DISTINCT symbol) as cnt FROM stock_annual_returns`;
      return NextResponse.json({
        configured: true,
        stale: false,
        lastPriceRefresh: meta[0]?.value || null,
        totalRecords: Number(countResult[0]?.cnt || 0),
        totalSymbols: Number(symbolCount[0]?.cnt || 0),
      });
    } catch {
      return NextResponse.json({ configured: true, error: "Could not query - tables may not exist yet" });
    }
  }

  // ── Run price refresh (cron or auto-refresh) ─────────────────────

  // Acquire lock
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS stock_meta (
        key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    await sql`
      INSERT INTO stock_meta (key, value, updated_at)
      VALUES ('price_refresh_lock', ${new Date().toISOString()}, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `;
  } catch { /* ignore */ }

  const trigger = isAutoRefresh ? 'auto-refresh' : 'cron';

  try {
    console.log(`[${trigger}] Starting price refresh...`);
    const result = await runPriceRefresh(sql);
    console.log(`[${trigger}] Price refresh complete: ${result.symbols.succeeded} symbols, ${result.annualReturnRecords} annual returns, ${result.monthlyPriceRecords} monthly prices`);

    // Release lock
    try { await sql`DELETE FROM stock_meta WHERE key = 'price_refresh_lock'`; } catch { /* ignore */ }

    return NextResponse.json({ success: true, trigger, ...result });
  } catch (error) {
    // Release lock on error
    try { await sql`DELETE FROM stock_meta WHERE key = 'price_refresh_lock'`; } catch { /* ignore */ }
    console.error(`${trigger} price refresh error:`, error);
    return NextResponse.json({ error: "Price refresh failed", details: String(error) }, { status: 500 });
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

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return NextResponse.json(
      { error: "DATABASE_URL not configured" },
      { status: 400 }
    );
  }

  const sql = neon(databaseUrl);

  try {
    const result = await runPriceRefresh(sql);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("Refresh-prices error:", error);
    return NextResponse.json(
      { error: "Price refresh failed", details: String(error) },
      { status: 500 }
    );
  }
}
