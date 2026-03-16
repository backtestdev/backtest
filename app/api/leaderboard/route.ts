import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { LeaderboardEntry } from "@/lib/types";
import { v4 as uuidv4 } from "uuid";
import { auth } from "@clerk/nextjs/server";
import { getDb, generateParametersHash, generateQueryHash } from "@/lib/db";
import { moderateText } from "@/lib/moderation";
import { getSpyReturn } from "@/lib/stockData";

const LEADERBOARD_PATH = path.join(process.cwd(), "data", "leaderboard.json");
const MAX_ENTRIES = 20;
const MAX_TOTAL_ENTRIES = 500; // Hard cap on total leaderboard rows to prevent unbounded growth

// --- File-based storage (fallback when no DATABASE_URL) ---

async function readLeaderboardFile(): Promise<LeaderboardEntry[]> {
  try {
    const data = await fs.readFile(LEADERBOARD_PATH, "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function writeLeaderboardFile(entries: LeaderboardEntry[]): Promise<void> {
  await fs.writeFile(LEADERBOARD_PATH, JSON.stringify(entries, null, 2));
}

// --- Neon DB storage ---

async function readLeaderboardDb(): Promise<LeaderboardEntry[]> {
  const sql = getDb();
  if (!sql) return readLeaderboardFile();

  try {
    const rows = await sql`
      SELECT id, name, description, return1yr, return5yr, return10yr, return20yr,
             matched_stocks as "matchedStocks", created_at as "createdAt", user_id,
             parameters_json, parameters_hash, query_hash, created_by, is_public
      FROM leaderboard
      WHERE is_public = TRUE OR is_public IS NULL
      ORDER BY return10yr DESC
      LIMIT ${MAX_ENTRIES}
    `;
    return rows.map(mapRowToEntry);
  } catch (error) {
    console.error("DB read failed, falling back to file:", error);
    return readLeaderboardFile();
  }
}

async function readUserStrategiesDb(userId: string): Promise<LeaderboardEntry[]> {
  const sql = getDb();
  if (!sql) return [];

  try {
    const rows = await sql`
      SELECT id, name, description, return1yr, return5yr, return10yr, return20yr,
             matched_stocks as "matchedStocks", created_at as "createdAt", user_id,
             parameters_json, parameters_hash, query_hash, created_by, is_public
      FROM leaderboard
      WHERE user_id = ${userId}
      ORDER BY return10yr DESC
    `;
    return rows.map(mapRowToEntry);
  } catch (error) {
    console.error("User strategies read failed:", error);
    return [];
  }
}

function mapRowToEntry(row: Record<string, unknown>): LeaderboardEntry {
  return {
    id: row.id as string,
    name: row.name as string,
    description: row.description as string,
    return1yr: Number(row.return1yr),
    return5yr: Number(row.return5yr),
    return10yr: Number(row.return10yr),
    return20yr: Number(row.return20yr),
    matchedStocks: Number(row.matchedStocks),
    createdAt: row.createdAt as string,
    user_id: row.user_id as string | undefined,
    created_by: row.created_by as string | undefined,
    parameters_json: row.parameters_json as LeaderboardEntry["parameters_json"],
    parameters_hash: row.parameters_hash as string | undefined,
    query_hash: row.query_hash as string | undefined,
    is_public: row.is_public as boolean | undefined,
  };
}

async function checkDuplicateDb(
  hashValue: string,
  column: "parameters_hash" | "query_hash" = "parameters_hash"
): Promise<LeaderboardEntry | null> {
  const sql = getDb();
  if (!sql) return null;

  try {
    const rows = column === "query_hash"
      ? await sql`SELECT id, name, description FROM leaderboard WHERE query_hash = ${hashValue} LIMIT 1`
      : await sql`SELECT id, name, description FROM leaderboard WHERE parameters_hash = ${hashValue} LIMIT 1`;
    if (rows.length > 0) {
      return rows[0] as unknown as LeaderboardEntry;
    }
    return null;
  } catch {
    return null;
  }
}

async function writeLeaderboardDb(entry: LeaderboardEntry): Promise<void> {
  const sql = getDb();
  if (!sql) {
    // Fall back to file
    const entries = await readLeaderboardFile();
    entries.push(entry);
    entries.sort((a, b) => b.return10yr - a.return10yr);
    await writeLeaderboardFile(entries.slice(0, MAX_ENTRIES));
    return;
  }

  await sql`
    INSERT INTO leaderboard (id, name, description, return1yr, return5yr, return10yr, return20yr,
                             matched_stocks, created_at, user_id, parameters_json, parameters_hash,
                             query_hash, created_by, is_public)
    VALUES (${entry.id}, ${entry.name}, ${entry.description}, ${entry.return1yr}, ${entry.return5yr},
            ${entry.return10yr}, ${entry.return20yr}, ${entry.matchedStocks}, ${entry.createdAt},
            ${entry.user_id ?? null}, ${JSON.stringify(entry.parameters_json) ?? null},
            ${entry.parameters_hash ?? null}, ${entry.query_hash ?? null}, ${entry.created_by ?? null},
            ${entry.is_public ?? true})
  `;
}

// --- Duplicate check for file-based storage ---

function checkDuplicateFile(entries: LeaderboardEntry[], parametersHash: string): LeaderboardEntry | null {
  return entries.find((e) => e.parameters_hash === parametersHash) ?? null;
}

// --- Route handlers ---

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const scope = searchParams.get("scope"); // "personal" for user's strategies
    const forUserId = searchParams.get("userId");

    let entries: LeaderboardEntry[];

    if (scope === "personal" && forUserId) {
      entries = await readUserStrategiesDb(forUserId);
    } else {
      entries = await readLeaderboardDb();
    }

    entries.sort((a, b) => b.return10yr - a.return10yr);

    // Compute S&P 500 benchmark returns for each time period
    const benchmarks = {
      return1yr: Math.round(getSpyReturn(1) * 10) / 10,
      return5yr: Math.round(getSpyReturn(5) * 10) / 10,
      return10yr: Math.round(getSpyReturn(10) * 10) / 10,
      return20yr: Math.round(getSpyReturn(20) * 10) / 10,
    };

    return NextResponse.json({ entries, benchmarks });
  } catch (error) {
    console.error("Leaderboard read error:", error);
    return NextResponse.json({ entries: [], benchmarks: { return1yr: 0, return5yr: 0, return10yr: 0, return20yr: 0 } }, { status: 200 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { error: "You must be signed in to add to the leaderboard." },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { name, description, return1yr, return5yr, return10yr, return20yr, matchedStocks, parameters_json, created_by, is_public } = body;

    console.log("[Leaderboard POST] Received:", { name, description, userId, parameters_json: !!parameters_json });

    if (!name || !description) {
      return NextResponse.json(
        { error: "Name and description are required." },
        { status: 400 }
      );
    }

    // Content moderation
    const nameCheck = moderateText(name);
    if (!nameCheck.ok) {
      console.log("[Leaderboard POST] Name moderation failed:", nameCheck.error);
      return NextResponse.json({ error: nameCheck.error }, { status: 400 });
    }

    const descCheck = moderateText(description);
    if (!descCheck.ok) {
      console.log("[Leaderboard POST] Description moderation failed:", descCheck.error);
      return NextResponse.json({ error: descCheck.error }, { status: 400 });
    }

    // Generate hashes for duplicate detection
    const parametersHash = parameters_json ? generateParametersHash(parameters_json) : null;
    const queryHash = description ? generateQueryHash(description) : null;

    // Only block truly identical strategies (same exact parsed parameters).
    // query_hash is still stored for reference but not used for dedup -
    // similar queries can produce meaningfully different strategies.
    if (parametersHash) {
      const sql = getDb();
      let existingDup: LeaderboardEntry | null = null;

      if (sql) {
        existingDup = await checkDuplicateDb(parametersHash, "parameters_hash");
      } else {
        const entries = await readLeaderboardFile();
        existingDup = checkDuplicateFile(entries, parametersHash);
      }

      if (existingDup) {
        console.log("[Leaderboard POST] Duplicate found:", existingDup.name);
        return NextResponse.json(
          { error: `This strategy already exists on the leaderboard as '${existingDup.name}'` },
          { status: 409 }
        );
      }
    }

    const entryIsPublic = is_public !== false; // Default to public

    const newEntry: LeaderboardEntry = {
      id: uuidv4(),
      name,
      description,
      return1yr: return1yr ?? 0,
      return5yr: return5yr ?? 0,
      return10yr: return10yr ?? 0,
      return20yr: return20yr ?? 0,
      matchedStocks: matchedStocks ?? 0,
      createdAt: new Date().toISOString(),
      user_id: userId,
      created_by: created_by ?? undefined,
      parameters_json: parameters_json ?? undefined,
      parameters_hash: parametersHash ?? undefined,
      query_hash: queryHash ?? undefined,
      is_public: entryIsPublic,
    };

    await writeLeaderboardDb(newEntry);

    // Trim old entries to prevent unbounded table growth
    const sql = getDb();
    if (sql) {
      try {
        await sql`
          DELETE FROM leaderboard
          WHERE id NOT IN (
            SELECT id FROM leaderboard ORDER BY return10yr DESC LIMIT ${MAX_TOTAL_ENTRIES}
          )
        `;
      } catch { /* non-fatal */ }
    }

    console.log("[Leaderboard POST] Successfully saved:", newEntry.id);

    return NextResponse.json(newEntry, { status: 201 });
  } catch (error) {
    console.error("[Leaderboard POST] Error:", error);
    return NextResponse.json(
      { error: "Failed to save to leaderboard." },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing strategy ID" }, { status: 400 });
    }

    const sql = getDb();
    if (!sql) {
      // File-based fallback
      const entries = await readLeaderboardFile();
      const idx = entries.findIndex((e) => e.id === id && e.user_id === userId);
      if (idx === -1) {
        return NextResponse.json({ error: "Strategy not found or not owned by you" }, { status: 404 });
      }
      entries.splice(idx, 1);
      await writeLeaderboardFile(entries);
      return NextResponse.json({ success: true });
    }

    // Only delete if owned by the user
    const result = await sql`DELETE FROM leaderboard WHERE id = ${id} AND user_id = ${userId} RETURNING id`;
    if (result.length === 0) {
      return NextResponse.json({ error: "Strategy not found or not owned by you" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Leaderboard DELETE] Error:", error);
    return NextResponse.json({ error: "Failed to delete strategy" }, { status: 500 });
  }
}
