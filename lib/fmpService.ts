/**
 * Financial Modeling Prep (FMP) Stock Universe Service
 *
 * Fetches all NYSE/NASDAQ stocks with financial metrics, caches in-memory
 * and to disk, and provides a filterable universe interface.
 */

import { StockData } from './stockData';
import * as fs from 'fs/promises';
import * as path from 'path';

// Support both env var names (FINANCIAL_MODELING_PREP_API_KEY is the canonical one on Vercel)
const FMP_API_KEY = process.env.FINANCIAL_MODELING_PREP_API_KEY || process.env.FMP_API_KEY || '';
const FMP_BASE_URL = 'https://financialmodelingprep.com/stable';
const CACHE_FILE = path.join(process.cwd(), 'data', 'stock-universe-cache.json');
const DISK_CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours for disk cache
const MEMORY_CACHE_DURATION_MS = 10 * 60 * 1000; // 10 minutes for in-memory cache

// Validate env on module load
if (!FMP_API_KEY) {
  console.warn('[FMP] WARNING: FINANCIAL_MODELING_PREP_API_KEY is not set. Stock data will use hardcoded fallback (~100 stocks).');
  console.warn('[FMP] Set FINANCIAL_MODELING_PREP_API_KEY in your environment variables for live data from 500+ stocks.');
} else {
  console.log('[FMP] API key configured. Will fetch live stock data from Financial Modeling Prep.');
}

// In-memory cache to avoid hitting FMP rate limits
let memoryCache: { stocks: StockData[]; timestamp: number } | null = null;

// Track last FMP error for detailed error reporting
let lastFMPError: string | null = null;

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
  earningsAnnouncement: string;
  sharesOutstanding: number;
  timestamp: number;
}

interface FMPKeyMetrics {
  symbol: string;
  date: string;
  period: string;
  revenuePerShare: number;
  netIncomePerShare: number;
  operatingCashFlowPerShare: number;
  freeCashFlowPerShare: number;
  cashPerShare: number;
  bookValuePerShare: number;
  tangibleBookValuePerShare: number;
  shareholdersEquityPerShare: number;
  interestDebtPerShare: number;
  marketCap: number;
  enterpriseValue: number;
  peRatio: number;
  priceToSalesRatio: number;
  pocfratio: number;
  pfcfRatio: number;
  pbRatio: number;
  ptbRatio: number;
  evToSales: number;
  enterpriseValueOverEBITDA: number;
  evToOperatingCashFlow: number;
  evToFreeCashFlow: number;
  earningsYield: number;
  freeCashFlowYield: number;
  debtToEquity: number;
  debtToAssets: number;
  netDebtToEBITDA: number;
  currentRatio: number;
  interestCoverage: number;
  incomeQuality: number;
  dividendYield: number;
  payoutRatio: number;
  salesGeneralAndAdministrativeToRevenue: number;
  researchAndDdevelopementToRevenue: number;
  intangiblesToTotalAssets: number;
  capexToOperatingCashFlow: number;
  capexToRevenue: number;
  capexToDepreciation: number;
  stockBasedCompensationToRevenue: number;
  grahamNumber: number;
  roic: number;
  returnOnTangibleAssets: number;
  grahamNetNet: number;
  workingCapital: number;
  tangibleAssetValue: number;
  netCurrentAssetValue: number;
  investedCapital: number;
  averageReceivables: number;
  averagePayables: number;
  averageInventory: number;
  daysSalesOutstanding: number;
  daysPayablesOutstanding: number;
  daysOfInventoryOnHand: number;
  receivablesTurnover: number;
  payablesTurnover: number;
  inventoryTurnover: number;
  roe: number;
  capexPerShare: number;
}

