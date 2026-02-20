import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getDb, ensureSavedPortfoliosTable } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();
  if (!sql) return NextResponse.json({ portfolios: [] });

  try {
    await ensureSavedPortfoliosTable(sql);

    const rows = await sql`
      SELECT id, name, holdings, analysis, created_at, updated_at
      FROM saved_portfolios
      WHERE user_id = ${userId}
      ORDER BY updated_at DESC
    `;

    return NextResponse.json({ portfolios: rows });
  } catch (error) {
    console.error("[Saved Portfolios GET] Error:", error);
    return NextResponse.json({ portfolios: [] });
  }
}

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();
  if (!sql) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  try {
    await ensureSavedPortfoliosTable(sql);

    const body = await request.json();
    const { name, holdings, analysis } = body;

    if (!name || !holdings || !Array.isArray(holdings) || holdings.length === 0) {
      return NextResponse.json({ error: "Name and holdings are required" }, { status: 400 });
    }

    const id = uuidv4();
    const now = new Date().toISOString();

    await sql`
      INSERT INTO saved_portfolios (id, user_id, name, holdings, analysis, created_at, updated_at)
      VALUES (${id}, ${userId}, ${name}, ${JSON.stringify(holdings)}, ${JSON.stringify(analysis)}, ${now}, ${now})
    `;

    return NextResponse.json({ id, name, created_at: now }, { status: 201 });
  } catch (error) {
    console.error("[Saved Portfolios POST] Error:", error);
    return NextResponse.json({ error: "Failed to save portfolio" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();
  if (!sql) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing portfolio ID" }, { status: 400 });
    }

    // Only delete if owned by the user
    await sql`DELETE FROM saved_portfolios WHERE id = ${id} AND user_id = ${userId}`;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Saved Portfolios DELETE] Error:", error);
    return NextResponse.json({ error: "Failed to delete portfolio" }, { status: 500 });
  }
}
