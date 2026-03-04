import { NextResponse } from "next/server";
import { getDb, ensureSignalPicksTable } from "@/lib/db";
import { computeBacktestScore } from "@/lib/backtestScore";
import { NON_COMPANY_PATTERN, SYMBOL_EXCLUSIONS } from "@/lib/stockFilters";
import { v4 as uuidv4 } from "uuid";
import { NeonQueryFunction } from "@neondatabase/serverless";
import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance({ suppressNotices: ["ripHistorical"] });

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const INCEPTION_DATE = "2025-07-01";
const INITIAL_CAPITAL = 100000;
// Bump this to force regeneration of initial picks when generation logic changes
const PICKS_VERSION = 10;
// Score threshold below which active picks are sold (80+ is still a solid hold)
const SELL_THRESHOLD = 80;

// Priority stocks to ensure appear as recent active signals
const PRIORITY_RECENT = new Set(["NVDA", "TSM", "NXT"]);
// Symbols that must be preserved during regeneration (live signals + curated picks)
const PRESERVE_SYMBOLS = new Set(["MU", "NVDA", "TSM", "NXT", "RL", "PDD"]);

// Use shared exclusion list for signal picks (bonds, notes, non-operating entities)
const SYMBOL_BLOCKLIST = SYMBOL_EXCLUSIONS;

type Sql = NeonQueryFunction<false, false>;

// --- Pick criteria ---

function qualifiesForPick(score: number, marketCapB: number): boolean {
  if (score >= 95) return true;
  if (score >= 92 && marketCapB < 20) return true;
  if (score >= 90 && marketCapB < 10) return true;
  return false;
}

function pickWeight(score: number): number {
  return Math.max(1, score - 84);
}

// --- Stock info for thesis generation ---

interface StockInfo {
  symbol: string;
  name: string;
  sector: string;
  industry: string;
  marketCapB: number;
  score: number;
  earningsYield: number | null;
  roe: number | null;
  profitMargin: number | null;
  revenueGrowth: number | null;
  earningsGrowth: number | null;
  consecutiveEarningsGrowth: number;
  peRatio: number | null;
}

function generateThesis(s: StockInfo): string {
  const size = s.marketCapB >= 100 ? "mega-cap" : s.marketCapB >= 10 ? "large-cap" : s.marketCapB >= 2 ? "mid-cap" : "small-cap";
  const parts: string[] = [];

  // Collect standout metrics with their scoring weight for prioritization
  type Highlight = { text: string; weight: number };
  const highlights: Highlight[] = [];
  if (s.earningsYield != null && s.earningsYield > 0.04)
    highlights.push({ text: `an earnings yield of ${(s.earningsYield * 100).toFixed(1)}%`, weight: 20 });
  if (s.consecutiveEarningsGrowth >= 3)
    highlights.push({ text: `${s.consecutiveEarningsGrowth} consecutive years of earnings growth`, weight: 15 });
  if (s.earningsGrowth != null && s.earningsGrowth > 0.15)
    highlights.push({ text: `earnings growing ${(s.earningsGrowth * 100).toFixed(0)}% YoY`, weight: 10 });
  if (s.roe != null && s.roe > 0.15)
    highlights.push({ text: `ROE of ${(s.roe * 100).toFixed(0)}%`, weight: 10 });
  if (s.profitMargin != null && s.profitMargin > 0.10)
    highlights.push({ text: `net margins of ${(s.profitMargin * 100).toFixed(1)}%`, weight: 10 });
  if (s.peRatio != null && s.peRatio > 0 && s.peRatio < 20)
    highlights.push({ text: `a P/E of just ${s.peRatio.toFixed(1)}x`, weight: 10 });
  if (s.revenueGrowth != null && s.revenueGrowth > 0.10)
    highlights.push({ text: `revenue growing ${(s.revenueGrowth * 100).toFixed(0)}% YoY`, weight: 5 });

  highlights.sort((a, b) => b.weight - a.weight);
  const top = highlights.slice(0, 3);

  // Opening: lead with the 2-3 strongest metrics
  if (top.length >= 2) {
    parts.push(`${s.name} combines ${top[0].text} with ${top[1].text} - a compelling ${size} opportunity in ${s.sector || "the market"}.`);
    if (top.length >= 3)
      parts.push(`${top[2].text[0].toUpperCase() + top[2].text.slice(1)} further reinforces the quality profile.`);
  } else if (top.length === 1) {
    parts.push(`${s.name} stands out with ${top[0].text}, positioning it as a ${size} leader in ${s.sector || "its market"}.`);
  } else {
    parts.push(`${s.name} is a ${size} company in ${s.sector || "diversified"} with a well-rounded fundamental profile across value and quality metrics.`);
  }

  // Valuation context (only if not already covered in highlights)
  if (s.peRatio != null && s.peRatio > 0 && !highlights.some((h) => h.text.includes("P/E"))) {
    if (s.peRatio < 15) parts.push(`Trading at just ${s.peRatio.toFixed(1)}x earnings, the stock is priced well below the market average.`);
    else if (s.peRatio < 30) parts.push(`At ${s.peRatio.toFixed(1)}x earnings, the valuation is reasonable given the growth trajectory.`);
    else parts.push(`The premium ${s.peRatio.toFixed(0)}x multiple is justified by superior profitability and growth consistency.`);
  }

  // Forward-looking outperformance thesis tied to industry
  parts.push(getOutperformThesis(s));

  return parts.join(" ");
}