interface FMPFinancialGrowth {
  symbol: string;
  date: string;
  period: string;
  revenueGrowth: number;
  grossProfitGrowth: number;
  ebitgrowth: number;
  operatingIncomeGrowth: number;
  netIncomeGrowth: number;
  epsgrowth: number;
  epsdilutedGrowth: number;
  weightedAverageSharesGrowth: number;
  weightedAverageSharesDilutedGrowth: number;
  dividendsperShareGrowth: number;
  operatingCashFlowGrowth: number;
  freeCashFlowGrowth: number;
  tenYRevenueGrowthPerShare: number;
  fiveYRevenueGrowthPerShare: number;
  threeYRevenueGrowthPerShare: number;
  tenYOperatingCFGrowthPerShare: number;
  fiveYOperatingCFGrowthPerShare: number;
  threeYOperatingCFGrowthPerShare: number;
  tenYNetIncomeGrowthPerShare: number;
  fiveYNetIncomeGrowthPerShare: number;
  threeYNetIncomeGrowthPerShare: number;
  tenYShareholdersEquityGrowthPerShare: number;
  fiveYShareholdersEquityGrowthPerShare: number;
  threeYShareholdersEquityGrowthPerShare: number;
  tenYDividendperShareGrowthPerShare: number;
  fiveYDividendperShareGrowthPerShare: number;
  threeYDividendperShareGrowthPerShare: number;
  receivablesGrowth: number;
  inventoryGrowth: number;
  assetGrowth: number;
  bookValueperShareGrowth: number;
  debtGrowth: number;
  rdexpenseGrowth: number;
  sgaexpensesGrowth: number;
}

interface FMPIncomeStatement {
  date: string;
  symbol: string;
  reportedCurrency: string;
  cik: string;
  fillingDate: string;
  acceptedDate: string;
  calendarYear: string;
  period: string;
  revenue: number;
  costOfRevenue: number;
  grossProfit: number;
  grossProfitRatio: number;
  researchAndDevelopmentExpenses: number;
  generalAndAdministrativeExpenses: number;
  sellingAndMarketingExpenses: number;
  sellingGeneralAndAdministrativeExpenses: number;
  otherExpenses: number;
  operatingExpenses: number;
  costAndExpenses: number;
  interestIncome: number;
  interestExpense: number;
  depreciationAndAmortization: number;
  ebitda: number;
  ebitdaratio: number;
  operatingIncome: number;
  operatingIncomeRatio: number;
  totalOtherIncomeExpensesNet: number;
  incomeBeforeTax: number;
  incomeBeforeTaxRatio: number;
  incomeTaxExpense: number;
  netIncome: number;
  netIncomeRatio: number;
  eps: number;
  epsdiluted: number;
  weightedAverageShsOut: number;
  weightedAverageShsOutDil: number;
}

// Response type for /stable/actively-trading-list
interface FMPActivelyTradingStock {
  symbol: string;
  name: string;
  exchange: string;
  exchangeShortName?: string;
  price?: number;
  type?: string;
}

// Response type for /stable/profile
interface FMPProfile {
  symbol: string;
  companyName: string;
  marketCap: number;
  sector: string;
  industry: string;
  beta: number;
  price: number;
  lastDiv: number;
  exchange: string;
  exchangeShortName: string;
  country: string;
  isEtf: boolean;
  isActivelyTrading: boolean;
  ipoDate: string;
}

interface CachedUniverse {
  lastUpdated: number;
  stocks: StockData[];
}

/**
 * Fetches data from FMP API with error handling
 */
