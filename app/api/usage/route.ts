import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getDb, ensureUserUsageTable } from "@/lib/db";

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const sql = getDb();
  if (!sql) {
    return NextResponse.json({ backtestCount: 0 });
  }

  try {
    await ensureUserUsageTable(sql);
    const month = currentMonth();
    const rows = await sql`
      SELECT backtest_count FROM user_usage
      WHERE user_id = ${userId} AND usage_month = ${month}
    `;
    const count = rows.length > 0 ? (rows[0].backtest_count as number) : 0;
    return NextResponse.json({ backtestCount: count });
  } catch (error) {
    console.error("Usage fetch error:", error);
    return NextResponse.json({ backtestCount: 0 });
  }
}
