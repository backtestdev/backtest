import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import OpenAI from "openai";

export const dynamic = "force-dynamic";

interface Holding {
  symbol: string;
  shares: number;
  costBasis?: number; // per-share cost basis
  assetType?: "stock" | "bond" | "mutual_fund" | "option" | "401k" | "crypto" | "other";
  currentValue?: number;      // total current value (for non-share assets)
  initialInvestment?: number; // total cost basis (for non-share assets)
}

interface UserProfile {
  age?: number;
  riskTolerance?: "conservative" | "moderate" | "aggressive";
  netWorth?: string;
}

// Normalize FMP sector strings to display names
function normalizeSector(raw: string | null | undefined): string {
  if (!raw) return "Unknown";
  const s = raw.trim().toLowerCase();
  if (s.includes("technology") || s.includes("tech")) return "Technology";
  if (s.includes("health")) return "Healthcare";
  if (s.includes("financial") || s.includes("finance")) return "Financial";
  if (s.includes("energy")) return "Energy";
  if (s.includes("consumer")) return "Consumer";
  if (s.includes("industrial")) return "Industrials";
  if (s.includes("basic material")) return "Basic Materials";
  if (s.includes("real estate")) return "Real Estate";
  if (s.includes("utilit")) return "Utilities";
  if (s.includes("communication")) return "Communication Services";
  return "Other";
}

