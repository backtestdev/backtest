/**
 * Admin endpoint to purge non-company entries from the stock database.
 *
 * POST /api/admin/cleanup — deletes funds, indexes, SPACs, trusts, etc.
 *
 * Protected by x-admin-secret header (same as refresh-data).
 * Works with the unified single `stocks` table — no orphan cleanup needed.
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { refreshStockUniverse } from "@/lib/fmpService";
import { NON_COMPANY_PATTERN } from "@/lib/stockFilters";

export const runtime = "nodejs";

// Use shared pattern — no local definition needed

export async function POST(request: NextRequest) {
  const adminSecret = process.env.ADMIN_SECRET;
  const adminHeader = request.headers.get("x-admin-secret");
  const isAdmin = adminSecret ? adminHeader === adminSecret : true;

  if (!isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();
  if (!sql) {
    return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 400 });
  }

  try {
    // Count before
    const beforeRows = await sql`SELECT count(*) as cnt FROM stocks`;
    const before = Number(beforeRows[0].cnt);

    // Find matches per category (for reporting)
    const etfCount = await sql`SELECT count(*) as cnt FROM stocks WHERE is_etf = true`;
    const noSectorCount = await sql`SELECT count(*) as cnt FROM stocks WHERE sector IS NULL OR TRIM(sector) = ''`;
    const badSymbolCount = await sql`SELECT count(*) as cnt FROM stocks WHERE symbol LIKE '%.%' OR LENGTH(symbol) > 5`;
    const namePatternCount = await sql`SELECT count(*) as cnt FROM stocks WHERE company_name ~* ${NON_COMPANY_PATTERN}`;
    const assetMgmtCount = await sql`SELECT count(*) as cnt FROM stocks WHERE LENGTH(symbol) = 5 AND symbol LIKE '%X' AND (sector = 'Asset Management' OR industry = 'Asset Management')`;

    // Delete all matching (single table, no CASCADE needed)
    const deleted = await sql`
      DELETE FROM stocks
      WHERE is_etf = true
         OR sector IS NULL OR TRIM(sector) = ''
         OR symbol LIKE '%.%'
         OR LENGTH(symbol) > 5
         OR company_name ~* ${NON_COMPANY_PATTERN}
         OR (LENGTH(symbol) = 5 AND symbol LIKE '%X' AND (sector = 'Asset Management' OR industry = 'Asset Management'))
      RETURNING symbol, company_name
    `;

    // Count after
    const afterRows = await sql`SELECT count(*) as cnt FROM stocks`;
    const after = Number(afterRows[0].cnt);

    // Refresh in-memory cache
    await refreshStockUniverse();

    return NextResponse.json({
      success: true,
      before,
      after,
      deleted: deleted.length,
      breakdown: {
        etf: Number(etfCount[0].cnt),
        noSector: Number(noSectorCount[0].cnt),
        badSymbol: Number(badSymbolCount[0].cnt),
        namePattern: Number(namePatternCount[0].cnt),
        assetMgmtFund: Number(assetMgmtCount[0].cnt),
      },
      deletedSymbols: deleted.map((r) => ({ symbol: r.symbol, name: r.company_name })),
    });
  } catch (error) {
    console.error("Cleanup error:", error);
    return NextResponse.json({ error: "Cleanup failed", details: String(error) }, { status: 500 });
  }
}
