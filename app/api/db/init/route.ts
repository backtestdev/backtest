import { NextResponse } from "next/server";
import { getDb, ensureStockTables, ensureLeaderboardTable } from "@/lib/db";

export async function POST() {
  const sql = getDb();

  if (!sql) {
    return NextResponse.json(
      { error: "DATABASE_URL not configured. Set it in your environment variables." },
      { status: 400 }
    );
  }

  try {
    // Create leaderboard table (with migration for older schemas)
    await ensureLeaderboardTable(sql);

    // Stock data tables (unified stocks, stock_prices, stock_meta + indexes)
    await ensureStockTables(sql);

    return NextResponse.json({
      success: true,
      message: "Database initialized successfully (leaderboard + stock tables).",
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