async function fetchFMP<T>(endpoint: string): Promise<T | null> {
  if (!FMP_API_KEY) {
    lastFMPError = "FMP API key is not configured. Set FINANCIAL_MODELING_PREP_API_KEY or FMP_API_KEY environment variable.";
    return null;
  }

  try {
    const url = `${FMP_BASE_URL}${endpoint}${endpoint.includes('?') ? '&' : '?'}apikey=${FMP_API_KEY}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15000), // 15s timeout per request
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      lastFMPError = `FMP API returned ${response.status} ${response.statusText} for ${endpoint}`;
      if (response.status === 403) {
        lastFMPError += ' — check that your API key is valid and has access to /stable endpoints';
      } else if (response.status === 429) {
        lastFMPError += ' — rate limit exceeded, try again later';
      }
      console.error(`[FMP] API error: ${response.status} ${response.statusText} for ${endpoint}`, body ? `body: ${body.slice(0, 200)}` : '');
      return null;
    }

    const data = await response.json();

    // FMP returns an error message object when rate limited or key is invalid
    if (data && typeof data === 'object' && 'Error Message' in data) {
      lastFMPError = `FMP API error: ${data['Error Message']}`;
      console.error(`[FMP] API error response: ${data['Error Message']}`);
      return null;
    }

    // Handle { message: "..." } error format used by some stable endpoints
    if (data && typeof data === 'object' && !Array.isArray(data) && 'message' in data && Object.keys(data).length <= 2) {
      lastFMPError = `FMP API error: ${data['message']}`;
      console.error(`[FMP] API error response: ${data['message']}`);
      return null;
    }

    // Clear error on success
    lastFMPError = null;
    return data as T;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    lastFMPError = `Network error: ${errorMsg}`;
    console.error(`[FMP] Fetch error for ${endpoint}:`, errorMsg);
    return null;
  }
}

/**
 * Maps FMP sector to numeric sector code
 */
function mapSector(sector: string): number {
  const sectorMap: { [key: string]: number } = {
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

/**
 * Calculates consecutive quarters of positive growth
 */
function calculateConsecutiveQuarters(growthData: FMPFinancialGrowth[], field: 'revenueGrowth' | 'netIncomeGrowth'): number {
  if (!growthData || growthData.length === 0) return 0;

  // Sort by date descending (most recent first)
  const sorted = [...growthData]
    .filter(d => d.period === 'Q')
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  let consecutive = 0;
  for (const item of sorted) {
    if (item[field] > 0) {
      consecutive++;
    } else {
      break;
    }
  }

  return consecutive;
}

/**
 * Calculates years of consecutive dividend growth
 */
function calculateDividendGrowthYears(growthData: FMPFinancialGrowth[]): number {
  if (!growthData || growthData.length === 0) return 0;

  // Get annual data only
  const annualData = [...growthData]
    .filter(d => d.period === 'FY')
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  let years = 0;
  for (const item of annualData) {
    if (item.dividendsperShareGrowth > 0) {
      years++;
    } else {
      break;
    }
  }

  return years;
}

/**
 * Fetches stock universe using /stable/actively-trading-list + batch quotes + profiles,
 * then enriches top stocks with detailed metrics.
 *
 * Migration note: The legacy /api/v3/stock-screener endpoint is deprecated.
 * We now use /stable/actively-trading-list for the universe, /stable/quote for
 * price data, and /stable/profile for sector/beta/company info.
 */
async function fetchAllStocks(): Promise<StockData[]> {
  console.log('[FMP] Fetching stock universe...');

  // Step 1: Get actively trading stocks (replaces deprecated stock-screener)
  const activeStocks = await fetchFMP<FMPActivelyTradingStock[]>('/actively-trading-list');

  if (!activeStocks || activeStocks.length === 0) {
    console.error('[FMP] Actively trading list returned no results');
    return [];
  }

  // Step 2: Client-side filtering for NYSE/NASDAQ common stocks
  // (Previously done server-side by the stock-screener endpoint)
  const commonStocks = activeStocks.filter(s =>
    s.symbol &&
    !s.symbol.includes('.') &&
    s.symbol.length <= 5 &&
    (s.exchangeShortName === 'NYSE' || s.exchangeShortName === 'NASDAQ' ||
     s.exchange?.includes('NYSE') || s.exchange?.includes('NASDAQ'))
  );

  console.log(`[FMP] Filtered to ${commonStocks.length} NYSE/NASDAQ stocks from ${activeStocks.length} total`);

  // Step 3: Batch fetch quotes for price/marketCap data
  const BATCH_SIZE = 100;
  const quoteMap = new Map<string, FMPQuote>();
  const allStocks: StockData[] = [];

  for (let i = 0; i < Math.min(commonStocks.length, 3000); i += BATCH_SIZE) {
    const batch = commonStocks.slice(i, i + BATCH_SIZE);
    const symbols = batch.map(s => s.symbol).join(',');

    // Stable API uses query param: /quote?symbol=SYM1,SYM2
    const batchQuotes = await fetchFMP<FMPQuote[]>(`/quote?symbol=${symbols}`);

    if (!batchQuotes) {
      console.warn(`[FMP] Failed to fetch quotes for batch starting at ${i}`);
      continue;
    }

    for (const q of batchQuotes) {
      quoteMap.set(q.symbol, q);
    }

    console.log(`[FMP] Fetched quotes for ${quoteMap.size} stocks so far...`);

    // Small delay to respect rate limits
    if (i + BATCH_SIZE < commonStocks.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  // Step 4: Build StockData entries for stocks with marketCap > $300M
  for (const stock of commonStocks) {
    const quote = quoteMap.get(stock.symbol);
    if (!quote || !quote.marketCap || quote.marketCap <= 300_000_000) continue;

    const marketCapBillions = quote.marketCap / 1_000_000_000;
    const week52HighPct = quote.yearHigh > 0 ? quote.price / quote.yearHigh : 0;

    allStocks.push({
      ticker: stock.symbol,
      name: quote.name || stock.name || '',
      sector: 0, // Set from profile below
      pe_ratio: quote.pe || 0,
      forward_pe: 0,
      price_to_book: 0,
      dividend_yield: 0, // Set from profile below
      dividend_growth_years: 0,
      payout_ratio: 0,
      revenue_growth: 0,
      revenue_growth_quarters: 0,
      earnings_growth: 0,
      profit_margin: 0,
      roe: 0,
      roic: 0,
      debt_to_equity: 0,
      current_ratio: 0,
      free_cash_flow_per_share: 0,
      market_cap: marketCapBillions,
      beta: 0, // Set from profile below
      week52_high_pct: week52HighPct,
      shares_outstanding: quote.sharesOutstanding || 0,
      shares_change_pct: 0,
      ipo_date: '',
      historical_returns: {},
    });
  }

  console.log(`[FMP] ${allStocks.length} stocks with market cap > $300M`);

  // Step 5: Batch fetch profiles for sector, beta, dividend data
  const profileMap = new Map<string, FMPProfile>();

  for (let i = 0; i < allStocks.length; i += BATCH_SIZE) {
    const batch = allStocks.slice(i, i + BATCH_SIZE);
    const symbols = batch.map(s => s.ticker).join(',');

    // Stable API: /profile?symbol=SYM1,SYM2
    const batchProfiles = await fetchFMP<FMPProfile[]>(`/profile?symbol=${symbols}`);

    if (batchProfiles) {
      const profiles = Array.isArray(batchProfiles) ? batchProfiles : [batchProfiles];
      for (const p of profiles) {
        if (p && p.symbol) profileMap.set(p.symbol, p);
      }
    }

    if (i + BATCH_SIZE < allStocks.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  // Apply profile data (sector, beta, dividend, ipoDate)
  for (let i = 0; i < allStocks.length; i++) {
    const profile = profileMap.get(allStocks[i].ticker);
    if (profile) {
      allStocks[i].sector = mapSector(profile.sector || '');
      allStocks[i].beta = profile.beta || 0;
      allStocks[i].ipo_date = profile.ipoDate || '';
      if (profile.lastDiv && profile.lastDiv > 0) {
        const quote = quoteMap.get(allStocks[i].ticker);
        if (quote && quote.price > 0) {
          allStocks[i].dividend_yield = profile.lastDiv / quote.price;
        }
      }
    }
  }

  // Step 6: Enrich top 300 stocks (by market cap) with detailed metrics
  const sortedByMarketCap = [...allStocks].sort((a, b) => b.market_cap - a.market_cap);
  const topStocks = sortedByMarketCap.slice(0, 300);
  const topSymbols = new Set(topStocks.map(s => s.ticker));

  console.log(`[FMP] Enriching top ${topStocks.length} stocks with detailed metrics...`);

  const ENRICH_BATCH = 5;
  for (let i = 0; i < topStocks.length; i += ENRICH_BATCH) {
    const batch = topStocks.slice(i, i + ENRICH_BATCH);

    const enrichPromises = batch.map(async (stock) => {
      try {
        // Stable API uses query params: /endpoint?symbol=TICKER&param=value
        const [keyMetrics, growthData, incomeStatements] = await Promise.all([
          fetchFMP<FMPKeyMetrics[]>(`/key-metrics?symbol=${stock.ticker}&period=annual&limit=1`).then(r => r?.[0] || null),
          fetchFMP<FMPFinancialGrowth[]>(`/financial-growth?symbol=${stock.ticker}&period=quarter&limit=8`).then(r => r || []),
          fetchFMP<FMPIncomeStatement[]>(`/income-statement?symbol=${stock.ticker}&period=annual&limit=1`).then(r => r || []),
        ]);

        // Update the stock in the main array
        const idx = allStocks.findIndex(s => s.ticker === stock.ticker);
        if (idx === -1) return;

        if (keyMetrics) {
          allStocks[idx].price_to_book = keyMetrics.pbRatio || 0;
          allStocks[idx].dividend_yield = keyMetrics.dividendYield || allStocks[idx].dividend_yield;
          allStocks[idx].payout_ratio = keyMetrics.payoutRatio || 0;
          allStocks[idx].roe = keyMetrics.roe || 0;
          allStocks[idx].roic = keyMetrics.roic || 0;
          allStocks[idx].debt_to_equity = keyMetrics.debtToEquity || 0;
          allStocks[idx].current_ratio = keyMetrics.currentRatio || 0;
          allStocks[idx].free_cash_flow_per_share = keyMetrics.freeCashFlowPerShare || 0;
        }

        if (growthData.length > 0) {
          const recentGrowth = growthData.find(g => g.period === 'FY') || growthData[0];
          allStocks[idx].revenue_growth = recentGrowth?.revenueGrowth || 0;
          allStocks[idx].earnings_growth = recentGrowth?.netIncomeGrowth || 0;
          allStocks[idx].revenue_growth_quarters = calculateConsecutiveQuarters(growthData, 'revenueGrowth');
          allStocks[idx].net_income_growth_quarters = calculateConsecutiveQuarters(growthData, 'netIncomeGrowth');
          allStocks[idx].dividend_growth_years = calculateDividendGrowthYears(growthData);
        }

        if (incomeStatements.length > 0) {
          const latestIncome = incomeStatements[0];
          allStocks[idx].profit_margin = latestIncome.netIncomeRatio || 0;
        }
      } catch (error) {
        console.error(`[FMP] Error enriching ${stock.ticker}:`, error instanceof Error ? error.message : error);
      }
    });

    await Promise.all(enrichPromises);

    // Throttle to respect rate limits
    if (i + ENRICH_BATCH < topStocks.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  console.log(`[FMP] Completed fetching ${allStocks.length} stocks (${topSymbols.size} enriched with detailed metrics)`);
  return allStocks;
}

/**
 * Loads cached stock universe from disk if valid
 */
async function loadDiskCache(): Promise<StockData[] | null> {
  try {
    const cacheData = await fs.readFile(CACHE_FILE, 'utf-8');
    const cache: CachedUniverse = JSON.parse(cacheData);

    const age = Date.now() - cache.lastUpdated;
    if (age < DISK_CACHE_DURATION_MS) {
      console.log(`[FMP] Using disk-cached stock universe (${Math.round(age / 1000 / 60)} minutes old, ${cache.stocks.length} stocks)`);
      return cache.stocks;
    }

    console.log('[FMP] Disk cache expired, fetching fresh data');
    return null;
  } catch {
    console.log('[FMP] No valid disk cache found');
    return null;
  }
}

/**
 * Saves stock universe to disk cache
 */
async function saveDiskCache(stocks: StockData[]): Promise<void> {
  try {
    const cache: CachedUniverse = {
      lastUpdated: Date.now(),
      stocks,
    };

    // Ensure data directory exists
    const dataDir = path.dirname(CACHE_FILE);
    await fs.mkdir(dataDir, { recursive: true });

    await fs.writeFile(CACHE_FILE, JSON.stringify(cache));
    console.log(`[FMP] Cached ${stocks.length} stocks to disk`);
  } catch (error) {
    console.error('[FMP] Error saving disk cache:', error);
  }
}

/**
 * Gets the stock universe with multi-level caching:
 * 1. In-memory cache (10 min TTL) - fastest
 * 2. Disk cache (24h TTL) - survives restarts
 * 3. Fresh FMP API fetch - slowest
 */
export async function getStockUniverse(): Promise<StockData[]> {
  // Level 1: In-memory cache
  if (memoryCache && (Date.now() - memoryCache.timestamp) < MEMORY_CACHE_DURATION_MS) {
    console.log(`[FMP] Using in-memory cache (${memoryCache.stocks.length} stocks)`);
    return memoryCache.stocks;
  }

  // Level 2: Disk cache
  const diskCached = await loadDiskCache();
  if (diskCached && diskCached.length > 0) {
    memoryCache = { stocks: diskCached, timestamp: Date.now() };
    return diskCached;
  }

  // Level 3: Fresh API fetch
  if (!FMP_API_KEY) {
    console.warn('[FMP] No API key, returning empty array (caller should use fallback)');
    return [];
  }

  const stocks = await fetchAllStocks();

  if (stocks.length > 0) {
    memoryCache = { stocks, timestamp: Date.now() };
    await saveDiskCache(stocks);
  }

  return stocks;
}

/**
 * Forces a refresh of the stock universe cache
 */
export async function refreshStockUniverse(): Promise<StockData[]> {
  console.log('[FMP] Force refreshing stock universe...');
  memoryCache = null;

  const stocks = await fetchAllStocks();
  if (stocks.length > 0) {
    memoryCache = { stocks, timestamp: Date.now() };
    await saveDiskCache(stocks);
  }
  return stocks;
}

/**
 * Checks if FMP API is configured and accessible
 */
export function isFMPConfigured(): boolean {
  return !!FMP_API_KEY;
}

/**
 * Returns the last error message from FMP API, if any
 */
export function getLastFMPError(): string | null {
  return lastFMPError;
}