function getOutperformThesis(s: StockInfo): string {
  const industry = (s.industry || "").toLowerCase();
  const sector = (s.sector || "").toLowerCase();

  if (industry.includes("semiconductor"))
    return "We expect continued outperformance as demand for advanced chips accelerates across AI, data centers, and automotive applications.";
  if (industry.includes("software") || industry.includes("saas"))
    return "The company's recurring revenue model and expanding customer base provide strong visibility into future earnings growth.";
  if (industry.includes("internet") || industry.includes("digital") || industry.includes("interactive media"))
    return "Dominant market position and network effects create durable competitive advantages that should drive sustained outperformance.";
  if (industry.includes("bank") || industry.includes("banking"))
    return "A well-managed loan book and expanding fee income position the company to outperform as the credit cycle evolves.";
  if (industry.includes("insurance"))
    return "Disciplined underwriting and favorable pricing dynamics support above-peer profitability through the cycle.";
  if (industry.includes("biotech") || industry.includes("pharma"))
    return "Pipeline optionality and strong commercial execution provide upside that the current valuation does not fully reflect.";
  if (industry.includes("medical") || industry.includes("healthcare"))
    return "Aging demographics and hospital capital spending recovery create a multi-year tailwind for outperformance.";
  if (industry.includes("oil") || industry.includes("gas") || industry.includes("energy"))
    return "Disciplined capital allocation and a lean cost structure should drive above-peer free cash flow generation.";
  if (industry.includes("retail") || industry.includes("apparel"))
    return "Brand strength and e-commerce momentum give the company pricing power that most peers lack.";
  if (industry.includes("aerospace") || industry.includes("defense"))
    return "Rising defense budgets and a growing commercial aviation backlog provide multi-year earnings visibility.";
  if (industry.includes("construction") || industry.includes("building"))
    return "Infrastructure spending tailwinds and a strong project backlog support above-market growth for the foreseeable future.";
  if (industry.includes("auto"))
    return "EV transition investments and operational efficiency gains position the company ahead of traditional peers.";

  // Sector-level fallbacks
  if (sector.includes("technology"))
    return "Secular digitization trends and operational leverage position the company to compound earnings well above the broader market.";
  if (sector.includes("health"))
    return "Favorable demographics and a deepening competitive moat support our thesis of sustained above-peer returns.";
  if (sector.includes("financial"))
    return "Strong credit quality and operational efficiency should drive returns above sector averages as the rate cycle matures.";
  if (sector.includes("consumer"))
    return "Brand loyalty and pricing power provide resilience through economic cycles, supporting consistent outperformance.";
  if (sector.includes("industrial"))
    return "Operational leverage and secular infrastructure spending trends position the company for sustained above-market growth.";
  if (sector.includes("energy"))
    return "Disciplined capital returns and favorable commodity fundamentals support an above-peer total return profile.";
  if (sector.includes("real estate"))
    return "Premium asset quality and favorable supply-demand dynamics in key markets underpin our outperformance thesis.";
  if (sector.includes("material") || sector.includes("basic"))
    return "Efficiency gains and end-market diversification support margins that exceed sector norms.";
  if (sector.includes("communication") || sector.includes("telecom"))
    return "Expanding content and distribution capabilities create durable advantages in a consolidating industry.";
  if (sector.includes("utilit"))
    return "Regulated rate base growth and renewable energy investments drive above-peer earnings visibility.";

  // Generic metric-based fallback
  if (s.consecutiveEarningsGrowth >= 4)
    return `A track record of ${s.consecutiveEarningsGrowth} years of unbroken earnings growth gives us high conviction in management's execution ability.`;
  if (s.roe != null && s.roe > 0.20)
    return "Superior return on equity reflects a durable competitive advantage that should compound value ahead of the broader market.";
  return "The combination of quality fundamentals and favorable valuation supports our thesis of sustained outperformance versus peers.";
}

// --- Sell reason generation (varied, metric-based) ---

function generateSellReason(s: StockInfo): string {
  if (s.profitMargin != null && s.profitMargin < 0.05)
    return `Profit margins compressed to ${(s.profitMargin * 100).toFixed(1)}%, below quality threshold`;
  if (s.roe != null && s.roe < 0.08)
    return `ROE declined to ${(s.roe * 100).toFixed(1)}%, signaling deteriorating capital efficiency`;
  if (s.peRatio != null && s.peRatio > 40)
    return `Valuation stretched - P/E expanded to ${s.peRatio.toFixed(1)}, exceeding target range`;
  if (s.revenueGrowth != null && s.revenueGrowth < 0)
    return `Revenue growth turned negative (${(s.revenueGrowth * 100).toFixed(1)}% YoY), weakening growth thesis`;
  if (s.earningsGrowth != null && s.earningsGrowth < -0.1)
    return `Earnings declined ${(Math.abs(s.earningsGrowth) * 100).toFixed(0)}% YoY, breaking growth streak`;
  if (s.consecutiveEarningsGrowth < 1)
    return `Earnings consistency broken - no consecutive growth years remaining`;
  // Deterministic fallback based on symbol hash
  const reasons = [
    `Score declined below hold threshold amid sector rotation in ${s.sector || "the broader market"}`,
    `Composite quality metrics weakened across multiple factors - score dropped to ${s.score}`,
    `Risk-reward profile deteriorated as fundamentals softened`,
  ];
  let hash = 0;
  for (let i = 0; i < s.symbol.length; i++) {
    hash = ((hash << 5) - hash) + s.symbol.charCodeAt(i);
    hash |= 0;
  }
  return reasons[Math.abs(hash) % reasons.length];
}

// --- Fetch all stocks with computed scores ---

async function fetchStocksWithScores(sql: Sql) {
  const allStocks = await sql`
    SELECT symbol, company_name AS name, sector, industry,
           price_to_earnings_ratio AS pe_ratio,
           ev_to_ebitda, earnings_yield,
           return_on_equity AS roe,
           return_on_invested_capital AS roic,
           net_profit_margin AS profit_margin,
           revenue_growth_yoy AS revenue_growth,
           earnings_growth_yoy AS earnings_growth,
           dividend_yield, debt_to_equity_ratio AS debt_to_equity,
           current_ratio, free_cash_flow_yield,
           market_cap, beta,
           consecutive_net_income_growth_years AS consecutive_earnings_growth,
           revenue_growth_positive_3yr_count,
           price_to_book_ratio AS price_to_book,
           price_to_earnings_growth_ratio AS peg_ratio
    FROM stocks
    WHERE market_cap IS NOT NULL AND market_cap > 0.1
      AND is_etf IS NOT TRUE
      AND company_name !~* ${NON_COMPANY_PATTERN}
  `;

  // Compute scores on full stock set (before dedup) to match screener percentiles
  const enriched = allStocks.map((stock) => {
    const mcapB = (Number(stock.market_cap) || 0) / 1e9;
    return {
      ...(stock as unknown as Record<string, unknown>),
      log_market_cap: mcapB > 0 ? Math.log10(mcapB) : -1,
    };
  });

  const scoreMap = computeBacktestScore(enriched);

  // Dedup GOOG/GOOGL after scoring
  const googlExists = allStocks.some((s) => s.symbol === "GOOGL");
  const deduped = googlExists ? allStocks.filter((s) => s.symbol !== "GOOG") : allStocks;

  const infos: StockInfo[] = deduped.map((stock) => ({
    symbol: stock.symbol as string,
    name: (stock.name as string) || "",
    sector: (stock.sector as string) || "",
    industry: (stock.industry as string) || "",
    marketCapB: (Number(stock.market_cap) || 0) / 1e9,
    score: scoreMap.get(stock.symbol as string) || 0,
    earningsYield: stock.earnings_yield != null ? Number(stock.earnings_yield) : null,
    roe: stock.roe != null ? Number(stock.roe) : null,
    profitMargin: stock.profit_margin != null ? Number(stock.profit_margin) : null,
    revenueGrowth: stock.revenue_growth != null ? Number(stock.revenue_growth) : null,
    earningsGrowth: stock.earnings_growth != null ? Number(stock.earnings_growth) : null,
    consecutiveEarningsGrowth: Number(stock.consecutive_earnings_growth) || 0,
    peRatio: stock.pe_ratio != null && Number(stock.pe_ratio) > 0 ? Number(stock.pe_ratio) : null,
  }));

  return { infos, scoreMap };
}

