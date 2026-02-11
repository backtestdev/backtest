/**
 * Financial Modeling Prep (FMP) Stock Universe Service
 *
 * Uses /stable API endpoints:
 * - /stable/actively-trading-list → stock universe
 * - /stable/quote → price/market data
 * - /stable/profile → company info (sector, beta)
 * - /stable/ratios → financial ratios (PE, PB, margins, dividends, etc.)
 * - /stable/income-statement → quarterly data for growth derivation
 */

import { StockData } from './stockData';
import * as fs from 'fs/promises';
import * as path from 'path';

// Support both env var names (FINANCIAL_MODELING_PREP_API_KEY is the canonical one on Vercel)
const FMP_API_KEY = process.env.FINANCIAL_MODELING_PREP_API_KEY || process.env.FMP_API_KEY || '';
const FMP_BASE_URL = 'https://financialmodelingprep.com/stable';
const CACHE_FILE = path.join(process.cwd(), 'data', 'stock-universe-cache.json');
const DISK_CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
const MEMORY_CACHE_DURATION_MS = 10 * 60 * 1000; // 10 minutes

if (!FMP_API_KEY) {
  console.warn('[FMP] WARNING: FINANCIAL_MODELING_PREP_API_KEY is not set.');
} else {
  console.log('[FMP] API key configured.');
}

let memoryCache: { stocks: StockData[]; timestamp: number } | null = null;
let lastFMPError: string | null = null;

// --- Interfaces matching actual /stable API response shapes ---

interface FMPActivelyTradingStock {
  symbol: string;
  name: string;
  exchange: string;
  exchangeShortName?: string;
  price?: number;
  type?: string;
}

interface FMPQuote {
  symbol: string;
  name: string;
  price: number;
  changesPercentage: number;
  change: number;
  dayLow: number;
  dayHigh: number;
  yearHigh: number;
  yearLow: number;
  marketCap: number;
  priceAvg50: number;
  priceAvg200: number;
  volume: number;
  avgVolume: number;
  exchange: string;
  open: number;
  previousClose: number;
  eps: number;
  pe: number;
  sharesOutstanding: number;
  timestamp: number;
}

interface FMPProfile {
  symbol: string;
  companyName: string;
  price: number;
  marketCap: number;
  beta: number;
  lastDividend: number;
  range: string;
  volume: number;
  averageVolume: number;
  exchange: string;
  exchangeFullName: string;
  industry: string;
  sector: string;
  country: string;
  ipoDate: string;
  isEtf: boolean;
  isActivelyTrading: boolean;
  isAdr: boolean;
  isFund: boolean;
}

interface FMPRatios {
  symbol: string;
  date: string;
  fiscalYear: string;
  period: string;
  grossProfitMargin: number;
  netProfitMargin: number;
  operatingProfitMargin: number;
  priceToEarningsRatio: number;
  priceToBookRatio: number;
  priceToSalesRatio: number;
  priceToFreeCashFlowRatio: number;
  dividendYield: number;
  dividendPayoutRatio: number;
  dividendPerShare: number;
  debtToEquityRatio: number;
  debtToAssetsRatio: number;
  currentRatio: number;
  interestCoverageRatio: number;
  revenuePerShare: number;
  netIncomePerShare: number;
  freeCashFlowPerShare: number;
  operatingCashFlowPerShare: number;
  bookValuePerShare: number;
  shareholdersEquityPerShare: number;
  cashPerShare: number;
  effectiveTaxRate: number;
  enterpriseValueMultiple: number;
}

interface FMPIncomeStatement {
  date: string;
  symbol: string;
  reportedCurrency: string;
  fiscalYear: string;
  period: string;
  revenue: number;
  costOfRevenue: number;
  grossProfit: number;
  operatingIncome: number;
  netIncome: number;
  ebitda: number;
  ebit: number;
  eps: number;
  epsDiluted: number;
  weightedAverageShsOut: number;
  weightedAverageShsOutDil: number;
}

interface CachedUniverse {
  lastUpdated: number;
  stocks: StockData[];
}

// --- Core fetch helper ---