// Known index fund / ETF → display name + sector treatment
const INDEX_FUND_MAP: Record<string, string> = {
  VOO: "S&P 500 Index Fund",
  SPY: "S&P 500 ETF",
  IVV: "S&P 500 Index Fund",
  VTI: "Total US Stock Market",
  VXUS: "International Stock Fund",
  VT: "Total World Stock Fund",
  QQQ: "Nasdaq-100 ETF",
  VUG: "US Growth Fund",
  VTV: "US Value Fund",
  BND: "Total Bond Market",
  AGG: "US Aggregate Bond",
  SCHD: "US Dividend ETF",
  ITOT: "Total US Stock Market",
  SPTM: "Total US Stock Market",
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

    // Fetch stock data for all holdings - include price from stocks table as fallback
    const stockRows = await sql`
      SELECT symbol, company_name AS name, sector, market_cap, price,
             price_to_earnings_ratio AS pe_ratio,
             return_on_equity AS roe,
             net_profit_margin AS profit_margin,
             revenue_growth_yoy AS revenue_growth,
             earnings_growth_yoy AS earnings_growth,
             dividend_yield,
             debt_to_equity_ratio AS debt_to_equity,
             beta,
             price_to_book_ratio AS price_to_book,
             free_cash_flow_yield,
             return_on_invested_capital AS roic
      FROM stocks
      WHERE symbol = ANY(${symbols})
    `;

    // Fetch latest prices from stock_prices table (most accurate)
    const priceRows = await sql`
      SELECT DISTINCT ON (symbol) symbol, close_price, date
      FROM stock_prices
      WHERE symbol = ANY(${symbols})
      ORDER BY symbol, date DESC
    `;

    const stockMap = new Map(stockRows.map((r) => [r.symbol as string, r]));
    const priceMap = new Map(priceRows.map((r) => [r.symbol as string, { price: Number(r.close_price), date: r.date }]));

    // Asset type → sector category mapping for non-stock types
    const assetTypeCategories: Record<string, string> = {
      bond: "Fixed Income",
      option: "Derivatives",
      "401k": "Retirement",
      crypto: "Crypto",
    };

    // Build enriched holdings (one per input row - consolidation happens client-side)
    const enrichedHoldings = holdings.map((h) => {
      const sym = h.symbol.toUpperCase();
      const stock = stockMap.get(sym);
      const priceInfo = priceMap.get(sym);
      const isIndexFund = sym in INDEX_FUND_MAP;
      const assetType = h.assetType || "stock";
      const isValueBased = assetType !== "stock" && assetType !== "mutual_fund";

      let currentPrice: number;
      let currentValue: number;
      let costBasisTotal: number | null;
      let gainLoss: number | null;
      let gainLossPct: number | null;

      if (isValueBased && h.currentValue && h.currentValue > 0) {
        // Non-stock with manual current value - use directly
        currentValue = h.currentValue;
        currentPrice = h.shares > 0 ? h.currentValue / h.shares : 0;
        costBasisTotal = h.initialInvestment || null;
        gainLoss = costBasisTotal !== null ? currentValue - costBasisTotal : null;
        gainLossPct = costBasisTotal !== null && costBasisTotal > 0
          ? (currentValue - costBasisTotal) / costBasisTotal : null;
      } else {
        // Stock/mutual fund or value-based without override: shares × price lookup
        const dbPrice = priceInfo?.price || (stock?.price ? Number(stock.price) : 0);
        currentPrice = dbPrice > 0 ? dbPrice : (h.costBasis || 0);
        currentValue = currentPrice * h.shares;
        costBasisTotal = h.costBasis ? h.costBasis * h.shares : null;
        gainLoss = costBasisTotal !== null && dbPrice > 0 ? currentValue - costBasisTotal : null;
        gainLossPct = costBasisTotal !== null && costBasisTotal > 0 && dbPrice > 0
          ? (currentValue - costBasisTotal) / costBasisTotal : null;
      }

      // Determine sector
      let sector: string;
      if (isIndexFund) {
        sector = "Index Fund";
      } else if (isValueBased && assetTypeCategories[assetType]) {
        sector = assetTypeCategories[assetType];
      } else if (stock) {
        sector = normalizeSector(stock.sector as string);
      } else {
        sector = "Unknown";
      }

      return {
        symbol: sym,
        name: stock?.name || INDEX_FUND_MAP[sym] || sym,
        shares: h.shares,
        currentPrice,
        priceDate: priceInfo?.date || null,
        currentValue,
        costBasis: h.costBasis || null,
        costBasisTotal,
        gainLoss,
        gainLossPct,
        sector,
        assetType,
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

    // Concentration risk (consolidate by symbol for accurate weights)
    const symbolValues: Record<string, number> = {};
    for (const h of enrichedHoldings) {
      symbolValues[h.symbol] = (symbolValues[h.symbol] || 0) + h.currentValue;
    }
    const holdingWeights = Object.entries(symbolValues)
      .map(([symbol, value]) => ({ symbol, pct: totalValue > 0 ? value / totalValue : 0 }))
      .sort((a, b) => b.pct - a.pct);

    // Portfolio beta (weighted)
    const weightedBeta = enrichedHoldings.reduce((sum, h) => {
      const beta = h.metrics?.beta || (h.symbol in INDEX_FUND_MAP ? 1.0 : 1);
      const weight = totalValue > 0 ? h.currentValue / totalValue : 0;
      return sum + beta * weight;
    }, 0);

    // AI analysis - senior wealth advisor tone
    let aiAnalysis: string | null = null;
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) {
      try {
        const openai = new OpenAI({ apiKey: openaiKey });

        // Consolidate holdings by symbol for the AI summary
        const consolidated: Record<string, { name: string; totalValue: number; sector: string; assetType: string; metrics: typeof enrichedHoldings[0]["metrics"] }> = {};
        for (const h of enrichedHoldings) {
          if (!consolidated[h.symbol]) {
            consolidated[h.symbol] = { name: h.name, totalValue: 0, sector: h.sector, assetType: h.assetType, metrics: h.metrics };
          }
          consolidated[h.symbol].totalValue += h.currentValue;
        }

        const holdingSummary = Object.entries(consolidated).map(([sym, data]) => {
          const weight = totalValue > 0 ? ((data.totalValue / totalValue) * 100).toFixed(1) : "0";
          const m = data.metrics;
          const typeLabel = data.assetType !== "stock" ? ` [${data.assetType}]` : "";
          const isValueBased = data.assetType !== "stock" && data.assetType !== "mutual_fund";
          if (isValueBased) {
            return `${sym}${typeLabel} (${data.name}): ${weight}% of portfolio, category: ${data.sector}, value: $${data.totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
          }
          return `${sym}${typeLabel} (${data.name}): ${weight}% of portfolio, sector: ${data.sector}, P/E: ${m?.peRatio?.toFixed(1) || "N/A"}, ROE: ${m?.roe ? (m.roe * 100).toFixed(1) + "%" : "N/A"}, Revenue Growth: ${m?.revenueGrowth ? (m.revenueGrowth * 100).toFixed(1) + "%" : "N/A"}, Dividend Yield: ${m?.dividendYield ? (m.dividendYield * 100).toFixed(1) + "%" : "N/A"}, Beta: ${m?.beta?.toFixed(2) || "N/A"}`;
        }).join("\n");

        // Asset class breakdown for AI context
        const assetClassAlloc: Record<string, number> = {};
        Object.entries(consolidated).forEach(([, data]) => {
          const cls = data.assetType || "stock";
          assetClassAlloc[cls] = (assetClassAlloc[cls] || 0) + data.totalValue;
        });
        const assetClassBreakdown = Object.entries(assetClassAlloc)
          .map(([cls, val]) => `${cls}: ${totalValue > 0 ? ((val / totalValue) * 100).toFixed(1) : 0}%`)
          .join(", ");
        const hasNonStockAssets = Object.keys(assetClassAlloc).some(k => k !== "stock");

        const profileContext = profile
          ? `\n\nINVESTOR PROFILE (use this to tailor every recommendation - reference it explicitly when it influences your advice):\n- Age: ${profile.age || "not provided"}\n- Risk tolerance: ${profile.riskTolerance || "not provided"}\n- Estimated net worth: ${profile.netWorth || "not provided"}`
          : "";

        const response = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          max_tokens: 1200,
          messages: [
            {
              role: "system",
              content: `You are a senior wealth management advisor at a top-tier firm, providing a portfolio review. Your tone is professional, direct, and confident - like a seasoned advisor speaking to a client in a private meeting.

Today's date is ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}. Base your analysis on current market conditions as of today. Do NOT reference any knowledge cutoff date.

FORMAT RULES:
- Use markdown: ## for section headers, **bold** for emphasis, bullet points for lists
- Keep total response 250-400 words
- Be specific: name tickers, percentages, and concrete actions
- When the investor profile is provided, explicitly reference it when it shapes a recommendation (e.g., "Given your age of 28 and aggressive risk tolerance...")
- Never give specific buy/sell price targets
- End with a brief disclaimer in italics

SECTIONS TO INCLUDE:
## Portfolio Overview
A 2-3 sentence executive summary of the portfolio's character (growth-heavy? concentrated? balanced?).

## Key Strengths
2-3 specific positives (e.g., "Strong NVDA position capturing AI growth at 35% of portfolio").

## Risk Factors
2-3 specific risks with context (e.g., "70% Technology sector - a single sector downturn would hit hard").

## Recommendations
3-4 specific, actionable recommendations. These should be the kind of advice a top wealth advisor would give - not generic platitudes. Consider:
- Position sizing (any holdings too large or too small to matter?)
- Sector diversification gaps
- Income vs growth balance for the investor's stage of life
- Quality of holdings (are any speculative/low-quality?)
- Missing asset classes (international, bonds, REITs, etc.)
- If the portfolio includes non-stock assets (bonds, options, 401k, crypto, etc.), comment on asset allocation across asset classes and how alternative assets affect the portfolio's risk profile`,
            },
            {
              role: "user",
              content: `Portfolio value: $${totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })} | Beta: ${weightedBeta.toFixed(2)} | ${Object.keys(consolidated).length} unique holdings\n\n${holdingSummary}\n\nSector breakdown: ${sectorBreakdown.map((s) => `${s.sector}: ${(s.pct * 100).toFixed(1)}%`).join(", ")}${hasNonStockAssets ? `\n\nAsset class breakdown: ${assetClassBreakdown}` : ""}\n\nTop positions: ${holdingWeights.slice(0, 5).map((h) => `${h.symbol}: ${(h.pct * 100).toFixed(1)}%`).join(", ")}${profileContext}`,
            },
          ],
        });

        aiAnalysis = response.choices[0]?.message?.content || null;
      } catch (e) {
        console.error("AI analysis failed:", e);
      }
    }

    // Unique holding count (by symbol, not lot)
    const uniqueSymbols = new Set(enrichedHoldings.map((h) => h.symbol));

    return NextResponse.json({
      holdings: enrichedHoldings,
      summary: {
        totalValue,
        totalCostBasis: totalCostBasis > 0 ? totalCostBasis : null,
        totalGainLoss: totalCostBasis > 0 ? totalValue - totalCostBasis : null,
        holdingCount: uniqueSymbols.size,
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