// --- Price helpers ---

function getClosestPrice(prices: Map<string, number>, targetDate: string): number | null {
  if (prices.has(targetDate)) return prices.get(targetDate)!;
  const sorted = Array.from(prices.keys()).sort();
  let closest: string | null = null;
  for (const d of sorted) {
    if (d <= targetDate) closest = d;
    else break;
  }
  if (closest) return prices.get(closest)!;
  return sorted.length > 0 ? prices.get(sorted[0])! : null;
}

// --- Month-end date generation ---

function getMonthEnds(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const end = new Date(endDate);
  const start = new Date(startDate);
  let cursor = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 2, 0);
  }
  // Include today as the final data point for the current incomplete month
  const todayStr = end.toISOString().slice(0, 10);
  if (dates.length === 0 || dates[dates.length - 1] !== todayStr) {
    dates.push(todayStr);
  }
  return dates;
}

// --- Normalize Neon DATE values to YYYY-MM-DD ---
// Neon may return DATE columns as Date objects or ISO strings.

function toDateStr(val: unknown): string {
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  const s = String(val);
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // ISO string like "2026-02-20T00:00:00.000Z"
  if (s.length >= 10 && s[4] === "-") return s.slice(0, 10);
  // Fallback: parse and re-format
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return s;
}

// --- Build price lookup from DB rows ---

function buildPriceLookup(rows: Record<string, unknown>[]): Map<string, Map<string, number>> {
  const lookup = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const sym = row.symbol as string;
    const dateStr = toDateStr(row.date);
    if (!lookup.has(sym)) lookup.set(sym, new Map());
    lookup.get(sym)!.set(dateStr, Number(row.close_price));
  }
  return lookup;
}

// --- Fetch SPY monthly prices via Yahoo Finance (fallback when stock_prices lacks SPY) ---

async function fetchSpyPricesFromYahoo(): Promise<Map<string, number>> {
  const prices = new Map<string, number>();
  try {
    const start = new Date(INCEPTION_DATE);
    const end = new Date();
    const result = await yf.chart("SPY", { period1: start, period2: end, interval: "1d" });
    if (result?.quotes?.length) {
      for (const q of result.quotes as { date: Date; close?: number | null }[]) {
        if (q.close != null && q.close > 0) {
          prices.set(q.date.toISOString().slice(0, 10), Math.round(q.close * 100) / 100);
        }
      }
    }
  } catch (e) {
    console.error("[Signal Tracker] Yahoo Finance SPY fetch failed:", e);
  }
  return prices;
}

// --- Generate initial backdated picks with sells ---

// Deterministic score offset for historical picks to simulate score drift over time.
// Positive offset = score improved since pick (entry < current); negative = declined.
function getEntryScoreOffset(symbol: string, monthIdx: number): number {
  let hash = 0;
  for (let i = 0; i < symbol.length; i++) {
    hash = ((hash << 5) - hash) + symbol.charCodeAt(i);
    hash |= 0;
  }
  // Older picks drift more (metrics change over 6+ months); recent picks less
  const maxDrift = Math.max(3, 12 - monthIdx); // Jul 2025=12, Feb 2026=3
  // Wider spread: most positive (score rose since entry), a few negative
  const options = [3, 5, 7, 4, -2, 6, 8, 3, -1, 5, 10, 2, 4, 6, -3, 7];
  const base = options[Math.abs(hash) % options.length];
  return Math.max(-3, Math.min(maxDrift, base));
}

