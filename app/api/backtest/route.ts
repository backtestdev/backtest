import { NextRequest, NextResponse } from "next/server";
import { parseStrategy } from "@/lib/naturalLanguageParser";
import { runBacktest } from "@/lib/backtestEngine";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { strategy } = body;

    if (!strategy || typeof strategy !== "string" || strategy.trim().length === 0) {
      return NextResponse.json(
        { error: "Please enter a strategy to test." },
        { status: 400 }
      );
    }

    // Parse natural language into structured parameters
    const params = await parseStrategy(strategy.trim());

    // Run the backtest
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

    return NextResponse.json(result);
  } catch (error) {
    console.error("Backtest error:", error);
    return NextResponse.json(
      { error: "Unable to run backtest. Please try again." },
      { status: 500 }
    );
  }
}
