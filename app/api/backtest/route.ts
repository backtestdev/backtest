import { NextRequest, NextResponse } from "next/server";
import { parseStrategy, filtersToStructuredParams, structuredParamsToFilters } from "@/lib/naturalLanguageParser";
import { runBacktest } from "@/lib/backtestEngine";
import { StructuredParameters } from "@/lib/types";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { strategy, structuredParams } = body;

    // If structured params provided (from inspector edit), convert to filters
    if (structuredParams) {
      const filters = structuredParamsToFilters(structuredParams as StructuredParameters);
      const params = { description: strategy || "Manual adjustment", filters };
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
    parts.push("Stock database may need enrichment — metric columns could be empty. Run /api/admin/refresh-data to populate ratios & key metrics.");
  }

  parts.push("Try broadening your filters.");
  return parts.join(" ");
}