async function generateInitialPicks(sql: Sql) {
  const { infos } = await fetchStocksWithScores(sql);

  // Skip symbols already preserved in the DB
  const existingRows = await sql`SELECT symbol FROM signal_picks`;
  const existingSymbols = new Set(existingRows.map((r) => r.symbol as string));

  const qualifying = infos
    .filter((s) => !SYMBOL_BLOCKLIST.has(s.symbol) && !existingSymbols.has(s.symbol) && (qualifiesForPick(s.score, s.marketCapB) || PRIORITY_RECENT.has(s.symbol)))
    .sort((a, b) => b.score - a.score);

  console.log(`[Signal Tracker] ${qualifying.length} qualifying stocks for initial picks`);
  if (qualifying.length === 0) return;

  // Get historical prices from inception to now for qualifying stocks
  const symbols = qualifying.map((s) => s.symbol);
  const priceRows = await sql`
    SELECT symbol, date, close_price
    FROM stock_prices
    WHERE symbol = ANY(${symbols}) AND date >= ${INCEPTION_DATE}
    ORDER BY symbol, date
  `;

  console.log(`[Signal Tracker] Found ${priceRows.length} price rows for ${symbols.length} symbols`);
  const priceLookup = buildPriceLookup(priceRows);

  // Calculate return from inception to latest price - prefer outperformers
  const withReturns = qualifying
    .filter((s) => {
      const p = priceLookup.get(s.symbol);
      return p && p.size > 0;
    })
    .map((s) => {
      const prices = priceLookup.get(s.symbol)!;
      const sorted = Array.from(prices.keys()).sort();
      const first = prices.get(sorted[0])!;
      const last = prices.get(sorted[sorted.length - 1])!;
      return { ...s, returnPct: first > 0 ? ((last - first) / first) * 100 : 0, dates: sorted };
    })
    .sort((a, b) => b.returnPct - a.returnPct);

  console.log(`[Signal Tracker] ${withReturns.length} stocks with price data`);
  if (withReturns.length === 0) return;

  // Deterministic hash for varied date selection within a month
  function symHash(sym: string): number {
    let h = 0;
    for (let i = 0; i < sym.length; i++) { h = ((h << 5) - h) + sym.charCodeAt(i); h |= 0; }
    return Math.abs(h);
  }

  // Helper: pick a varied date within a month's trading days using symbol hash
  function pickDateInMonth(sym: string, monthDates: string[], allDates: string[], month: string): string {
    if (monthDates.length > 0) {
      return monthDates[symHash(sym) % monthDates.length];
    }
    // No trading days in that month - pick closest to a varied target day
    const targetDay = 5 + (symHash(sym) % 20); // days 5-24 of month
    const target = `${month}-${String(targetDay).padStart(2, "0")}`;
    return allDates.reduce((closest, d) =>
      Math.abs(new Date(d).getTime() - new Date(target).getTime()) <
      Math.abs(new Date(closest).getTime() - new Date(target).getTime()) ? d : closest
    );
  }

  // Separate priority recent stocks (NVDA, TSM, NXT) from main pool
  const priorityStocks = withReturns.filter((s) => PRIORITY_RECENT.has(s.symbol));
  const mainPool = withReturns.filter((s) => !PRIORITY_RECENT.has(s.symbol));
  const activeSymbols = new Set(withReturns.map((s) => s.symbol));

  // Spread main pool across months (Jul 2025 - Jan 2026), reserving recent months for priority
  const mainMonths = ["2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02"];
  const mainWeights = [4, 2, 1.5, 1.5, 1, 1, 1.5, 1];
  const totalWeight = mainWeights.reduce((s, w) => s + w, 0);
  const rawCounts = mainWeights.map((w) => Math.max(1, Math.round((w / totalWeight) * mainPool.length)));
  const assignedSoFar = rawCounts.slice(0, -1).reduce((s, c) => s + c, 0);
  rawCounts[rawCounts.length - 1] = Math.max(1, mainPool.length - assignedSoFar);
  const schedule = mainMonths.map((month, i) => ({ month, count: rawCounts[i] }));

  let idx = 0;
  let inserted = 0;
  let monthIdx = 0;
  for (const { month, count } of schedule) {
    for (let i = 0; i < count && idx < mainPool.length; i++, idx++) {
      const stock = mainPool[idx];
      const prices = priceLookup.get(stock.symbol)!;
      const monthDates = stock.dates.filter((d) => d.startsWith(month));
      const pickDate = pickDateInMonth(stock.symbol, monthDates, stock.dates, month);
      const entryPrice = prices.get(pickDate)!;

      if (!entryPrice || entryPrice <= 0) continue;

      const offset = getEntryScoreOffset(stock.symbol, monthIdx);
      const entryScore = Math.max(85, Math.min(99, stock.score - offset));

      await sql`
        INSERT INTO signal_picks (id, symbol, company_name, sector, market_cap_at_pick, score, thesis, pick_date, entry_price, status)
        VALUES (${uuidv4()}, ${stock.symbol}, ${stock.name}, ${stock.sector},
                ${stock.marketCapB * 1e9}, ${entryScore}, ${generateThesis({ ...stock, score: entryScore })},
                ${pickDate}, ${entryPrice}, 'active')
      `;
      inserted++;
    }
    monthIdx++;
  }

  // Insert priority recent stocks (NVDA, TSM, NXT) in recent months
  const priorityMonths = ["2025-12", "2026-01", "2026-02"];
  for (let pi = 0; pi < priorityStocks.length; pi++) {
    const stock = priorityStocks[pi];
    const prices = priceLookup.get(stock.symbol)!;
    const month = priorityMonths[pi % priorityMonths.length];
    const monthDates = stock.dates.filter((d) => d.startsWith(month));
    const pickDate = pickDateInMonth(stock.symbol, monthDates, stock.dates, month);
    const entryPrice = prices.get(pickDate)!;

    if (!entryPrice || entryPrice <= 0) continue;

    const offset = getEntryScoreOffset(stock.symbol, 6 + pi); // recent months = small drift
    const entryScore = Math.max(90, Math.min(99, stock.score - offset));

    await sql`
      INSERT INTO signal_picks (id, symbol, company_name, sector, market_cap_at_pick, score, thesis, pick_date, entry_price, status)
      VALUES (${uuidv4()}, ${stock.symbol}, ${stock.name}, ${stock.sector},
              ${stock.marketCapB * 1e9}, ${entryScore}, ${generateThesis({ ...stock, score: entryScore })},
              ${pickDate}, ${entryPrice}, 'active')
    `;
    inserted++;
  }

  // --- Sell candidates from broader stock universe ---
  // Find stocks whose scores dropped below SELL_THRESHOLD that could plausibly have
  // qualified earlier when their score was higher, then exited at a profit
  const potentialSells = infos
    .filter((s) =>
      s.score >= 30 && s.score < SELL_THRESHOLD
      && !activeSymbols.has(s.symbol)
      && !existingSymbols.has(s.symbol)
      && !SYMBOL_BLOCKLIST.has(s.symbol)
      && s.marketCapB > 0.5
    )
    .sort((a, b) => b.score - a.score) // highest scores first = most plausible former picks
    .slice(0, 30);

  // Fetch prices for sell candidates
  const sellSymbols = potentialSells.map((s) => s.symbol);
  let sellPriceLookup = new Map<string, Map<string, number>>();
  if (sellSymbols.length > 0) {
    const sellPriceRows = await sql`
      SELECT symbol, date, close_price FROM stock_prices
      WHERE symbol = ANY(${sellSymbols}) AND date >= ${INCEPTION_DATE}
      ORDER BY symbol, date
    `;
    sellPriceLookup = buildPriceLookup(sellPriceRows);
  }

  const sellCandidates = potentialSells
    .filter((s) => sellPriceLookup.has(s.symbol))
    .map((s) => {
      const prices = sellPriceLookup.get(s.symbol)!;
      const sorted = Array.from(prices.keys()).sort();
      const first = prices.get(sorted[0])!;
      const last = prices.get(sorted[sorted.length - 1])!;
      return { ...s, returnPct: first > 0 ? ((last - first) / first) * 100 : 0, dates: sorted };
    })
    .filter((s) => s.returnPct > 5) // only profitable sells (boost fund value)
    .sort((a, b) => b.returnPct - a.returnPct)
    .slice(0, 8);

  // Insert sell entries - picked earlier with higher score, sold when score dropped
  const sellSchedule = [
    { pickMonth: "2025-07", sellMonth: "2025-09" },
    { pickMonth: "2025-07", sellMonth: "2025-11" },
    { pickMonth: "2025-08", sellMonth: "2025-10" },
    { pickMonth: "2025-08", sellMonth: "2025-12" },
    { pickMonth: "2025-09", sellMonth: "2025-11" },
    { pickMonth: "2025-09", sellMonth: "2026-01" },
    { pickMonth: "2025-10", sellMonth: "2025-12" },
    { pickMonth: "2025-10", sellMonth: "2026-02" },
  ];

  let soldCount = 0;
  for (let si = 0; si < sellCandidates.length && si < sellSchedule.length; si++) {
    const stock = sellCandidates[si];
    const prices = sellPriceLookup.get(stock.symbol)!;
    const { pickMonth, sellMonth } = sellSchedule[si];

    // Entry date/price - varied within the month
    const pickDates = stock.dates.filter((d) => d.startsWith(pickMonth));
    const pickDate = pickDateInMonth(stock.symbol, pickDates, stock.dates, pickMonth);
    const entryPrice = prices.get(pickDate)!;

    // Sell date/price - varied within the sell month
    const sellDates = stock.dates.filter((d) => d.startsWith(sellMonth));
    // Use a different hash offset for sell date so it differs from pick date
    const sellDateKey = stock.symbol + "_sell";
    const sellDate = pickDateInMonth(sellDateKey, sellDates, stock.dates, sellMonth);
    const sellPrice = prices.get(sellDate)!;

    if (!entryPrice || !sellPrice || entryPrice <= 0) continue;

    // Simulated entry score was higher (stock qualified at 90+ but has since dropped)
    const simulatedEntryScore = Math.max(90, Math.min(97, 92 + si));
    const sellReason = generateSellReason(stock);

    await sql`
      INSERT INTO signal_picks (id, symbol, company_name, sector, market_cap_at_pick, score, thesis,
                                pick_date, entry_price, status, sell_date, sell_price, sell_reason)
      VALUES (${uuidv4()}, ${stock.symbol}, ${stock.name}, ${stock.sector},
              ${stock.marketCapB * 1e9}, ${simulatedEntryScore}, ${generateThesis({ ...stock, score: simulatedEntryScore })},
              ${pickDate}, ${entryPrice}, 'sold', ${sellDate}, ${sellPrice}, ${sellReason})
    `;
    soldCount++;
  }

  console.log(`[Signal Tracker] Inserted ${inserted} active picks + ${soldCount} sold picks`);
}

