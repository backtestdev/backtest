import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import OpenAI from "openai";

export const dynamic = "force-dynamic";

interface Holding {
  symbol: string;
  shares: number;
  costBasis?: number; // per-share cost basis
}

interface UserProfile {
  age?: number;
  riskTolerance?: "conservative" | "moderate" | "aggressive";
}

const SECTOR_NAMES: Record<number, string> = {
  1: "Technology", 2: "Healthcare", 3: "Financial", 4: "Energy",
  5: "Consumer", 6: "Industrials", 7: "Basic Materials", 8: "Real Estate",
  9: "Utilities", 10: "Communication Services",
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { holdings, profile } = body as { holdings: Holding[]; profile?: UserProfile };

    if (!holdings || holdings.length === 0) {
      return NextResponse.json({ error: "No holdings provided" }, { status: 400 });
    }

    const symbols = holdings.map((h) => h.symbol.toUpperCase());

    const sql = getDb();
    if (!sql) {
      return NextResponse.json({ error: "Database not configured" }, { status: 503 });
    }

    // Fetch stock data for all holdings
    const stockRows = await sql`
      SELECT symbol, name, sector, market_cap, pe_ratio, roe, profit_margin,
             revenue_growth, earnings_growth, dividend_yield, debt_to_equity,
             beta, price_to_book, free_cash_flow_yield, roic
      FROM stocks
      WHERE symbol = ANY(${symbols})
    `;

    // Fetch latest prices
    const priceRows = await sql`
      SELECT DISTINCT ON (symbol) symbol, close_price, date
      FROM stock_prices
      WHERE symbol = ANY(${symbols})
      ORDER BY symbol, date DESC
    `;

    const stockMap = new Map(stockRows.map((r) => [r.symbol as string, r]));
    const priceMap = new Map(priceRows.map((r) => [r.symbol as string, { price: Number(r.close_price), date: r.date }]));

    // Build enriched holdings
    const enrichedHoldings = holdings.map((h) => {
      const sym = h.symbol.toUpperCase();
      const stock = stockMap.get(sym);
      const priceInfo = priceMap.get(sym);
      const currentPrice = priceInfo?.price || 0;
      const currentValue = currentPrice * h.shares;
      const costBasisTotal = h.costBasis ? h.costBasis * h.shares : null;
      const gainLoss = costBasisTotal !== null ? currentValue - costBasisTotal : null;
      const gainLossPct = costBasisTotal !== null && costBasisTotal > 0
        ? (currentValue - costBasisTotal) / costBasisTotal
        : null;

      return {
        symbol: sym,
        name: stock?.name || sym,
        shares: h.shares,
        currentPrice,
        priceDate: priceInfo?.date || null,
        currentValue,
        costBasis: h.costBasis || null,
        costBasisTotal,
        gainLoss,
        gainLossPct,
        sector: stock ? SECTOR_NAMES[Number(stock.sector)] || "Other" : "Unknown",
        metrics: stock ? {
          peRatio: stock.pe_ratio !== null ? Number(stock.pe_ratio) : null,
          roe: stock.roe !== null ? Number(stock.roe) : null,
          profitMargin: stock.profit_margin !== null ? Number(stock.profit_margin) : null,
          revenueGrowth: stock.revenue_growth !== null ? Number(stock.revenue_growth) : null,
          dividendYield: stock.dividend_yield !== null ? Number(stock.dividend_yield) : null,
          debtToEquity: stock.debt_to_equity !== null ? Number(stock.debt_to_equity) : null,
          beta: stock.beta !== null ? Number(stock.beta) : null,
          marketCap: stock.market_cap !== null ? Number(stock.market_cap) : null,
        } : null,
      };
    });

    const totalValue = enrichedHoldings.reduce((sum, h) => sum + h.currentValue, 0);
    const totalCostBasis = enrichedHoldings.reduce((sum, h) => sum + (h.costBasisTotal || 0), 0);

    // Sector allocation
    const sectorAlloc: Record<string, number> = {};
    for (const h of enrichedHoldings) {
      sectorAlloc[h.sector] = (sectorAlloc[h.sector] || 0) + h.currentValue;
    }
    const sectorBreakdown = Object.entries(sectorAlloc)
      .map(([sector, value]) => ({ sector, value, pct: totalValue > 0 ? value / totalValue : 0 }))
      .sort((a, b) => b.value - a.value);

    // Concentration risk
    const holdingWeights = enrichedHoldings
      .map((h) => ({ symbol: h.symbol, pct: totalValue > 0 ? h.currentValue / totalValue : 0 }))
      .sort((a, b) => b.pct - a.pct);

    // Portfolio beta (weighted)
    const weightedBeta = enrichedHoldings.reduce((sum, h) => {
      const beta = h.metrics?.beta || 1;
      const weight = totalValue > 0 ? h.currentValue / totalValue : 0;
      return sum + beta * weight;
    }, 0);

    // AI analysis
    let aiAnalysis: string | null = null;
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) {
      try {
        const openai = new OpenAI({ apiKey: openaiKey });

        const holdingSummary = enrichedHoldings.map((h) => {
          const weight = totalValue > 0 ? ((h.currentValue / totalValue) * 100).toFixed(1) : "0";
          return `${h.symbol} (${h.name}): ${weight}% of portfolio, sector: ${h.sector}, P/E: ${h.metrics?.peRatio?.toFixed(1) || "N/A"}, ROE: ${h.metrics?.roe ? (h.metrics.roe * 100).toFixed(1) + "%" : "N/A"}, Revenue Growth: ${h.metrics?.revenueGrowth ? (h.metrics.revenueGrowth * 100).toFixed(1) + "%" : "N/A"}, Dividend Yield: ${h.metrics?.dividendYield ? (h.metrics.dividendYield * 100).toFixed(1) + "%" : "N/A"}, Beta: ${h.metrics?.beta?.toFixed(2) || "N/A"}`;
        }).join("\n");

        const profileContext = profile
          ? `\nInvestor profile: Age ${profile.age || "unknown"}, Risk tolerance: ${profile.riskTolerance || "moderate"}.`
          : "";

        const response = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          max_tokens: 800,
          messages: [
            {
              role: "system",
              content: "You are a concise portfolio analyst. Give practical, specific feedback. Use bullet points. Keep it under 300 words. Never give specific buy/sell recommendations. Include a disclaimer that this is not financial advice.",
            },
            {
              role: "user",
              content: `Analyze this portfolio ($${totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })} total value, portfolio beta: ${weightedBeta.toFixed(2)}):\n\n${holdingSummary}\n\nSector breakdown: ${sectorBreakdown.map((s) => `${s.sector}: ${(s.pct * 100).toFixed(1)}%`).join(", ")}\n\nTop concentration: ${holdingWeights.slice(0, 3).map((h) => `${h.symbol}: ${(h.pct * 100).toFixed(1)}%`).join(", ")}${profileContext}\n\nProvide:\n1. Diversification assessment (sector concentration, position sizing)\n2. Risk assessment (beta, leverage exposure, volatility)\n3. Quality assessment (are these quality companies based on metrics?)\n4. 2-3 specific suggestions for improvement`,
            },
          ],
        });

        aiAnalysis = response.choices[0]?.message?.content || null;
      } catch (e) {
        console.error("AI analysis failed:", e);
      }
    }

    return NextResponse.json({
      holdings: enrichedHoldings,
      summary: {
        totalValue,
        totalCostBasis: totalCostBasis > 0 ? totalCostBasis : null,
        totalGainLoss: totalCostBasis > 0 ? totalValue - totalCostBasis : null,
        holdingCount: enrichedHoldings.length,
        weightedBeta,
        sectorBreakdown,
        concentrationRisk: holdingWeights,
      },
      aiAnalysis,
      priceNote: "Prices are as of the most recent market close in our database.",
    });
  } catch (error) {
    console.error("Portfolio analysis error:", error);
    return NextResponse.json({ error: "Failed to analyze portfolio" }, { status: 500 });
  }
}
