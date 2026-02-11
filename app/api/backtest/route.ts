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
      const result = runBacktest(params);

      if (result.matchedStockCount === 0) {
        return NextResponse.json(
          {
            error: "No stocks matched your criteria. Try adjusting your filters.",
            params,
          },
          { status: 200 }
        );
      }

      return NextResponse.json({
        ...result,
        parsedParams: structuredParams,
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

    // Log warnings if any
    if (params.warnings && params.warnings.length > 0) {
      console.warn("[API] Parsing warnings:", params.warnings);
    }

    // Run the backtest
    const result = runBacktest(params);

    if (result.matchedStockCount === 0) {
      return NextResponse.json(
        {
          error: "No stocks matched your criteria. Try adjusting your filters.",
          params,
          warnings: params.warnings,
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
    });
  } catch (error) {
    console.error("Backtest error:", error);
    return NextResponse.json(
      { error: "Unable to run backtest. Please try again." },
      { status: 500 }
    );
  }
}