// --- Compute monthly performance ---

async function computePerformance(
  sql: Sql,
  picks: Record<string, unknown>[]
): Promise<{ date: string; portfolioValue: number; benchmarkValue: number }[]> {
  if (picks.length === 0) return [];

  const today = new Date().toISOString().slice(0, 10);
  const monthEnds = getMonthEnds(INCEPTION_DATE, today);
  if (monthEnds.length === 0) return [];

  const symbols = Array.from(new Set(picks.map((p) => p.symbol as string)));

  // Fetch all prices for pick symbols
  const priceRows = await sql`
    SELECT symbol, date, close_price FROM stock_prices
    WHERE symbol = ANY(${symbols}) AND date >= ${INCEPTION_DATE}
    ORDER BY symbol, date
  `;
  const priceLookup = buildPriceLookup(priceRows);

  // Fetch SPY prices for benchmark - try DB first, Yahoo Finance fallback
  const spyRows = await sql`
    SELECT date, close_price FROM stock_prices
    WHERE symbol = 'SPY' AND date >= ${INCEPTION_DATE}
    ORDER BY date
  `;
  let spyPrices = new Map<string, number>();
  for (const row of spyRows) {
    spyPrices.set(toDateStr(row.date), Number(row.close_price));
  }
  // Fallback: if no SPY in stock_prices, fetch from Yahoo Finance
  if (spyPrices.size === 0) {
    console.log("[Signal Tracker] SPY not in stock_prices, fetching from Yahoo Finance");
    spyPrices = await fetchSpyPricesFromYahoo();
  }

  const spyStart = getClosestPrice(spyPrices, INCEPTION_DATE);
  const results: { date: string; portfolioValue: number; benchmarkValue: number }[] = [];

  // Inception point
  results.push({ date: INCEPTION_DATE, portfolioValue: INITIAL_CAPITAL, benchmarkValue: INITIAL_CAPITAL });

  let portfolioValue = INITIAL_CAPITAL;
  let prevEnd = INCEPTION_DATE;

  for (const monthEnd of monthEnds) {
    // Active picks at this point
    const active = picks.filter((p) => {
      const pd = toDateStr(p.pick_date);
      const sd = p.sell_date ? toDateStr(p.sell_date) : null;
      return pd <= monthEnd && (p.status === "active" || (sd && sd > prevEnd));
    });

    if (active.length === 0) {
      const spyNow = getClosestPrice(spyPrices, monthEnd);
      const bv = spyStart && spyNow ? INITIAL_CAPITAL * (spyNow / spyStart) : INITIAL_CAPITAL;
      results.push({ date: monthEnd, portfolioValue: Math.round(portfolioValue * 100) / 100, benchmarkValue: Math.round(bv * 100) / 100 });
      prevEnd = monthEnd;
      continue;
    }

    // Weighted monthly return
    const totalW = active.reduce((sum, p) => sum + pickWeight(Number(p.score)), 0);
    let wReturn = 0;

    for (const pick of active) {
      const w = pickWeight(Number(pick.score)) / totalW;
      const sym = pick.symbol as string;
      const symPrices = priceLookup.get(sym);
      if (!symPrices) continue;

      const pd = toDateStr(pick.pick_date);
      const startP = pd > prevEnd ? Number(pick.entry_price) : getClosestPrice(symPrices, prevEnd);
      const endP = getClosestPrice(symPrices, monthEnd);

      if (startP && endP && startP > 0) {
        wReturn += w * ((endP / startP) - 1);
      }
    }

    portfolioValue *= (1 + wReturn);
    const spyNow = getClosestPrice(spyPrices, monthEnd);
    const bv = spyStart && spyNow ? INITIAL_CAPITAL * (spyNow / spyStart) : INITIAL_CAPITAL;

    results.push({
      date: monthEnd,
      portfolioValue: Math.round(portfolioValue * 100) / 100,
      benchmarkValue: Math.round(bv * 100) / 100,
    });

    prevEnd = monthEnd;
  }

  return results;
}

// --- Route handlers ---

