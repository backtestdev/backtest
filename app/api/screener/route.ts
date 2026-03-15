import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { NON_COMPANY_PATTERN, SYMBOL_EXCLUSIONS } from "@/lib/stockFilters";
import { computeBacktestScore, computeScoreBreakdown } from "@/lib/backtestScore";

export const dynamic = "force-dynamic";

// Sector display name mapping (FMP sector text → clean display name)
const SECTOR_DISPLAY: Record<string, string> = {
  "Technology": "Technology",
  "Healthcare": "Healthcare",
  "Financial Services": "Financial",
  "Finance": "Financial",
  "Energy": "Energy",
  "Consumer Cyclical": "Consumer",
  "Consumer Defensive": "Consumer",
  "Industrials": "Industrials",
  "Basic Materials": "Basic Materials",
  "Real Estate": "Real Estate",
  "Utilities": "Utilities",
  "Communication Services": "Communication",
};

function sectorName(raw: unknown): string {
  const s = String(raw || "");
  return SECTOR_DISPLAY[s] || s || "Other";
}

// Curated thematic groups - ticker-based for precision
const THEMES: Record<string, string[]> = {
  ai: ["NVDA", "MSFT", "GOOGL", "META", "AMD", "PLTR", "CRM", "SNOW", "AI", "PATH", "UPST", "AMZN", "ORCL", "IBM", "SMCI", "DELL", "AVGO"],
  semiconductors: ["NVDA", "AMD", "INTC", "TSM", "AVGO", "QCOM", "TXN", "MRVL", "ASML", "LRCX", "KLAC", "AMAT", "MU", "ON", "NXPI", "ADI", "MCHP", "SWKS"],
  data_centers: ["EQIX", "DLR", "VRT", "DELL", "HPE", "SMCI", "AMT", "CCI", "ANET", "FFIV"],
  cybersecurity: ["CRWD", "PANW", "FTNT", "ZS", "S", "NET", "OKTA", "CYBR", "RPD", "TENB", "QLYS"],
  cloud: ["AMZN", "MSFT", "GOOGL", "CRM", "SNOW", "DDOG", "NET", "MDB", "CFLT", "TWLO", "ZM", "HUBS", "NOW"],
  ev: ["TSLA", "RIVN", "LCID", "NIO", "LI", "XPEV", "GM", "F", "TM", "BYDDF"],
  biotech: ["ABBV", "AMGN", "GILD", "REGN", "VRTX", "MRNA", "BMY", "BIIB", "ILMN", "ALNY", "SGEN", "DXCM", "INCY", "BGNE", "PCVX"],
  fintech: ["SQ", "PYPL", "SOFI", "AFRM", "COIN", "HOOD", "NU", "FI", "GPN", "FIS", "FISV", "TOST", "BILL", "FOUR", "RPAY"],
  defense: ["LMT", "RTX", "NOC", "GD", "BA", "LHX", "HII", "LDOS", "BWXT", "TDG", "HWM", "KTOS", "RKLB"],
  clean_energy: ["ENPH", "SEDG", "FSLR", "RUN", "PLUG", "BE", "NEE", "AES", "CWEN", "NOVA", "ARRY", "SHLS", "DQ"],
  quantum: ["IONQ", "RGTI", "QBTS", "QUBT", "ARQQ", "IBM", "GOOGL", "MSFT", "HON", "INTC"],
};

