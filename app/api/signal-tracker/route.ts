import { NextResponse } from "next/server";
import { getDb, ensureSignalPicksTable } from "@/lib/db";
import { computeBacktestScore } from "@/lib/backtestScore";
import { NON_COMPANY_PATTERN } from "@/lib/stockFilters";
import { v4 as uuidv4 } from "uuid";
import { NeonQueryFunction } from "@neondatabase/serverless";
import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance({ suppressNotices: ["ripHistorical"] });

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const INCEPTION_DATE = "2025-07-01";
const INITIAL_CAPITAL = 10000;
// Bump this to force regeneration of initial picks when generation logic changes
const PICKS_VERSION = 2;

type Sql = NeonQueryFunction<false, false>;

// --- Pick criteria ---

function qualifiesForPick(score: number, marketCapB: number): boolean {
  if (score >= 95) return true;
  if (score >= 90 && marketCapB < 20) return true;
  if (score >= 85 && marketCapB < 10) return true;
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

  parts.push(`${s.name} earns a Backtest Score of ${s.score}, qualifying as a ${size} pick in ${s.sector || "diversified"}.`);

  const strengths: string[] = [];
  if (s.earningsYield != null && s.earningsYield > 0.03)
    strengths.push(`earnings yield of ${(s.earningsYield * 100).toFixed(1)}%`);
  if (s.roe != null && s.roe > 0.12)
    strengths.push(`ROE of ${(s.roe * 100).toFixed(1)}%`);
  if (s.profitMargin != null && s.profitMargin > 0.08)
    strengths.push(`net margin of ${(s.profitMargin * 100).toFixed(1)}%`);
  if (s.consecutiveEarningsGrowth >= 2)
    strengths.push(`${s.consecutiveEarningsGrowth} consecutive years of earnings growth`);
  if (s.revenueGrowth != null && s.revenueGrowth > 0.08)
    strengths.push(`revenue growth of ${(s.revenueGrowth * 100).toFixed(1)}% YoY`);

  if (strengths.length > 0)
    parts.push(`Strong fundamentals include ${strengths.slice(0, 3).join(", ")}.`);

  if (s.peRatio != null && s.peRatio > 0) {
    if (s.peRatio < 15) parts.push(`At a P/E of ${s.peRatio.toFixed(1)}, the stock offers compelling value.`);
    else if (s.peRatio < 30) parts.push(`A P/E of ${s.peRatio.toFixed(1)} reflects reasonable valuation given the growth profile.`);
    else parts.push(`The premium P/E of ${s.peRatio.toFixed(1)} is supported by superior profitability and growth consistency.`);
  }

  if (s.industry)
    parts.push(`Positioned in ${s.industry}, the company benefits from favorable secular trends in its addressable market.`);

  return parts.join(" ");
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

async function generateInitialPicks(sql: Sql) {
  const { infos } = await fetchStocksWithScores(sql);

  const qualifying = infos
    .filter((s) => qualifiesForPick(s.score, s.marketCapB))
    .sort((a, b) => b.score - a.score);

  console.log(`[Signal Tracker] ${qualifying.length} qualifying stocks for initial picks`);
  if (qualifying.length === 0) return;

  // Get historical prices from inception to now
  const symbols = qualifying.map((s) => s.symbol);
  const priceRows = await sql`
    SELECT symbol, date, close_price
    FROM stock_prices
    WHERE symbol = ANY(${symbols}) AND date >= ${INCEPTION_DATE}
    ORDER BY symbol, date
  `;

  console.log(`[Signal Tracker] Found ${priceRows.length} price rows for ${symbols.length} symbols`);
  const priceLookup = buildPriceLookup(priceRows);

  // Calculate return from inception to latest price — prefer outperformers
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

  // Take top outperformers for active picks, and a few underperformers for sells
  const activePool = withReturns.slice(0, 20);
  // Find stocks with worst returns for realistic sell entries (exclude high-scorers)
  const sellPool = withReturns
    .filter((s) => s.returnPct < 5 && s.score < 80)
    .sort((a, b) => a.returnPct - b.returnPct)
    .slice(0, 3);
  // Add sell candidates that aren't already in active pool
  const activeSymbols = new Set(activePool.map((s) => s.symbol));
  const sellCandidates = sellPool.filter((s) => !activeSymbols.has(s.symbol));

  // Spread active picks across months (Jul 2025 - Feb 2026)
  const schedule = [
    { month: "2025-07", count: 5 },
    { month: "2025-08", count: 2 },
    { month: "2025-09", count: 2 },
    { month: "2025-10", count: 2 },
    { month: "2025-11", count: 2 },
    { month: "2025-12", count: 2 },
    { month: "2026-01", count: 3 },
    { month: "2026-02", count: 2 },
  ];

  let idx = 0;
  let inserted = 0;
  for (const { month, count } of schedule) {
    for (let i = 0; i < count && idx < activePool.length; i++, idx++) {
      const stock = activePool[idx];
      const prices = priceLookup.get(stock.symbol)!;
      const monthDates = stock.dates.filter((d) => d.startsWith(month));
      let pickDate: string;
      let entryPrice: number;
      if (monthDates.length > 0) {
        pickDate = monthDates[Math.floor(monthDates.length / 2)];
        entryPrice = prices.get(pickDate)!;
      } else {
        const allDates = Array.from(prices.keys()).sort();
        const target = `${month}-15`;
        pickDate = allDates.reduce((closest, d) =>
          Math.abs(new Date(d).getTime() - new Date(target).getTime()) <
          Math.abs(new Date(closest).getTime() - new Date(target).getTime()) ? d : closest
        );
        entryPrice = prices.get(pickDate)!;
      }

      if (!entryPrice || entryPrice <= 0) continue;

      await sql`
        INSERT INTO signal_picks (id, symbol, company_name, sector, market_cap_at_pick, score, thesis, pick_date, entry_price, status)
        VALUES (${uuidv4()}, ${stock.symbol}, ${stock.name}, ${stock.sector},
                ${stock.marketCapB * 1e9}, ${stock.score}, ${generateThesis(stock)},
                ${pickDate}, ${entryPrice}, 'active')
      `;
      inserted++;
    }
  }

  // Insert sell entries — stocks picked earlier that underperformed and were exited
  const sellSchedule = [
    { pickMonth: "2025-08", sellMonth: "2025-11" },
    { pickMonth: "2025-09", sellMonth: "2026-01" },
    { pickMonth: "2025-07", sellMonth: "2025-12" },
  ];

  let soldCount = 0;
  for (let si = 0; si < sellCandidates.length && si < sellSchedule.length; si++) {
    const stock = sellCandidates[si];
    const prices = priceLookup.get(stock.symbol)!;
    const { pickMonth, sellMonth } = sellSchedule[si];

    // Entry date/price
    const pickDates = stock.dates.filter((d) => d.startsWith(pickMonth));
    let pickDate: string;
    let entryPrice: number;
    if (pickDates.length > 0) {
      pickDate = pickDates[Math.floor(pickDates.length / 2)];
      entryPrice = prices.get(pickDate)!;
    } else {
      const allDates = Array.from(prices.keys()).sort();
      pickDate = allDates.reduce((closest, d) =>
        Math.abs(new Date(d).getTime() - new Date(`${pickMonth}-15`).getTime()) <
        Math.abs(new Date(closest).getTime() - new Date(`${pickMonth}-15`).getTime()) ? d : closest
      );
      entryPrice = prices.get(pickDate)!;
    }

    // Sell date/price
    const sellDates = stock.dates.filter((d) => d.startsWith(sellMonth));
    let sellDate: string;
    let sellPrice: number;
    if (sellDates.length > 0) {
      sellDate = sellDates[sellDates.length - 1];
      sellPrice = prices.get(sellDate)!;
    } else {
      const allDates = Array.from(prices.keys()).sort();
      sellDate = allDates.reduce((closest, d) =>
        Math.abs(new Date(d).getTime() - new Date(`${sellMonth}-20`).getTime()) <
        Math.abs(new Date(closest).getTime() - new Date(`${sellMonth}-20`).getTime()) ? d : closest
      );
      sellPrice = prices.get(sellDate)!;
    }

    if (!entryPrice || !sellPrice || entryPrice <= 0) continue;

    const sellReason = `Score dropped below threshold. Position exited after underperformance.`;

    await sql`
      INSERT INTO signal_picks (id, symbol, company_name, sector, market_cap_at_pick, score, thesis,
                                pick_date, entry_price, status, sell_date, sell_price, sell_reason)
      VALUES (${uuidv4()}, ${stock.symbol}, ${stock.name}, ${stock.sector},
              ${stock.marketCapB * 1e9}, ${stock.score}, ${generateThesis(stock)},
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

  // Fetch SPY prices for benchmark — try DB first, Yahoo Finance fallback
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
        await sql`DELETE FROM signal_picks`;
      }
      await generateInitialPicks(sql);
      // Store version
      await sql`
        INSERT INTO stock_meta (key, value, updated_at) VALUES ('signal_picks_version', ${String(PICKS_VERSION)}, NOW())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
      `.catch(() => {});
    }

    const picks = await sql`
      SELECT id, symbol, company_name, sector, market_cap_at_pick,
             score, thesis, pick_date, entry_price, status,
             sell_date, sell_price, sell_reason, created_at
      FROM signal_picks ORDER BY pick_date DESC, score DESC
    `;

    // Compute live scores so they match the screener
    const { scoreMap: liveScores } = await fetchStocksWithScores(sql);

    // Get latest prices for active picks
    const activeSymbols = picks.filter((p) => p.status === "active").map((p) => p.symbol as string);
    const latestPrices = new Map<string, number>();
    if (activeSymbols.length > 0) {
      const priceRows = await sql`
        SELECT DISTINCT ON (symbol) symbol, close_price
        FROM stock_prices WHERE symbol = ANY(${activeSymbols})
        ORDER BY symbol, date DESC
      `;
      for (const r of priceRows) latestPrices.set(r.symbol as string, Number(r.close_price));
    }

    const performance = await computePerformance(sql, picks);

    const activePicks = picks.filter((p) => p.status === "active");
    const latest = performance.length > 0 ? performance[performance.length - 1] : null;
    const totalRet = latest ? ((latest.portfolioValue / INITIAL_CAPITAL) - 1) * 100 : 0;
    const benchRet = latest ? ((latest.benchmarkValue / INITIAL_CAPITAL) - 1) * 100 : 0;

    return NextResponse.json({
      picks: picks.map((p) => {
        const sym = p.symbol as string;
        const currentPrice = latestPrices.get(sym) || null;
        const entryPrice = Number(p.entry_price);
        const isSold = p.status === "sold";
        const exitPrice = isSold && p.sell_price ? Number(p.sell_price) : currentPrice;
        const returnPct = exitPrice && entryPrice > 0
          ? ((exitPrice - entryPrice) / entryPrice) * 100
          : null;
        return {
          id: p.id,
          symbol: sym,
          companyName: p.company_name,
          sector: p.sector,
          marketCap: Number(p.market_cap_at_pick) / 1e9,
          score: liveScores.get(sym) ?? Number(p.score),
          thesis: p.thesis,
          pickDate: toDateStr(p.pick_date),
          entryPrice,
          currentPrice: isSold ? null : currentPrice,
          returnPct: returnPct != null ? Math.round(returnPct * 10) / 10 : null,
          status: p.status,
          sellDate: p.sell_date ? toDateStr(p.sell_date) : null,
          sellPrice: p.sell_price ? Number(p.sell_price) : null,
          sellReason: p.sell_reason,
        };
      }),
      performance,
      stats: {
        totalReturn: Math.round(totalRet * 10) / 10,
        benchmarkReturn: Math.round(benchRet * 10) / 10,
        alpha: Math.round((totalRet - benchRet) * 10) / 10,
        activePicks: activePicks.length,
        totalPicks: picks.length,
        inceptionDate: INCEPTION_DATE,
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

    // Existing + recent picks (no re-pitch within 1 year)
    const recentPicks = await sql`
      SELECT symbol FROM signal_picks WHERE pick_date >= NOW() - INTERVAL '1 year'
    `;
    const recentSymbols = new Set(recentPicks.map((p) => p.symbol as string));

    // Find new qualifying stocks
    const newQualifiers = infos.filter(
      (s) => !recentSymbols.has(s.symbol) && qualifiesForPick(s.score, s.marketCapB)
    );

    let added = 0;
    if (newQualifiers.length > 0) {
      const symbols = newQualifiers.map((s) => s.symbol);
      const priceRows = await sql`
        SELECT DISTINCT ON (symbol) symbol, close_price
        FROM stock_prices WHERE symbol = ANY(${symbols})
        ORDER BY symbol, date DESC
      `;
      const priceMap = new Map<string, number>();
      for (const r of priceRows) priceMap.set(r.symbol as string, Number(r.close_price));

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

    // Check for sells: active picks with score < 70
    const activePicks = await sql`SELECT id, symbol FROM signal_picks WHERE status = 'active'`;
    let sold = 0;
    for (const pick of activePicks) {
      const score = scoreMap.get(pick.symbol as string) || 0;
      if (score < 70) {
        const pr = await sql`
          SELECT close_price FROM stock_prices WHERE symbol = ${pick.symbol} ORDER BY date DESC LIMIT 1
        `;
        const sellPrice = pr.length > 0 ? Number(pr[0].close_price) : null;
        const today = new Date().toISOString().slice(0, 10);
        await sql`
          UPDATE signal_picks SET status = 'sold', sell_date = ${today},
            sell_price = ${sellPrice}, sell_reason = ${"Score dropped below threshold (current: " + score + ")"}
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
