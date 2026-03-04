import { NextRequest, NextResponse } from "next/server";
import { parseStrategy, filtersToStructuredParams, structuredParamsToFilters } from "@/lib/naturalLanguageParser";
import { runBacktest } from "@/lib/backtestEngine";
import { StructuredParameters } from "@/lib/types";
import { auth } from "@clerk/nextjs/server";
import { currentUser } from "@clerk/nextjs/server";
import { getTierFromMetadata, PLANS } from "@/lib/subscription";
import { getDb, ensureUserUsageTable } from "@/lib/db";

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export async function POST(request: NextRequest) {
  // Auth check - require login to run backtests
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json(
      { error: "Please sign in to run backtests." },
      { status: 401 }
    );
  }

  // Check subscription tier and enforce usage limits
  const user = await currentUser();
  const publicMetadata = user?.publicMetadata as Record<string, unknown> | undefined;
  const tier = getTierFromMetadata(publicMetadata);
  const limit = PLANS[tier].backtestsPerMonth;

  if (limit !== Infinity) {
    const sql = getDb();
    if (sql) {
      try {
        await ensureUserUsageTable(sql);
        const month = currentMonth();
        const rows = await sql`
          SELECT backtest_count FROM user_usage
          WHERE user_id = ${userId} AND usage_month = ${month}
        `;
        const used = rows.length > 0 ? (rows[0].backtest_count as number) : 0;
        if (used >= limit) {
          return NextResponse.json(
            { error: `You've used all ${limit} free backtests this month. Upgrade to Premium for unlimited backtests.` },
            { status: 429 }
          );
        }
      } catch (err) {
        console.error("Usage check error:", err);
        // Allow the backtest to proceed if usage check fails
      }
    }
  }

  try {
    const body = await request.json();
    const { strategy, structuredParams } = body;

    // If structured params provided (from inspector edit), convert to filters
    if (structuredParams) {
      const sp = structuredParams as StructuredParameters;
      const filters = structuredParamsToFilters(sp);
      const tickers = sp.tickers && sp.tickers.length > 0 ? sp.tickers : undefined;
      const params = { description: strategy || "Manual adjustment", filters, tickers };
      const result = await runBacktest(params);

      if (result.matchedStockCount === 0) {
        return NextResponse.json(
          {
            error: buildNoMatchError(result.dataSource, result.stockSourceError, result.stockUniverseSize),
            params,
            dataSource: result.dataSource,
            stockUniverseSize: result.stockUniverseSize,
            stockSourceError: result.stockSourceError,
          },
          { status: 200 }
        );
      }

      // Increment usage for free tier
      await incrementUsage(userId, tier);

      return NextResponse.json({
        ...result,
        parsedParams: structuredParams,
        parsingMethod: "ai", // Inspector edits are always from an AI-parsed result
      });
    }

    if (!strategy || typeof strategy !== "string" || strategy.trim().length === 0) {
      return NextResponse.json(
        { error: "Please enter a strategy to test." },
        { status: 400 }
      );
    }

    // Parse natural language into structured parameters
    const params = await parseStrategy(strategy.trim());

    // Log parsing method and warnings
    console.log(`[API] Parsing method: ${params.parsingMethod || "unknown"}`);
    console.log(`[API] Filters: ${JSON.stringify(params.filters)}`);
    if (params.warnings && params.warnings.length > 0) {
      console.warn("[API] Parsing warnings:", params.warnings);
    }

    // Run the backtest
    const result = await runBacktest(params);

    if (result.matchedStockCount === 0) {
      return NextResponse.json(
        {
          error: buildNoMatchError(result.dataSource, result.stockSourceError, result.stockUniverseSize),
          params,
          warnings: params.warnings,
          parsingMethod: params.parsingMethod,
          dataSource: result.dataSource,
          stockUniverseSize: result.stockUniverseSize,
          stockSourceError: result.stockSourceError,
        },
        { status: 200 }
      );
    }

    // Increment usage for free tier
    await incrementUsage(userId, tier);

    // Convert filters to structured params for the inspector
    const parsedParams = filtersToStructuredParams(params);

    return NextResponse.json({
      ...result,
      parsedParams,
      warnings: params.warnings,
      parsingMethod: params.parsingMethod,
    });
  } catch (error) {
    console.error("Backtest error:", error);
    return NextResponse.json(
      { error: "Unable to run backtest. Please try again.", details: String(error) },
      { status: 500 }
    );
  }
}

/** Increment backtest usage count for free-tier users */
async function incrementUsage(userId: string, tier: string) {
  if (tier === "premium") return; // no tracking needed for premium
  const sql = getDb();
  if (!sql) return;
  try {
    await ensureUserUsageTable(sql);
    const month = currentMonth();
    await sql`
      INSERT INTO user_usage (user_id, usage_month, backtest_count)
      VALUES (${userId}, ${month}, 1)
      ON CONFLICT (user_id, usage_month)
      DO UPDATE SET backtest_count = user_usage.backtest_count + 1
    `;
  } catch (err) {
    console.error("Usage increment error:", err);
  }
}

/**
 * Build a descriptive error message when no stocks match, including
 * data source info so the user can troubleshoot.
 */
function buildNoMatchError(
  dataSource: string | undefined,
  stockSourceError: string | undefined,
  stockUniverseSize: number | undefined,
): string {
  const parts: string[] = ["No stocks matched your criteria."];

  if (stockSourceError) {
    parts.push(stockSourceError);
  } else if (dataSource === "hardcoded") {
    parts.push("Using fallback data (limited to ~100 stocks). Run /api/admin/refresh-data to populate the database.");
  } else if (dataSource === "fmp" && (stockUniverseSize ?? 0) > 0) {
    parts.push("Stock database may need enrichment - metric columns could be empty. Run /api/admin/refresh-data to populate ratios & key metrics.");
  }

  parts.push("Try broadening your filters.");
  return parts.join(" ");
}
