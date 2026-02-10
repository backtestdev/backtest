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

    return NextResponse.json({ success: true, message: "Database initialized successfully." });
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
