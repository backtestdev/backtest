/**
 * Financial Modeling Prep (FMP) Stock Universe Service
 *
 * Fetches all NYSE/NASDAQ stocks with financial metrics, caches daily,
 * and provides a filterable universe interface.
 */

import { StockData } from './stockData';
import * as fs from 'fs/promises';
import * as path from 'path';

const FMP_API_KEY = process.env.FMP_API_KEY || '';
const FMP_BASE_URL = 'https://financialmodelingprep.com/api/v3';
const CACHE_FILE = path.join(process.cwd(), 'data', 'stock-universe-cache.json');
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

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

interface FMPCompanyProfile {
  symbol: string;
  price: number;
  beta: number;
  volAvg: number;
  mktCap: number;
  lastDiv: number;
  range: string;
  changes: number;
  companyName: string;
  currency: string;
  cik: string;
  isin: string;
  cusip: string;
  exchange: string;
  exchangeShortName: string;
  industry: string;
  website: string;
  description: string;
  ceo: string;
  sector: string;
  country: string;
  fullTimeEmployees: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  dcfDiff: number;
  dcf: number;
  image: string;
  ipoDate: string;
  defaultImage: boolean;
  isEtf: boolean;
  isActivelyTrading: boolean;
  isAdr: boolean;
  isFund: boolean;
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

interface CachedUniverse {
  lastUpdated: number;
  stocks: StockData[];
}

/**
 * Fetches data from FMP API with error handling
 */
async function fetchFMP<T>(endpoint: string): Promise<T | null> {
  if (!FMP_API_KEY) {
    console.warn('FMP_API_KEY not set, using fallback data');
    return null;
  }

  try {
    const url = `${FMP_BASE_URL}${endpoint}${endpoint.includes('?') ? '&' : '?'}apikey=${FMP_API_KEY}`;
    const response = await fetch(url);

    if (!response.ok) {
      console.error(`FMP API error: ${response.status} ${response.statusText}`);
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error(`FMP fetch error for ${endpoint}:`, error);
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
 * Calculates percentage from 52-week high
 */
function calculateWeek52HighPct(currentPrice: number, yearHigh: number): number {
  if (!yearHigh || yearHigh === 0) return 0;
  return currentPrice / yearHigh;
}

/**
 * Generates historical returns from price data (simplified for now)
 * In production, this would fetch actual historical prices
 */
async function generateHistoricalReturns(): Promise<{ [year: string]: number }> {
  // For now, return empty object - can be enhanced with historical-price-full endpoint
  // This would require additional API calls and is rate-limited on free tier
  return {};
}

/**
 * Normalizes FMP data into our StockData schema
 */
async function normalizeStock(
  quote: FMPQuote,
  profile: FMPCompanyProfile | null,
  keyMetrics: FMPKeyMetrics | null,
  growthData: FMPFinancialGrowth[],
  incomeStatements: FMPIncomeStatement[]
): Promise<StockData> {
  const marketCapBillions = (quote.marketCap || profile?.mktCap || 0) / 1_000_000_000;

  // Calculate derived metrics
  const revenueGrowthQuarters = calculateConsecutiveQuarters(growthData, 'revenueGrowth');
  const netIncomeGrowthQuarters = calculateConsecutiveQuarters(growthData, 'netIncomeGrowth');
  const dividendGrowthYears = calculateDividendGrowthYears(growthData);
  const week52HighPct = calculateWeek52HighPct(quote.price, quote.yearHigh);

  // Calculate profit margin from most recent income statement
  const latestIncome = incomeStatements.find(s => s.period === 'FY');
  const profitMargin = latestIncome?.netIncomeRatio || 0;

  // Get average revenue/earnings growth from growth data
  const recentGrowth = growthData.find(g => g.period === 'FY');
  const revenueGrowth = recentGrowth?.revenueGrowth || 0;
  const earningsGrowth = recentGrowth?.netIncomeGrowth || 0;

  // Calculate shares outstanding change (for buyback detection)
  const sharesChange = recentGrowth?.weightedAverageSharesDilutedGrowth || 0;

  const stock: StockData = {
    ticker: quote.symbol,
    name: profile?.companyName || quote.name,
    sector: mapSector(profile?.sector || ''),

    // Valuation metrics
    pe_ratio: quote.pe || keyMetrics?.peRatio || 0,
    forward_pe: 0, // FMP doesn't provide forward P/E in free tier
    price_to_book: keyMetrics?.pbRatio || 0,

    // Dividend metrics
    dividend_yield: keyMetrics?.dividendYield || 0,
    dividend_growth_years: dividendGrowthYears,
    payout_ratio: keyMetrics?.payoutRatio || 0,

    // Growth metrics
    revenue_growth: revenueGrowth,
    revenue_growth_quarters: revenueGrowthQuarters,
    net_income_growth_quarters: netIncomeGrowthQuarters,
    earnings_growth: earningsGrowth,

    // Profitability metrics
    profit_margin: profitMargin,
    roe: keyMetrics?.roe || 0,
    roic: keyMetrics?.roic || 0,

    // Leverage & liquidity
    debt_to_equity: keyMetrics?.debtToEquity || 0,
    current_ratio: keyMetrics?.currentRatio || 0,
    free_cash_flow_per_share: keyMetrics?.freeCashFlowPerShare || 0,

    // Market metrics
    market_cap: marketCapBillions,
    beta: profile?.beta || 0,
    week52_high_pct: week52HighPct,

    // Share metrics
    shares_outstanding: quote.sharesOutstanding || 0,
    shares_change_pct: sharesChange,

    // Other
    ipo_date: profile?.ipoDate || '',

    // Historical returns (would need additional API calls)
    historical_returns: await generateHistoricalReturns(),
  };

  return stock;
}

/**
 * Fetches all NYSE and NASDAQ stocks
 */
async function fetchAllStocks(): Promise<StockData[]> {
  console.log('Fetching stock universe from FMP...');

  // Fetch stock screener for NYSE and NASDAQ
  const nyseStocks = await fetchFMP<FMPQuote[]>('/stock-screener?exchange=NYSE&limit=5000') || [];
  const nasdaqStocks = await fetchFMP<FMPQuote[]>('/stock-screener?exchange=NASDAQ&limit=5000') || [];

  const allQuotes = [...nyseStocks, ...nasdaqStocks];
  console.log(`Found ${allQuotes.length} stocks`);

  // Filter out non-common stocks (ETFs, funds, etc.)
  const commonStocks = allQuotes.filter(q =>
    q.marketCap > 0 &&
    !q.symbol.includes('.') &&
    q.symbol.length <= 5
  );

  console.log(`Processing ${commonStocks.length} common stocks`);

  const stocks: StockData[] = [];

  // Process stocks in batches to avoid rate limiting
  const BATCH_SIZE = 10;
  for (let i = 0; i < Math.min(commonStocks.length, 300); i += BATCH_SIZE) {
    const batch = commonStocks.slice(i, i + BATCH_SIZE);

    const batchPromises = batch.map(async (quote) => {
      try {
        // Fetch additional data for each stock
        const [profile, keyMetrics, growthData, incomeStatements] = await Promise.all([
          fetchFMP<FMPCompanyProfile[]>(`/profile/${quote.symbol}`).then(r => r?.[0] || null),
          fetchFMP<FMPKeyMetrics[]>(`/key-metrics/${quote.symbol}?period=annual&limit=1`).then(r => r?.[0] || null),
          fetchFMP<FMPFinancialGrowth[]>(`/financial-growth/${quote.symbol}?period=quarter&limit=8`).then(r => r || []),
          fetchFMP<FMPIncomeStatement[]>(`/income-statement/${quote.symbol}?period=annual&limit=1`).then(r => r || []),
        ]);

        return await normalizeStock(quote, profile, keyMetrics, growthData, incomeStatements);
      } catch (error) {
        console.error(`Error processing ${quote.symbol}:`, error);
        return null;
      }
    });

    const batchResults = await Promise.all(batchPromises);
    stocks.push(...batchResults.filter((s): s is StockData => s !== null));

    console.log(`Processed ${stocks.length} stocks so far...`);

    // Small delay to respect rate limits
    if (i + BATCH_SIZE < commonStocks.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log(`Completed fetching ${stocks.length} stocks`);
  return stocks;
}

/**
 * Loads cached stock universe if valid
 */
async function loadCache(): Promise<StockData[] | null> {
  try {
    const cacheData = await fs.readFile(CACHE_FILE, 'utf-8');
    const cache: CachedUniverse = JSON.parse(cacheData);

    const age = Date.now() - cache.lastUpdated;
    if (age < CACHE_DURATION_MS) {
      console.log(`Using cached stock universe (${Math.round(age / 1000 / 60)} minutes old)`);
      return cache.stocks;
    }

    console.log('Cache expired, fetching fresh data');
    return null;
  } catch {
    console.log('No valid cache found, fetching fresh data');
    return null;
  }
}

/**
 * Saves stock universe to cache
 */
async function saveCache(stocks: StockData[]): Promise<void> {
  try {
    const cache: CachedUniverse = {
      lastUpdated: Date.now(),
      stocks,
    };

    // Ensure data directory exists
    const dataDir = path.dirname(CACHE_FILE);
    await fs.mkdir(dataDir, { recursive: true });

    await fs.writeFile(CACHE_FILE, JSON.stringify(cache, null, 2));
    console.log(`Cached ${stocks.length} stocks to ${CACHE_FILE}`);
  } catch (error) {
    console.error('Error saving cache:', error);
  }
}

/**
 * Gets the stock universe with daily caching
 */
export async function getStockUniverse(): Promise<StockData[]> {
  // Try to load from cache first
  const cached = await loadCache();
  if (cached) {
    return cached;
  }

  // Fetch fresh data
  const stocks = await fetchAllStocks();

  // Save to cache
  await saveCache(stocks);

  return stocks;
}

/**
 * Forces a refresh of the stock universe cache
 */
export async function refreshStockUniverse(): Promise<StockData[]> {
  console.log('Force refreshing stock universe...');
  const stocks = await fetchAllStocks();
  await saveCache(stocks);
  return stocks;
}
