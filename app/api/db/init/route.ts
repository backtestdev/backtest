import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function POST() {
  const sql = getDb();

  if (!sql) {
    return NextResponse.json(
      { error: "DATABASE_URL not configured. Set it in your environment variables." },
      { status: 400 }
    );
  }

  try {
    // Create leaderboard table
    await sql`
      CREATE TABLE IF NOT EXISTS leaderboard (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        return1yr NUMERIC DEFAULT 0,
        return5yr NUMERIC DEFAULT 0,
        return10yr NUMERIC DEFAULT 0,
        return20yr NUMERIC DEFAULT 0,
        matched_stocks INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        user_id TEXT,
        parameters_json JSONB,
        parameters_hash TEXT
      )
    `;

    // Add new columns if they don't exist (migration logic)
    await sql`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leaderboard' AND column_name='parameters_json') THEN
          ALTER TABLE leaderboard ADD COLUMN parameters_json JSONB;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leaderboard' AND column_name='parameters_hash') THEN
          ALTER TABLE leaderboard ADD COLUMN parameters_hash TEXT;
        END IF;
      END $$
    `;

    // Create index on parameters_hash for fast duplicate lookups
    await sql`
      CREATE INDEX IF NOT EXISTS idx_leaderboard_params_hash ON leaderboard (parameters_hash)
    `;

    // --- Stock data tables ---

    // Core stock identity and screener data
    await sql`
      CREATE TABLE IF NOT EXISTS stocks (
        symbol TEXT PRIMARY KEY,
        company_name TEXT NOT NULL,
        sector TEXT,
        industry TEXT,
        country TEXT,
        exchange TEXT,
        exchange_short_name TEXT,
        market_cap BIGINT DEFAULT 0,
        beta NUMERIC DEFAULT 0,
        last_annual_dividend NUMERIC DEFAULT 0,
        is_etf BOOLEAN DEFAULT false,
        is_actively_trading BOOLEAN DEFAULT true,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    // Real-time quote data (refreshed periodically)
    await sql`
      CREATE TABLE IF NOT EXISTS quotes (
        symbol TEXT PRIMARY KEY REFERENCES stocks(symbol) ON DELETE CASCADE,
        price NUMERIC DEFAULT 0,
        changes_percentage NUMERIC DEFAULT 0,
        day_low NUMERIC DEFAULT 0,
        day_high NUMERIC DEFAULT 0,
        year_high NUMERIC DEFAULT 0,
        year_low NUMERIC DEFAULT 0,
        market_cap BIGINT DEFAULT 0,
        price_avg_50 NUMERIC DEFAULT 0,
        price_avg_200 NUMERIC DEFAULT 0,
        volume BIGINT DEFAULT 0,
        avg_volume BIGINT DEFAULT 0,
        eps NUMERIC DEFAULT 0,
        pe NUMERIC DEFAULT 0,
        shares_outstanding BIGINT DEFAULT 0,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    // Fundamental key metrics (annual)
    await sql`
      CREATE TABLE IF NOT EXISTS ratios (
        symbol TEXT PRIMARY KEY REFERENCES stocks(symbol) ON DELETE CASCADE,
        pe_ratio NUMERIC DEFAULT 0,
        pb_ratio NUMERIC DEFAULT 0,
        price_to_sales_ratio NUMERIC DEFAULT 0,
        debt_to_equity NUMERIC DEFAULT 0,
        current_ratio NUMERIC DEFAULT 0,
        roe NUMERIC DEFAULT 0,
        roic NUMERIC DEFAULT 0,
        dividend_yield NUMERIC DEFAULT 0,
        payout_ratio NUMERIC DEFAULT 0,
        free_cash_flow_per_share NUMERIC DEFAULT 0,
        revenue_per_share NUMERIC DEFAULT 0,
        net_income_per_share NUMERIC DEFAULT 0,
        earnings_yield NUMERIC DEFAULT 0,
        ev_to_sales NUMERIC DEFAULT 0,
        enterprise_value BIGINT DEFAULT 0,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    // Growth metrics and income data (enrichment)
    await sql`
      CREATE TABLE IF NOT EXISTS profiles (
        symbol TEXT PRIMARY KEY REFERENCES stocks(symbol) ON DELETE CASCADE,
        revenue_growth NUMERIC DEFAULT 0,
        net_income_growth NUMERIC DEFAULT 0,
        earnings_growth NUMERIC DEFAULT 0,
        revenue_growth_quarters INTEGER DEFAULT 0,
        net_income_growth_quarters INTEGER DEFAULT 0,
        dividend_growth_years INTEGER DEFAULT 0,
        profit_margin NUMERIC DEFAULT 0,
        historical_returns JSONB DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    // Indexes for fast filtering (<50ms target)
    await sql`CREATE INDEX IF NOT EXISTS idx_stocks_sector ON stocks(sector)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_stocks_market_cap ON stocks(market_cap)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_stocks_exchange ON stocks(exchange_short_name)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_quotes_pe ON quotes(pe)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_quotes_market_cap ON quotes(market_cap)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ratios_pe ON ratios(pe_ratio)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ratios_dividend ON ratios(dividend_yield)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ratios_roe ON ratios(roe)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ratios_debt ON ratios(debt_to_equity)`;

    // Metadata table to track last refresh time
    await sql`
      CREATE TABLE IF NOT EXISTS stock_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

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