async function fetchFMP<T>(endpoint: string): Promise<T | null> {
  if (!FMP_API_KEY) {
    lastFMPError = "FMP API key is not configured. Set FINANCIAL_MODELING_PREP_API_KEY environment variable.";
    return null;
  }

  try {
    const url = `${FMP_BASE_URL}${endpoint}${endpoint.includes('?') ? '&' : '?'}apikey=${FMP_API_KEY}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      lastFMPError = `FMP API returned ${response.status} for ${endpoint}`;
      if (response.status === 403) {
        lastFMPError += ' — check that your API key is valid and has access to /stable endpoints';
      } else if (response.status === 429) {
        lastFMPError += ' — rate limit exceeded, try again later';
      }
      console.error(`[FMP] ${response.status} ${response.statusText} for ${endpoint}`, body ? body.slice(0, 200) : '');
      return null;
    }

    const data = await response.json();

    if (data && typeof data === 'object' && 'Error Message' in data) {
      lastFMPError = `FMP: ${data['Error Message']}`;
      console.error(`[FMP] ${data['Error Message']}`);
      return null;
    }

    if (data && typeof data === 'object' && !Array.isArray(data) && 'message' in data && Object.keys(data).length <= 2) {
      lastFMPError = `FMP: ${data['message']}`;
      console.error(`[FMP] ${data['message']}`);
      return null;
    }

    lastFMPError = null;
    return data as T;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    lastFMPError = `Network error: ${msg}`;
    console.error(`[FMP] Fetch error for ${endpoint}:`, msg);
    return null;
  }
}

// --- Sector mapping ---

function mapSector(sector: string): number {
  const sectorMap: Record<string, number> = {
    'Technology': 1,
    'Healthcare': 2,
    'Financial Services': 3,
    'Finance': 3,
    'Energy': 4,
    'Consumer Cyclical': 5,
    'Consumer Defensive': 5,
    'Industrials': 6,
    'Basic Materials': 7,
    'Real Estate': 8,
    'Utilities': 9,
    'Communication Services': 10,
  };
  return sectorMap[sector] || 0;
}

// --- Metric derivation helpers ---

function deriveDividendGrowthYears(ratios: FMPRatios[]): number {
  if (ratios.length < 2) return 0;
  const sorted = [...ratios].sort((a, b) => parseInt(b.fiscalYear) - parseInt(a.fiscalYear));
  let years = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i].dividendPerShare ?? 0;
    const previous = sorted[i + 1].dividendPerShare ?? 0;
    if (current > previous && previous > 0) {
      years++;
    } else {
      break;
    }
  }
  return years;
}

function deriveRevenueGrowth(ratios: FMPRatios[]): number {
  if (ratios.length < 2) return 0;
  const sorted = [...ratios].sort((a, b) => parseInt(b.fiscalYear) - parseInt(a.fiscalYear));
  const current = sorted[0].revenuePerShare;
  const previous = sorted[1].revenuePerShare;
  if (!previous || previous === 0) return 0;
  return (current - previous) / Math.abs(previous);
}

function deriveEarningsGrowth(ratios: FMPRatios[]): number {
  if (ratios.length < 2) return 0;
  const sorted = [...ratios].sort((a, b) => parseInt(b.fiscalYear) - parseInt(a.fiscalYear));
  const current = sorted[0].netIncomePerShare;
  const previous = sorted[1].netIncomePerShare;
  if (!previous || previous === 0) return 0;
  return (current - previous) / Math.abs(previous);
}

function deriveROE(ratios: FMPRatios): number {
  if (!ratios.shareholdersEquityPerShare || ratios.shareholdersEquityPerShare === 0) return 0;
  return ratios.netIncomePerShare / ratios.shareholdersEquityPerShare;
}

/**
 * Derive approximate historical annual returns from ratios data.
 * Uses (P/E * EPS) as a proxy for year-end stock price.
 */
function deriveHistoricalReturns(ratios: FMPRatios[]): Record<string, number> {
  const returns: Record<string, number> = {};
  if (ratios.length < 2) return returns;

  const sorted = [...ratios].sort((a, b) => parseInt(a.fiscalYear) - parseInt(b.fiscalYear));

  const prices: { year: string; price: number }[] = [];
  for (const r of sorted) {
    let impliedPrice = 0;
    if (r.priceToEarningsRatio > 0 && r.netIncomePerShare > 0) {
      impliedPrice = r.priceToEarningsRatio * r.netIncomePerShare;
    } else if (r.priceToBookRatio > 0 && r.bookValuePerShare > 0) {
      impliedPrice = r.priceToBookRatio * r.bookValuePerShare;
    } else if (r.priceToSalesRatio > 0 && r.revenuePerShare > 0) {
      impliedPrice = r.priceToSalesRatio * r.revenuePerShare;
    }
    if (impliedPrice > 0) {
      prices.push({ year: r.fiscalYear, price: impliedPrice });
    }
  }

  for (let i = 1; i < prices.length; i++) {
    const prev = prices[i - 1].price;
    const curr = prices[i].price;
    if (prev > 0) {
      returns[prices[i].year] = (curr - prev) / prev;
    }
  }

  return returns;
}

function deriveConsecutiveQuarterlyGrowth(
  quarterlyStatements: FMPIncomeStatement[],
  field: 'revenue' | 'netIncome'
): number {
  if (quarterlyStatements.length < 5) return 0;
  const sorted = [...quarterlyStatements].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
  let consecutive = 0;
  for (let i = 0; i < sorted.length - 4; i++) {
    const current = sorted[i][field];
    const yearAgo = sorted[i + 4]?.[field];
    if (yearAgo && yearAgo > 0 && current > yearAgo) {
      consecutive++;
    } else {
      break;
    }
  }
  return consecutive;
}

function deriveSharesChangePct(statements: FMPIncomeStatement[]): number {
  const annual = [...statements]
    .filter(s => s.period === 'FY')
    .sort((a, b) => parseInt(b.fiscalYear) - parseInt(a.fiscalYear));
  if (annual.length < 2) return 0;
  const current = annual[0].weightedAverageShsOut;
  const previous = annual[1].weightedAverageShsOut;
  if (!previous || previous === 0) return 0;
  return (current - previous) / previous;
}

// --- Main data fetching ---

async function fetchAllStocks(): Promise<StockData[]> {
  console.log('[FMP] Fetching stock universe...');

  // Step 1: Get actively trading stocks
  const activeStocks = await fetchFMP<FMPActivelyTradingStock[]>('/actively-trading-list');
  if (!activeStocks || activeStocks.length === 0) {
    console.error('[FMP] Actively trading list returned no results');
    return [];
  }

  // Step 2: Filter to NYSE/NASDAQ common stocks
  const commonStocks = activeStocks.filter(s =>
    s.symbol &&
    !s.symbol.includes('.') &&
    s.symbol.length <= 5 &&
    (s.exchangeShortName === 'NYSE' || s.exchangeShortName === 'NASDAQ' ||
     s.exchange?.includes('NYSE') || s.exchange?.includes('NASDAQ'))
  );
  console.log(`[FMP] Filtered to ${commonStocks.length} NYSE/NASDAQ stocks from ${activeStocks.length} total`);

  // Step 3: Batch fetch quotes for price/marketCap
  const BATCH_SIZE = 100;
  const quoteMap = new Map<string, FMPQuote>();

  for (let i = 0; i < Math.min(commonStocks.length, 3000); i += BATCH_SIZE) {
    const batch = commonStocks.slice(i, i + BATCH_SIZE);
    const symbols = batch.map(s => s.symbol).join(',');
    const batchQuotes = await fetchFMP<FMPQuote[]>(`/quote?symbol=${symbols}`);
    if (batchQuotes) {
      for (const q of batchQuotes) quoteMap.set(q.symbol, q);
    }
    if (i + BATCH_SIZE < commonStocks.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  console.log(`[FMP] Fetched quotes for ${quoteMap.size} stocks`);

  // Step 4: Filter by marketCap > $300M and build initial entries
  const allStocks: StockData[] = [];
  for (const stock of commonStocks) {
    const quote = quoteMap.get(stock.symbol);
    if (!quote || !quote.marketCap || quote.marketCap <= 300_000_000) continue;

    allStocks.push({
      ticker: stock.symbol,
      name: quote.name || stock.name || '',
      sector: 0,
      pe_ratio: quote.pe || 0,
      forward_pe: 0,
      price_to_book: 0,
      dividend_yield: 0,
      dividend_growth_years: 0,
      payout_ratio: 0,
      revenue_growth: 0,
      revenue_growth_quarters: 0,
      earnings_growth: 0,
      profit_margin: 0,
      roe: 0,
      debt_to_equity: 0,
      current_ratio: 0,
      free_cash_flow_per_share: 0,
      market_cap: quote.marketCap / 1_000_000_000,
      beta: 0,
      week52_high_pct: quote.yearHigh > 0 ? quote.price / quote.yearHigh : 0,
      shares_outstanding: quote.sharesOutstanding || 0,
      shares_change_pct: 0,
      ipo_date: '',
      eps: quote.eps || 0,
      historical_returns: {},
    });
  }
  console.log(`[FMP] ${allStocks.length} stocks with market cap > $300M`);

  // Step 5: Batch fetch profiles for sector, beta, dividend
  const profileMap = new Map<string, FMPProfile>();
  for (let i = 0; i < allStocks.length; i += BATCH_SIZE) {
    const batch = allStocks.slice(i, i + BATCH_SIZE);
    const symbols = batch.map(s => s.ticker).join(',');
    const batchProfiles = await fetchFMP<FMPProfile[]>(`/profile?symbol=${symbols}`);
    if (batchProfiles) {
      const profiles = Array.isArray(batchProfiles) ? batchProfiles : [batchProfiles];
      for (const p of profiles) {
        if (p?.symbol) profileMap.set(p.symbol, p);
      }
    }
    if (i + BATCH_SIZE < allStocks.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  for (let i = 0; i < allStocks.length; i++) {
    const profile = profileMap.get(allStocks[i].ticker);
    if (profile) {
      allStocks[i].sector = mapSector(profile.sector || '');
      allStocks[i].beta = profile.beta || 0;
      allStocks[i].ipo_date = profile.ipoDate || '';
      if (profile.lastDividend > 0) {
        const quote = quoteMap.get(allStocks[i].ticker);
        if (quote && quote.price > 0) {
          allStocks[i].dividend_yield = profile.lastDividend / quote.price;
        }
      }
    }
  }

  // Step 6: Enrich top stocks with ratios + income-statement
  const sortedByMarketCap = [...allStocks].sort((a, b) => b.market_cap - a.market_cap);
  const topStocks = sortedByMarketCap.slice(0, 300);
  const topSymbols = new Set(topStocks.map(s => s.ticker));

  console.log(`[FMP] Enriching top ${topStocks.length} stocks with ratios + income data...`);

  const ENRICH_BATCH = 5;
  for (let i = 0; i < topStocks.length; i += ENRICH_BATCH) {
    const batch = topStocks.slice(i, i + ENRICH_BATCH);

    const enrichPromises = batch.map(async (stock) => {
      try {
        const [ratiosData, quarterlyIncome] = await Promise.all([
          fetchFMP<FMPRatios[]>(`/ratios?symbol=${stock.ticker}&period=annual&limit=20`),
          fetchFMP<FMPIncomeStatement[]>(`/income-statement?symbol=${stock.ticker}&period=quarter&limit=12`),
        ]);

        const idx = allStocks.findIndex(s => s.ticker === stock.ticker);
        if (idx === -1) return;

        if (ratiosData && ratiosData.length > 0) {
          const latest = ratiosData[0];

          // Valuation
          allStocks[idx].pe_ratio = latest.priceToEarningsRatio || allStocks[idx].pe_ratio;
          allStocks[idx].price_to_book = latest.priceToBookRatio || 0;
          allStocks[idx].price_to_sales = latest.priceToSalesRatio || 0;
          allStocks[idx].price_to_fcf = latest.priceToFreeCashFlowRatio || 0;

          // Profitability
          allStocks[idx].profit_margin = latest.netProfitMargin || 0;
          allStocks[idx].gross_margin = latest.grossProfitMargin || 0;
          allStocks[idx].operating_margin = latest.operatingProfitMargin || 0;
          allStocks[idx].roe = deriveROE(latest);

          // Dividend
          allStocks[idx].dividend_yield = latest.dividendYield || allStocks[idx].dividend_yield;
          allStocks[idx].payout_ratio = latest.dividendPayoutRatio || 0;
          allStocks[idx].dividend_growth_years = deriveDividendGrowthYears(ratiosData);

          // Leverage & liquidity
          allStocks[idx].debt_to_equity = latest.debtToEquityRatio || 0;
          allStocks[idx].debt_to_assets = latest.debtToAssetsRatio || 0;
          allStocks[idx].current_ratio = latest.currentRatio || 0;
          allStocks[idx].interest_coverage = latest.interestCoverageRatio || 0;

          // Per-share
          allStocks[idx].free_cash_flow_per_share = latest.freeCashFlowPerShare || 0;
          allStocks[idx].eps = latest.netIncomePerShare || allStocks[idx].eps;

          // Growth (YoY from ratios)
          allStocks[idx].revenue_growth = deriveRevenueGrowth(ratiosData);
          allStocks[idx].earnings_growth = deriveEarningsGrowth(ratiosData);

          // Historical returns for backtesting chart
          allStocks[idx].historical_returns = deriveHistoricalReturns(ratiosData);
        }

        if (quarterlyIncome && quarterlyIncome.length >= 5) {
          const idx2 = allStocks.findIndex(s => s.ticker === stock.ticker);
          if (idx2 !== -1) {
            allStocks[idx2].revenue_growth_quarters = deriveConsecutiveQuarterlyGrowth(quarterlyIncome, 'revenue');
            allStocks[idx2].net_income_growth_quarters = deriveConsecutiveQuarterlyGrowth(quarterlyIncome, 'netIncome');
            allStocks[idx2].shares_change_pct = deriveSharesChangePct(quarterlyIncome);
          }
        }
      } catch (error) {
        console.error(`[FMP] Error enriching ${stock.ticker}:`, error instanceof Error ? error.message : error);
      }
    });

    await Promise.all(enrichPromises);

    if (i + ENRICH_BATCH < topStocks.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  console.log(`[FMP] Completed: ${allStocks.length} stocks (${topSymbols.size} enriched with detailed metrics)`);
  return allStocks;
}

// --- Caching ---

async function loadDiskCache(): Promise<StockData[] | null> {
  try {
    const cacheData = await fs.readFile(CACHE_FILE, 'utf-8');
    const cache: CachedUniverse = JSON.parse(cacheData);
    const age = Date.now() - cache.lastUpdated;
    if (age < DISK_CACHE_DURATION_MS) {
      console.log(`[FMP] Using disk cache (${Math.round(age / 1000 / 60)}min old, ${cache.stocks.length} stocks)`);
      return cache.stocks;
    }
    console.log('[FMP] Disk cache expired');
    return null;
  } catch {
    console.log('[FMP] No valid disk cache');
    return null;
  }
}

async function saveDiskCache(stocks: StockData[]): Promise<void> {
  try {
    const dataDir = path.dirname(CACHE_FILE);
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(CACHE_FILE, JSON.stringify({ lastUpdated: Date.now(), stocks }));
    console.log(`[FMP] Cached ${stocks.length} stocks to disk`);
  } catch (error) {
    console.error('[FMP] Error saving cache:', error);
  }
}

export async function getStockUniverse(): Promise<StockData[]> {
  if (memoryCache && (Date.now() - memoryCache.timestamp) < MEMORY_CACHE_DURATION_MS) {
    return memoryCache.stocks;
  }

  const diskCached = await loadDiskCache();
  if (diskCached && diskCached.length > 0) {
    memoryCache = { stocks: diskCached, timestamp: Date.now() };
    return diskCached;
  }

  if (!FMP_API_KEY) {
    throw new Error('FMP API key not configured. Set FINANCIAL_MODELING_PREP_API_KEY environment variable.');
  }

  const stocks = await fetchAllStocks();
  if (stocks.length > 0) {
    memoryCache = { stocks, timestamp: Date.now() };
    await saveDiskCache(stocks);
  }

  return stocks;
}

export async function refreshStockUniverse(): Promise<StockData[]> {
  memoryCache = null;
  const stocks = await fetchAllStocks();
  if (stocks.length > 0) {
    memoryCache = { stocks, timestamp: Date.now() };
    await saveDiskCache(stocks);
  }
  return stocks;
}

export function isFMPConfigured(): boolean {
  return !!FMP_API_KEY;
}

export function getLastFMPError(): string | null {
  return lastFMPError;
}