export async function GET(request: NextRequest) {
  const sql = getDb();
  if (!sql) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const sortBy = searchParams.get("sort") || "backtest_score";
  const sortDir = searchParams.get("dir") || "desc";
  const sectorFilter = searchParams.get("sector") || "";
  const industryFilter = searchParams.get("industry") || "";
  const themeFilter = searchParams.get("theme") || "";
  const search = (searchParams.get("search") || "").trim();
  const tickersParam = (searchParams.get("tickers") || "").trim();
  const minMarketCap = Number(searchParams.get("minCap")) || 0;
  const maxMarketCap = Number(searchParams.get("maxCap")) || 0;
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const perPage = search ? 10 : 50;

  try {
    const allStocks = await sql`
      SELECT symbol, company_name AS name, sector, industry,
             price_to_earnings_ratio AS pe_ratio,
             price_to_book_ratio AS price_to_book,
             price_to_earnings_growth_ratio AS peg_ratio,
             ev_to_ebitda, price_to_fair_value, earnings_yield,
             return_on_equity AS roe,
             return_on_invested_capital AS roic,
             return_on_assets,
             net_profit_margin AS profit_margin,
             gross_profit_margin, operating_profit_margin,
             revenue_growth_yoy AS revenue_growth,
             earnings_growth_yoy AS earnings_growth,
             dividend_yield,
             dividend_payout_ratio AS payout_ratio,
             debt_to_equity_ratio AS debt_to_equity,
             current_ratio, interest_coverage_ratio,
             free_cash_flow_yield, free_cash_flow_per_share,
             market_cap, beta,
             consecutive_net_income_growth_years AS consecutive_earnings_growth,
             revenue_growth_positive_3yr_count,
             CASE WHEN year_high > 0 THEN price / year_high ELSE 0 END AS week52_high_pct
      FROM stocks
      WHERE market_cap IS NOT NULL AND market_cap > 0.1
        AND is_etf IS NOT TRUE
        AND company_name !~* ${NON_COMPANY_PATTERN}
    `;

    // Enrich with computed log_market_cap for size-confidence scoring
    const enriched = allStocks.map((stock) => {
      const mcapBillions = (Number(stock.market_cap) || 0) / 1_000_000_000;
      return {
        ...(stock as unknown as Record<string, unknown>),
        log_market_cap: mcapBillions > 0 ? Math.log10(mcapBillions) : -1,
      };
    });

    const scoreMap = computeBacktestScore(enriched);

    // Deduplicate GOOG/GOOGL - keep GOOGL (Class A), drop GOOG (Class C)
    // Also exclude blocklisted symbols (non-operating entities)
    const googlExists = allStocks.some((s) => s.symbol === "GOOGL");
    const dedupedStocks = allStocks.filter((s) => {
      if (SYMBOL_EXCLUSIONS.has(s.symbol as string)) return false;
      if (googlExists && s.symbol === "GOOG") return false;
      return true;
    });

    // Build result with all fields
    let filtered = dedupedStocks.map((stock) => ({
      symbol: stock.symbol as string,
      name: stock.name as string,
      sector: sectorName(stock.sector),
      industry: String(stock.industry || ""),
      marketCap: (Number(stock.market_cap) || 0) / 1_000_000_000,
      peRatio: stock.pe_ratio !== null && Number(stock.pe_ratio) > 0 ? Number(stock.pe_ratio) : null,
      roe: stock.roe !== null ? Number(stock.roe) : null,
      revenueGrowth: stock.revenue_growth !== null ? Number(stock.revenue_growth) : null,
      earningsGrowth: stock.earnings_growth !== null ? Number(stock.earnings_growth) : null,
      earningsYield: stock.earnings_yield !== null ? Number(stock.earnings_yield) : null,
      profitMargin: stock.profit_margin !== null ? Number(stock.profit_margin) : null,
      dividendYield: stock.dividend_yield !== null ? Number(stock.dividend_yield) : null,
      debtToEquity: stock.debt_to_equity !== null ? Number(stock.debt_to_equity) : null,
      beta: stock.beta !== null ? Number(stock.beta) : null,
      evToEbitda: stock.ev_to_ebitda !== null ? Number(stock.ev_to_ebitda) : null,
      freeCashFlowYield: stock.free_cash_flow_yield !== null ? Number(stock.free_cash_flow_yield) : null,
      consecutiveEarningsGrowth: Number(stock.consecutive_earnings_growth) || 0,
      currentRatio: stock.current_ratio !== null ? Number(stock.current_ratio) : null,
      backtestScore: scoreMap.get(stock.symbol as string) || 0,
    }));

    // Batch ticker lookup - returns scores for specific tickers (no pagination)
    if (tickersParam) {
      const tickerSet = new Set(tickersParam.split(",").map(t => t.trim().toUpperCase()).filter(Boolean));
      const matched = filtered.filter((s) => tickerSet.has(s.symbol));
      // Include score breakdown for single-ticker lookups
      let scoreBreakdown = null;
      if (tickerSet.size === 1) {
        const singleTicker = Array.from(tickerSet)[0];
        scoreBreakdown = computeScoreBreakdown(singleTicker, enriched);
      }
      return NextResponse.json({
        stocks: matched,
        totalCount: matched.length,
        page: 1,
        perPage: matched.length,
        scoreBreakdown,
      });
    }

    // Search filter
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(
        (s) => s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
      );
    }

    // Sector filter
    if (sectorFilter) {
      filtered = filtered.filter((s) => s.sector.toLowerCase() === sectorFilter.toLowerCase());
    }

    // Industry filter
    if (industryFilter) {
      filtered = filtered.filter((s) => s.industry.toLowerCase() === industryFilter.toLowerCase());
    }

    // Theme filter - curated ticker lists
    if (themeFilter && THEMES[themeFilter]) {
      const themeTickers = new Set(THEMES[themeFilter]);
      filtered = filtered.filter((s) => themeTickers.has(s.symbol));
    }

    if (minMarketCap > 0) {
      filtered = filtered.filter((s) => s.marketCap >= minMarketCap);
    }
    if (maxMarketCap > 0) {
      filtered = filtered.filter((s) => s.marketCap <= maxMarketCap);
    }

    // Sort
    type StockResult = typeof filtered[0];
    const sortKey: keyof StockResult = sortBy === "backtest_score" ? "backtestScore"
      : sortBy === "market_cap" ? "marketCap"
      : sortBy === "pe_ratio" ? "peRatio"
      : sortBy === "roe" ? "roe"
      : sortBy === "earnings_yield" ? "earningsYield"
      : sortBy === "earnings_growth" ? "earningsGrowth"
      : sortBy === "revenue_growth" ? "revenueGrowth"
      : sortBy === "dividend_yield" ? "dividendYield"
      : "backtestScore";

    filtered.sort((a, b) => {
      const aVal = (a[sortKey] as number | null) ?? -Infinity;
      const bVal = (b[sortKey] as number | null) ?? -Infinity;
      return sortDir === "desc" ? bVal - aVal : aVal - bVal;
    });

    const totalCount = filtered.length;
    const paginated = filtered.slice((page - 1) * perPage, page * perPage);

    // Unique sectors for filter dropdown
    const sectors = Array.from(new Set(dedupedStocks.map((s) => sectorName(s.sector)).filter((s) => s !== "Other"))).sort();

    // Unique industries for autocomplete
    const industries = Array.from(new Set(dedupedStocks.map((s) => String(s.industry || "")).filter(Boolean))).sort();

    // Freshness metadata - when were scores and data last updated
    const freshness = await sql`
      SELECT key, value FROM stock_meta WHERE key IN ('last_populate', 'last_signal_refresh')
    `.catch(() => []);
    const lastDataRefresh = freshness.find((r) => r.key === "last_populate")?.value as string | undefined;
    const lastScoreRefresh = freshness.find((r) => r.key === "last_signal_refresh")?.value as string | undefined;

    return NextResponse.json({
      stocks: paginated,
      totalCount,
      page,
      perPage,
      sectors,
      industries,
      dataFreshness: {
        lastDataRefresh: lastDataRefresh || null,
        lastScoreRefresh: lastScoreRefresh || null,
      },
    });
  } catch (error) {
    console.error("Screener error:", error);
    return NextResponse.json({ error: "Failed to load stocks" }, { status: 500 });
  }
}
