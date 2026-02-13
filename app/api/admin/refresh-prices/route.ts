/**
 * Admin endpoint to populate historical annual returns from Yahoo Finance.
 *
 * GET  /api/admin/refresh-prices — Vercel Cron handler (weekly)
 * POST /api/admin/refresh-prices — Manual trigger via admin UI
 *
 * Fetches 20+ years of monthly price data from Yahoo Finance for all
 * stocks in the database (plus SPY for benchmark), computes annual
 * returns, and stores them in the stock_annual_returns table.
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
  for (const [symbol, annualReturns] of Array.from(returns.entries())) {
    for (const ret of annualReturns) {
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
    records: insertedRows,
    spy: {
      years: spyCheck.length,
      range: spyCheck.length > 0
        ? `${spyCheck[0].year}-${spyCheck[spyCheck.length - 1].year}`
        : null,
    },
    log,
  };
}

// ── GET: Vercel Cron handler ───────────────────────────────────────

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  const isCron = cronSecret && authHeader === `Bearer ${cronSecret}`;

  if (!isCron) {
    // Non-cron GET: return last refresh status
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      return NextResponse.json({ configured: false, message: "DATABASE_URL not set" });
    }
    try {
      const sql = neon(databaseUrl);
      const meta = await sql`SELECT value FROM stock_meta WHERE key = 'last_price_refresh'`;
      const countResult = await sql`SELECT count(*) as cnt FROM stock_annual_returns`;
      const symbolCount = await sql`SELECT count(DISTINCT symbol) as cnt FROM stock_annual_returns`;
      return NextResponse.json({
        configured: true,
        lastPriceRefresh: meta[0]?.value || null,
        totalRecords: Number(countResult[0]?.cnt || 0),
        totalSymbols: Number(symbolCount[0]?.cnt || 0),
      });
    } catch {
      return NextResponse.json({ configured: true, error: "Could not query — tables may not exist yet" });
    }
  }

  // Cron request — run full price refresh
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 400 });
  }

  const sql = neon(databaseUrl);
  try {
    console.log("[cron] Starting weekly price refresh...");
    const result = await runPriceRefresh(sql);
    console.log(`[cron] Price refresh complete: ${result.symbols.succeeded} symbols, ${result.records} records`);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("Cron price refresh error:", error);
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