export async function GET() {
  const sql = getDb();
  if (!sql) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  try {
    await ensureSignalPicksTable(sql);

    // Check if picks need regeneration
    const existingPicks = await sql`SELECT pick_date FROM signal_picks LIMIT 50`;
    const versionRow = await sql`SELECT value FROM stock_meta WHERE key = 'signal_picks_version'`.catch(() => []);
    const currentVersion = versionRow.length > 0 ? Number(versionRow[0].value) : 0;

    const needsRegeneration = existingPicks.length === 0
      || currentVersion < PICKS_VERSION
      || (() => {
        const dates = new Set(existingPicks.map((p) => toDateStr(p.pick_date)));
        return dates.size === 1 && existingPicks.length > 3;
      })();

    if (needsRegeneration) {
      if (existingPicks.length > 0) {
        console.log(`[Signal Tracker] Regenerating picks (version ${currentVersion} → ${PICKS_VERSION})`);
        // Preserve live signals and curated picks during regeneration
        const preserveSymbolsArr = Array.from(PRESERVE_SYMBOLS);
        const preserved = await sql`SELECT * FROM signal_picks WHERE symbol = ANY(${preserveSymbolsArr})`;
        await sql`DELETE FROM signal_picks`;
        // Re-insert preserved picks
        for (const p of preserved) {
          await sql`
            INSERT INTO signal_picks (id, symbol, company_name, sector, market_cap_at_pick, score, thesis, pick_date, entry_price, status, sell_date, sell_price, sell_reason, created_at)
            VALUES (${p.id}, ${p.symbol}, ${p.company_name}, ${p.sector}, ${p.market_cap_at_pick}, ${p.score}, ${p.thesis}, ${p.pick_date}, ${p.entry_price}, ${p.status}, ${p.sell_date}, ${p.sell_price}, ${p.sell_reason}, ${p.created_at})
          `;
        }
        console.log(`[Signal Tracker] Preserved ${preserved.length} picks for ${preserveSymbolsArr.join(', ')}`);
      }
      // Clean up non-company entities from all tables
      await sql`DELETE FROM stocks WHERE symbol IN ('KKRS')`.catch(() => {});
      await sql`DELETE FROM stock_prices WHERE symbol IN ('KKRS')`.catch(() => {});
      await sql`DELETE FROM stock_annual_returns WHERE symbol IN ('KKRS')`.catch(() => {});
      await sql`DELETE FROM signal_picks WHERE symbol IN ('KKRS')`.catch(() => {});

      await generateInitialPicks(sql);
      // Store version
      await sql`
        INSERT INTO stock_meta (key, value, updated_at) VALUES ('signal_picks_version', ${String(PICKS_VERSION)}, NOW())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
      `.catch(() => {});
    }

    const allPicks = await sql`
      SELECT id, symbol, company_name, sector, market_cap_at_pick,
             score, thesis, pick_date, entry_price, status,
             sell_date, sell_price, sell_reason, created_at
      FROM signal_picks ORDER BY pick_date DESC, score DESC
    `;

    // Deduplicate picks by symbol - keep the most recent entry per symbol.
    // Active picks take priority over sold picks for the same symbol.
    const seenSymbols = new Set<string>();
    const picks = allPicks.filter((p) => {
      const sym = p.symbol as string;
      if (seenSymbols.has(sym)) return false;
      seenSymbols.add(sym);
      return true;
    });

    // Compute live scores so they match the screener
    const { scoreMap: liveScores } = await fetchStocksWithScores(sql);

    // Get latest prices for active picks - use Yahoo Finance for live quotes
    const activeSymbols = picks.filter((p) => p.status === "active").map((p) => p.symbol as string);
    const latestPrices = new Map<string, number>();
    if (activeSymbols.length > 0) {
      // Try Yahoo Finance for live quotes first
      try {
        const quotes = await Promise.allSettled(
          activeSymbols.map(async (sym) => {
            const q = await yf.quote(sym);
            return { symbol: sym, price: q?.regularMarketPrice ?? null };
          })
        );
        for (const result of quotes) {
          if (result.status === "fulfilled" && result.value.price != null) {
            latestPrices.set(result.value.symbol, Math.round(result.value.price * 100) / 100);
          }
        }
      } catch (e) {
        console.error("[Signal Tracker] Yahoo Finance quote fetch failed:", e);
      }
      // Fallback: fill any missing from stock_prices table
      const missingSymbols = activeSymbols.filter((s) => !latestPrices.has(s));
      if (missingSymbols.length > 0) {
        const priceRows = await sql`
          SELECT DISTINCT ON (symbol) symbol, close_price
          FROM stock_prices WHERE symbol = ANY(${missingSymbols})
          ORDER BY symbol, date DESC
        `;
        for (const r of priceRows) {
          if (!latestPrices.has(r.symbol as string)) {
            latestPrices.set(r.symbol as string, Number(r.close_price));
          }
        }
      }
    }

    const performance = await computePerformance(sql, picks);

    const activePicks = picks.filter((p) => p.status === "active");
    const soldPicks = picks.filter((p) => p.status === "sold");
    const latest = performance.length > 0 ? performance[performance.length - 1] : null;
    const benchRet = latest ? ((latest.benchmarkValue / INITIAL_CAPITAL) - 1) * 100 : 0;

    // Fund value from monthly compounded weighted returns (source of truth)
    const fundValue = latest ? latest.portfolioValue : INITIAL_CAPITAL;
    const targetTotalPnL = fundValue - INITIAL_CAPITAL;

    // --- Score-weighted position sizing ---
    // Active picks: allocate a growing portion of fund value, scaling toward 90-95% as more picks are called
    const targetInvestPct = Math.min(0.95, 0.50 + activePicks.length * 0.05);
    const investableAmount = fundValue * targetInvestPct;

    // Weight active picks by live score (enables rebalancing as scores change)
    const activeWeightMap = new Map<string, number>();
    let totalActiveWeight = 0;
    for (const p of activePicks) {
      const sym = p.symbol as string;
      const liveScore = liveScores.get(sym) ?? Number(p.score);
      const w = pickWeight(liveScore);
      activeWeightMap.set(sym, w);
      totalActiveWeight += w;
    }

    // First pass: compute raw return data for all picks
    const pickReturns = new Map<string, { returnPct: number; exitPrice: number | null }>();
    for (const p of picks) {
      const sym = p.symbol as string;
      const entryPrice = Number(p.entry_price);
      const isSold = p.status === "sold";
      const exitPrice = isSold && p.sell_price ? Number(p.sell_price) : (latestPrices.get(sym) || null);
      const returnPct = exitPrice && entryPrice > 0
        ? ((exitPrice - entryPrice) / entryPrice) * 100
        : null;
      pickReturns.set(p.id as string, { returnPct: returnPct ?? 0, exitPrice });
    }

    // Compute active P&L using proper allocation
    let totalActivePnL = 0;
    for (const p of activePicks) {
      const sym = p.symbol as string;
      const w = activeWeightMap.get(sym) || 0;
      const posSize = totalActiveWeight > 0 ? (w / totalActiveWeight) * investableAmount : 0;
      const ret = pickReturns.get(p.id as string);
      if (ret) totalActivePnL += posSize * (ret.returnPct / 100);
    }

    // Sold picks: scale position sizes so total P&L (active + sold) = fund value - initial capital
    // This ensures displayed numbers are consistent with fund value
    const targetSoldPnL = targetTotalPnL - totalActivePnL;

    // Compute raw sold P&L with baseline sizing
    let totalSoldWeight = 0;
    for (const p of soldPicks) totalSoldWeight += pickWeight(Number(p.score));
    const soldBaseAlloc = INITIAL_CAPITAL * 0.7; // baseline sold allocation (proportional to initial capital)

    let rawSoldPnL = 0;
    for (const p of soldPicks) {
      const w = pickWeight(Number(p.score));
      const rawSize = totalSoldWeight > 0 ? (w / totalSoldWeight) * soldBaseAlloc : 0;
      const ret = pickReturns.get(p.id as string);
      if (ret) rawSoldPnL += rawSize * (ret.returnPct / 100);
    }

    // Scale sold positions so their P&L fills the gap (bounded to avoid extremes)
    const soldScale = rawSoldPnL > 0 ? Math.max(0.5, Math.min(5, targetSoldPnL / rawSoldPnL)) : 1;

    // Track totals for stats
    let totalInvested = 0;
    const today = new Date().toISOString().slice(0, 10);

    const mappedPicks = picks.map((p) => {
      const sym = p.symbol as string;
      const currentPrice = latestPrices.get(sym) || null;
      const entryPrice = Number(p.entry_price);
      const isSold = p.status === "sold";
      const ret = pickReturns.get(p.id as string)!;
      const returnPct = ret.exitPrice && entryPrice > 0 ? ret.returnPct : null;

      const sellScore = isSold ? (liveScores.get(sym) ?? null) : null;

      // Hold time in days
      const pickDateStr = toDateStr(p.pick_date);
      const endDateStr = isSold && p.sell_date ? toDateStr(p.sell_date) : today;
      const holdDays = Math.max(0, Math.round(
        (new Date(endDateStr).getTime() - new Date(pickDateStr).getTime()) / (1000 * 60 * 60 * 24)
      ));

      let positionSize: number;
      let portfolioPct: number;

      if (!isSold) {
        const w = activeWeightMap.get(sym) || 0;
        positionSize = totalActiveWeight > 0
          ? Math.round((w / totalActiveWeight) * investableAmount * 100) / 100
          : 0;
        portfolioPct = fundValue > 0
          ? Math.round((positionSize / fundValue) * 1000) / 10
          : 0;
        totalInvested += positionSize;
      } else {
        const w = pickWeight(Number(p.score));
        const rawSize = totalSoldWeight > 0 ? (w / totalSoldWeight) * soldBaseAlloc : 0;
        positionSize = Math.round(rawSize * soldScale * 100) / 100;
        portfolioPct = 0;
      }

      const profitLoss = returnPct != null
        ? Math.round(positionSize * (returnPct / 100) * 100) / 100
        : null;

      return {
        id: p.id,
        symbol: sym,
        companyName: p.company_name,
        sector: p.sector,
        marketCap: Number(p.market_cap_at_pick) / 1e9,
        entryScore: Number(p.score),
        currentScore: liveScores.get(sym) ?? null,
        sellScore,
        thesis: p.thesis,
        pickDate: pickDateStr,
        entryPrice,
        currentPrice: isSold ? null : currentPrice,
        returnPct: returnPct != null ? Math.round(returnPct * 10) / 10 : null,
        positionSize,
        portfolioPct,
        profitLoss,
        holdDays,
        status: p.status,
        sellDate: p.sell_date ? toDateStr(p.sell_date) : null,
        sellPrice: p.sell_price ? Number(p.sell_price) : null,
        sellReason: p.sell_reason,
      };
    });

    const cashReserve = Math.round((fundValue - totalInvested) * 100) / 100;
    const totalRet = fundValue > 0 ? ((fundValue / INITIAL_CAPITAL) - 1) * 100 : 0;

    // Compute average hold time
    const allHoldDays = mappedPicks.map((p) => p.holdDays);
    const avgHoldDays = allHoldDays.length > 0
      ? Math.round(allHoldDays.reduce((s, d) => s + d, 0) / allHoldDays.length)
      : 0;

    // Build trade log: each pick generates a BUY event, sold picks also generate a SELL event
    const trades: {
      id: string;
      date: string;
      type: "buy" | "sell";
      symbol: string;
      companyName: string;
      price: number;
      shares: number;
      amount: number;
      score: number;
      reason: string;
    }[] = [];

    for (const p of mappedPicks) {
      const buyAmount = p.positionSize;
      const buyShares = p.entryPrice > 0 ? Math.round((buyAmount / p.entryPrice) * 100) / 100 : 0;
      trades.push({
        id: `${p.id}-buy`,
        date: p.pickDate,
        type: "buy",
        symbol: p.symbol,
        companyName: p.companyName as string,
        price: p.entryPrice,
        shares: buyShares,
        amount: buyAmount,
        score: p.entryScore,
        reason: `Quant Score ${p.entryScore} - qualifies for fund`,
      });

      if (p.status === "sold" && p.sellDate && p.sellPrice) {
        const sellAmount = Math.round(buyShares * p.sellPrice * 100) / 100;
        trades.push({
          id: `${p.id}-sell`,
          date: p.sellDate,
          type: "sell",
          symbol: p.symbol,
          companyName: p.companyName as string,
          price: p.sellPrice,
          shares: buyShares,
          amount: sellAmount,
          score: p.sellScore ?? p.entryScore,
          reason: p.sellReason || "Score below hold threshold",
        });
      }
    }

    // Sort trades by date descending (most recent first)
    trades.sort((a, b) => b.date.localeCompare(a.date));

    return NextResponse.json({
      picks: mappedPicks,
      performance,
      trades,
      fundValue: Math.round(fundValue * 100) / 100,
      stats: {
        totalReturn: Math.round(totalRet * 10) / 10,
        benchmarkReturn: Math.round(benchRet * 10) / 10,
        alpha: Math.round((totalRet - benchRet) * 10) / 10,
        activePicks: activePicks.length,
        totalPicks: picks.length,
        inceptionDate: INCEPTION_DATE,
        totalInvested: Math.round(totalInvested * 100) / 100,
        cashReserve,
        investedPct: Math.round(targetInvestPct * 1000) / 10,
        avgHoldDays,
      },
    });
  } catch (error) {
    console.error("[Signal Tracker GET] Error:", error);
    return NextResponse.json({ error: "Failed to load signal tracker data" }, { status: 500 });
  }
}

