import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { LeaderboardEntry } from "@/lib/types";
import { v4 as uuidv4 } from "uuid";

const LEADERBOARD_PATH = path.join(process.cwd(), "data", "leaderboard.json");
const MAX_ENTRIES = 20;

async function readLeaderboard(): Promise<LeaderboardEntry[]> {
  try {
    const data = await fs.readFile(LEADERBOARD_PATH, "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function writeLeaderboard(entries: LeaderboardEntry[]): Promise<void> {
  await fs.writeFile(LEADERBOARD_PATH, JSON.stringify(entries, null, 2));
}

export async function GET() {
  try {
    const entries = await readLeaderboard();
    // Default sort by 10yr return descending
    entries.sort((a, b) => b.return10yr - a.return10yr);
    return NextResponse.json(entries.slice(0, MAX_ENTRIES));
  } catch (error) {
    console.error("Leaderboard read error:", error);
    return NextResponse.json([], { status: 200 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, description, return1yr, return5yr, return10yr, return20yr, matchedStocks } = body;

    if (!name || !description) {
      return NextResponse.json(
        { error: "Name and description are required." },
        { status: 400 }
      );
    }

    const entries = await readLeaderboard();

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
    };

    entries.push(newEntry);

    // Keep only top entries sorted by 10yr return
    entries.sort((a, b) => b.return10yr - a.return10yr);
    const trimmed = entries.slice(0, MAX_ENTRIES);

    await writeLeaderboard(trimmed);

    return NextResponse.json(newEntry, { status: 201 });
  } catch (error) {
    console.error("Leaderboard write error:", error);
    return NextResponse.json(
      { error: "Failed to save to leaderboard." },
      { status: 500 }
    );
  }
}
