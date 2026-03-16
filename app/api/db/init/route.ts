import { NextResponse } from "next/server";
import { getDb, ensureStockTables, ensureLeaderboardTable, ensureSavedPortfoliosTable, ensureSignalPicksTable, ensureUserUsageTable, dropUnusedColumnsAndTables } from "@/lib/db";

export async function POST() {
  const sql = getDb();

  if (!sql) {
    return NextResponse.json(
      { error: "DATABASE_URL not configured. Set it in your environment variables." },
      { status: 400 }
    );
  }

  try {
    // Clean up stale temporary tables from failed refresh-data runs
    await sql`DROP TABLE IF EXISTS stocks_new CASCADE`;
    await sql`DROP TABLE IF EXISTS stocks_old CASCADE`;

    // Create leaderboard table (with migration for older schemas)
    await ensureLeaderboardTable(sql);

    // Stock data tables (unified stocks, stock_prices, stock_meta + indexes)
    await ensureStockTables(sql);

    // Saved portfolios table
    await ensureSavedPortfoliosTable(sql);

    // Signal tracker picks table
    await ensureSignalPicksTable(sql);

    // User usage tracking table
    await ensureUserUsageTable(sql);

    // Drop legacy tables and unused columns to reclaim storage
    const cleanup = await dropUnusedColumnsAndTables(sql);

    return NextResponse.json({
      success: true,
      message: "Database initialized successfully. Cleaned up stale temp tables.",
      cleanup,
    });
  } catch (error) {
    console.error("DB init error:", error);
    return NextResponse.json(
      { error: "Failed to initialize database.", details: String(error) },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    message: "POST to this endpoint to initialize the database.",
    requires: "DATABASE_URL environment variable",
  });
}