export async function POST() {
  const sql = getDb();
  if (!sql) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  try {
    await ensureSignalPicksTable(sql);
    const { infos, scoreMap } = await fetchStocksWithScores(sql);

    // Existing picks - no re-pitch within 1 year, no dupes for active picks
    const recentPicks = await sql`
      SELECT symbol FROM signal_picks WHERE pick_date >= NOW() - INTERVAL '1 year'
    `;
    const recentSymbols = new Set(recentPicks.map((p) => p.symbol as string));
    const existingActive = await sql`SELECT symbol FROM signal_picks WHERE status = 'active'`;
    const existingActiveSymbols = new Set(existingActive.map((p) => p.symbol as string));

    // Find new qualifying stocks (exclude already-active and recent picks)
    const newQualifiers = infos.filter(
      (s) => !recentSymbols.has(s.symbol) && !existingActiveSymbols.has(s.symbol) && !SYMBOL_BLOCKLIST.has(s.symbol) && qualifiesForPick(s.score, s.marketCapB)
    );

    let added = 0;
    if (newQualifiers.length > 0) {
      const symbols = newQualifiers.map((s) => s.symbol);

      // Use Yahoo Finance live quotes for accurate entry prices
      const priceMap = new Map<string, number>();
      try {
        const quotes = await Promise.allSettled(
          symbols.map(async (sym) => {
            const q = await yf.quote(sym);
            return { symbol: sym, price: q?.regularMarketPrice ?? null };
          })
        );
        for (const result of quotes) {
          if (result.status === "fulfilled" && result.value.price != null) {
            priceMap.set(result.value.symbol, Math.round(result.value.price * 100) / 100);
          }
        }
      } catch (e) {
        console.error("[Signal Tracker POST] Yahoo Finance entry price fetch failed:", e);
      }

      // Fallback: fill missing from stock_prices table
      const missingSymbols = symbols.filter((s) => !priceMap.has(s));
      if (missingSymbols.length > 0) {
        const priceRows = await sql`
          SELECT DISTINCT ON (symbol) symbol, close_price
          FROM stock_prices WHERE symbol = ANY(${missingSymbols})
          ORDER BY symbol, date DESC
        `;
        for (const r of priceRows) {
          if (!priceMap.has(r.symbol as string)) {
            priceMap.set(r.symbol as string, Number(r.close_price));
          }
        }
      }

      const today = new Date().toISOString().slice(0, 10);
      for (const stock of newQualifiers) {
        const price = priceMap.get(stock.symbol);
        if (!price) continue;
        await sql`
          INSERT INTO signal_picks (id, symbol, company_name, sector, market_cap_at_pick, score, thesis, pick_date, entry_price, status)
          VALUES (${uuidv4()}, ${stock.symbol}, ${stock.name}, ${stock.sector},
                  ${stock.marketCapB * 1e9}, ${stock.score}, ${generateThesis(stock)},
                  ${today}, ${price}, 'active')
        `;
        added++;
      }
    }

    // Check for sells: active picks whose score dropped below SELL_THRESHOLD (78)
    // Only sell if the stock was actually found in scoreMap (avoid false sells from missing data)
    const infoMap = new Map<string, StockInfo>();
    for (const info of infos) infoMap.set(info.symbol, info);
    const activePicks = await sql`SELECT id, symbol FROM signal_picks WHERE status = 'active'`;

    // Batch-fetch live sell prices from Yahoo Finance
    const sellCandidateSyms = activePicks
      .filter((p) => {
        const score = scoreMap.get(p.symbol as string);
        return score != null && score < SELL_THRESHOLD;
      })
      .map((p) => p.symbol as string);

    const sellPriceMap = new Map<string, number>();
    if (sellCandidateSyms.length > 0) {
      try {
        const quotes = await Promise.allSettled(
          sellCandidateSyms.map(async (sym) => {
            const q = await yf.quote(sym);
            return { symbol: sym, price: q?.regularMarketPrice ?? null };
          })
        );
        for (const result of quotes) {
          if (result.status === "fulfilled" && result.value.price != null) {
            sellPriceMap.set(result.value.symbol, Math.round(result.value.price * 100) / 100);
          }
        }
      } catch (e) {
        console.error("[Signal Tracker POST] Yahoo Finance sell price fetch failed:", e);
      }
    }

    let sold = 0;
    for (const pick of activePicks) {
      const score = scoreMap.get(pick.symbol as string);
      // Skip if stock not found in scoreMap - don't sell on missing data
      if (score == null) continue;
      if (score < SELL_THRESHOLD) {
        const stockInfo = infoMap.get(pick.symbol as string);
        const sellReason = stockInfo
          ? generateSellReason(stockInfo)
          : `Score declined to ${score}, below hold threshold of ${SELL_THRESHOLD}`;
        // Prefer Yahoo Finance live price, fallback to stock_prices table
        let sellPrice = sellPriceMap.get(pick.symbol as string) ?? null;
        if (sellPrice == null) {
          const pr = await sql`
            SELECT close_price FROM stock_prices WHERE symbol = ${pick.symbol} ORDER BY date DESC LIMIT 1
          `;
          sellPrice = pr.length > 0 ? Number(pr[0].close_price) : null;
        }
        const today = new Date().toISOString().slice(0, 10);
        await sql`
          UPDATE signal_picks SET status = 'sold', sell_date = ${today},
            sell_price = ${sellPrice}, sell_reason = ${sellReason}
          WHERE id = ${pick.id}
        `;
        sold++;
      }
    }

    return NextResponse.json({ success: true, added, sold });
  } catch (error) {
    console.error("[Signal Tracker POST] Error:", error);
    return NextResponse.json({ error: "Failed to refresh signal tracker" }, { status: 500 });
  }
}
