/**
 * One-time stock database population script.
 *
 * Fetches stock data from Financial Modeling Prep API and writes it into
 * PostgreSQL tables (stocks, quotes, ratios, profiles).
 *
 * FMP Starter plan: 300 req/min. We throttle to ~200 req/min with retry
 * on 429 to stay within limits.
 *
 * Budget: ~1500 stocks × 5 calls/stock × 300ms ≈ 37 min
 *
 * Usage:
 *   npx tsx scripts/populate-stocks.ts
 *
 * Required env vars:
 *   DATABASE_URL                       - Neon PostgreSQL connection string
 *   FINANCIAL_MODELING_PREP_API_KEY    - FMP API key (or FMP_API_KEY)
 *
 * The script is idempotent — it uses upserts so running it again refreshes data.
 */

import { neon } from "@neondatabase/serverless";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const FMP_API_KEY =
  process.env.FINANCIAL_MODELING_PREP_API_KEY ||
  process.env.FMP_API_KEY ||
  "";
const FMP_BASE = "https://financialmodelingprep.com/stable";
const DATABASE_URL = process.env.DATABASE_URL || "";

if (!FMP_API_KEY) {
  console.error("ERROR: Set FINANCIAL_MODELING_PREP_API_KEY or FMP_API_KEY");
  process.exit(1);
}
if (!DATABASE_URL) {
  console.error("ERROR: Set DATABASE_URL");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

// ---------------------------------------------------------------------------
// Rate-limited FMP fetch helper
// ---------------------------------------------------------------------------

let lastFetchTime = 0;
const MIN_FETCH_INTERVAL_MS = 300; // ~200 req/min, under 300/min limit

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchFMP<T>(endpoint: string, retries = 2): Promise<T | null> {
  const elapsed = Date.now() - lastFetchTime;
  if (elapsed < MIN_FETCH_INTERVAL_MS) {
    await sleep(MIN_FETCH_INTERVAL_MS - elapsed);
  }
  lastFetchTime = Date.now();

  const url = `${FMP_BASE}${endpoint}${endpoint.includes("?") ? "&" : "?"}apikey=${FMP_API_KEY}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (res.status === 429 && retries > 0) {
      console.warn(`  FMP 429 rate limited on ${endpoint}, retrying in 3s...`);
      await sleep(3000);
      return fetchFMP<T>(endpoint, retries - 1);
    }
    if (!res.ok) {
      console.error(`  FMP ${res.status} for ${endpoint}`);
      return null;
    }
    const data = await res.json();
    if (data && typeof data === "object" && "Error Message" in data) {
      console.error(`  FMP error: ${(data as Record<string, string>)["Error Message"]}`);
      return null;
    }
    return data as T;
  } catch (e) {
    console.error(`  FMP network error for ${endpoint}:`, e instanceof Error ? e.message : e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Types (mirrors FMP /stable/ response shapes — all camelCase)
// ---------------------------------------------------------------------------

interface ScreenerResult {
  symbol: string;
  companyName: string;
  marketCap: number;
  sector: string;
  industry: string;
  beta: number;
  price: number;
  lastAnnualDividend: number;
  volume: number;
  exchange: string;
  exchangeShortName: string;
  country: string;
  isEtf: boolean;
  isFund: boolean;
  isActivelyTrading: boolean;
}

interface Quote {
  symbol: string;
  price: number;
  changesPercentage: number;
  dayLow: number;
  dayHigh: number;
  yearHigh: number;
  yearLow: number;
  marketCap: number;
  priceAvg50: number;
  priceAvg200: number;
  volume: number;
  avgVolume: number;
  eps: number;
  pe: number;
  sharesOutstanding: number;
}

interface KeyMetrics {
  marketCap: number;
  enterpriseValue: number;
  evToSales: number;
  evToOperatingCashFlow: number;
  evToFreeCashFlow: number;
  evToEBITDA: number;
  netDebtToEBITDA: number;
  currentRatio: number;
  incomeQuality: number;
  grahamNumber: number;
  grahamNetNet: number;
  taxBurden: number;
  interestBurden: number;
  workingCapital: number;
  investedCapital: number;
  returnOnAssets: number;
  operatingReturnOnAssets: number;
  returnOnTangibleAssets: number;
  returnOnEquity: number;
  returnOnInvestedCapital: number;
  returnOnCapitalEmployed: number;
  earningsYield: number;
  freeCashFlowYield: number;
  capexToOperatingCashFlow: number;
  capexToDepreciation: number;
  capexToRevenue: number;
  salesGeneralAndAdministrativeToRevenue: number;
  researchAndDevelopementToRevenue: number;
  stockBasedCompensationToRevenue: number;
  intangiblesToTotalAssets: number;
  averageReceivables: number;
  averagePayables: number;
  averageInventory: number;
  daysOfSalesOutstanding: number;
  daysOfPayablesOutstanding: number;
  daysOfInventoryOutstanding: number;
  operatingCycle: number;
  cashConversionCycle: number;
  freeCashFlowToEquity: number;
  freeCashFlowToFirm: number;
  tangibleAssetValue: number;
  netCurrentAssetValue: number;
}

interface FinancialRatios {
  grossProfitMargin: number;
  ebitMargin: number;
  ebitdaMargin: number;
  operatingProfitMargin: number;
  pretaxProfitMargin: number;
  continuousOperationsProfitMargin: number;
  netProfitMargin: number;
  bottomLineProfitMargin: number;
  receivablesTurnover: number;
  payablesTurnover: number;
  inventoryTurnover: number;
  fixedAssetTurnover: number;
  assetTurnover: number;
  currentRatio: number;
  quickRatio: number;
  solvencyRatio: number;
  cashRatio: number;
  priceToEarningsRatio: number;
  priceToEarningsGrowthRatio: number;
  forwardPriceToEarningsGrowthRatio: number;
  priceToBookRatio: number;
  priceToSalesRatio: number;
  priceToFreeCashFlowRatio: number;
  priceToOperatingCashFlowRatio: number;
  debtToAssetsRatio: number;
  debtToEquityRatio: number;
  debtToCapitalRatio: number;
  longTermDebtToCapitalRatio: number;
  financialLeverageRatio: number;
  workingCapitalTurnoverRatio: number;
  operatingCashFlowRatio: number;
  operatingCashFlowSalesRatio: number;
  freeCashFlowOperatingCashFlowRatio: number;
  debtServiceCoverageRatio: number;
  interestCoverageRatio: number;
  shortTermOperatingCashFlowCoverageRatio: number;
  operatingCashFlowCoverageRatio: number;
  capitalExpenditureCoverageRatio: number;
  dividendPaidAndCapexCoverageRatio: number;
  dividendPayoutRatio: number;
  dividendYield: number;
  dividendYieldPercentage: number;
  revenuePerShare: number;
  netIncomePerShare: number;
  interestDebtPerShare: number;
  cashPerShare: number;
  bookValuePerShare: number;
  tangibleBookValuePerShare: number;
  shareholdersEquityPerShare: number;
  operatingCashFlowPerShare: number;
  capexPerShare: number;
  freeCashFlowPerShare: number;
  netIncomePerEBT: number;
  ebtPerEbit: number;
  priceToFairValue: number;
  debtToMarketCap: number;
  effectiveTaxRate: number;
  enterpriseValueMultiple: number;
}

interface GrowthData {
  date: string;
  period: string; // "FY", "Q1", "Q2", "Q3", "Q4"
  revenueGrowth: number;
  netIncomeGrowth: number;
  dividendsperShareGrowth: number;
}

interface IncomeData {
  netIncomeRatio: number;
}

// Name patterns that indicate funds, trusts, SPACs, debt instruments, etc. — NOT operating companies
const EXCLUDE_NAME_PATTERNS = /\b(ETF|ETN|Exchange.Traded|Index Fund|Mutual Fund|Bond Fund|Income Fund|Money Market|Closed.End|Acquisition Corp|Blank Check|SPAC|Special Purpose|Statutory Trust|Capital Trust|Investment Trust|Depositary Shares?|Depositary Receipt|Preferred Shares?|Preferred Stock|Preferred Securities|Fixed.Income)\b|\bTrust [IVX]+\b|\d+\.?\d*% |\bRights$|\bWarrants?$/i;

// ---------------------------------------------------------------------------
// Step 1: Fetch screener → insert stocks
// ---------------------------------------------------------------------------

async function populateStocks(): Promise<string[]> {
  console.log("Step 1/3: Fetching stock screener...");
  const results = await fetchFMP<ScreenerResult[]>(
    "/company-screener?marketCapMoreThan=300000000&isEtf=false&isFund=false&isActivelyTrading=true&exchange=NYSE,NASDAQ&limit=3000"
  );

  if (!results || results.length === 0) {
    throw new Error("Screener returned no results");
  }

  // Filter: common stocks only (no ETFs, funds, or sectorless instruments)
  const filtered = results.filter(
    (s) =>
      s.marketCap > 0 &&
      !s.symbol.includes(".") &&
      s.symbol.length <= 5 &&
      !s.isEtf &&
      !s.isFund &&
      s.sector &&
      s.sector.trim() !== "" &&
      !EXCLUDE_NAME_PATTERNS.test(s.companyName)
  );
  console.log(`  ${results.length} screener results → ${filtered.length} common stocks`);

  for (const s of filtered) {
    await sql`
      INSERT INTO stocks (symbol, company_name, sector, industry, country, exchange, exchange_short_name, market_cap, beta, last_annual_dividend, is_etf, is_actively_trading, updated_at)
      VALUES (${s.symbol}, ${s.companyName}, ${s.sector}, ${s.industry}, ${s.country}, ${s.exchange}, ${s.exchangeShortName}, ${s.marketCap}, ${s.beta || 0}, ${s.lastAnnualDividend || 0}, ${s.isEtf}, ${s.isActivelyTrading}, NOW())
      ON CONFLICT (symbol) DO UPDATE SET
        company_name = EXCLUDED.company_name, sector = EXCLUDED.sector, industry = EXCLUDED.industry,
        country = EXCLUDED.country, exchange = EXCLUDED.exchange, exchange_short_name = EXCLUDED.exchange_short_name,
        market_cap = EXCLUDED.market_cap, beta = EXCLUDED.beta, last_annual_dividend = EXCLUDED.last_annual_dividend,
        is_etf = EXCLUDED.is_etf, is_actively_trading = EXCLUDED.is_actively_trading, updated_at = NOW()
    `;
  }

  console.log(`  Inserted/updated ${filtered.length} stocks`);
  return filtered.map((s) => s.symbol);
}

// ---------------------------------------------------------------------------
// Step 2: Enrich ALL stocks with quote + key-metrics + growth + income
// 5 API calls per stock, sequential, rate-limited
// ---------------------------------------------------------------------------

async function enrichTopStocks() {
  const topRows = await sql`SELECT symbol FROM stocks ORDER BY market_cap DESC`;
  const topSymbols = topRows.map((r) => String(r.symbol));
  console.log(`Step 2/3: Enriching ${topSymbols.length} top stocks (5 API calls each)...`);

  let enriched = 0;
  let failed = 0;

  for (const sym of topSymbols) {
    try {
      // 6 sequential calls per stock, each throttled
      const quote = await fetchFMP<Quote[]>(`/quote?symbol=${sym}`).then((r) => r?.[0] || null);
      const metrics = await fetchFMP<KeyMetrics[]>(`/key-metrics?symbol=${sym}&period=annual&limit=1`).then((r) => r?.[0] || null);
      const finRatios = await fetchFMP<FinancialRatios[]>(`/ratios?symbol=${sym}&period=annual&limit=1`).then((r) => r?.[0] || null);
      const annualGrowth = await fetchFMP<GrowthData[]>(`/financial-growth?symbol=${sym}&period=annual&limit=8`).then((r) => r || []);
      const quarterlyGrowth = await fetchFMP<GrowthData[]>(`/financial-growth?symbol=${sym}&period=quarter&limit=8`).then((r) => r || []);
      const income = await fetchFMP<IncomeData[]>(`/income-statement?symbol=${sym}&period=annual&limit=1`).then((r) => r || []);

      // Quotes table
      if (quote) {
        await sql`
          INSERT INTO quotes (symbol, price, changes_percentage, day_low, day_high, year_high, year_low, market_cap, price_avg_50, price_avg_200, volume, avg_volume, eps, pe, shares_outstanding, updated_at)
          VALUES (${sym}, ${quote.price || 0}, ${quote.changesPercentage || 0}, ${quote.dayLow || 0}, ${quote.dayHigh || 0}, ${quote.yearHigh || 0}, ${quote.yearLow || 0}, ${quote.marketCap || 0}, ${quote.priceAvg50 || 0}, ${quote.priceAvg200 || 0}, ${quote.volume || 0}, ${quote.avgVolume || 0}, ${quote.eps || 0}, ${quote.pe || 0}, ${quote.sharesOutstanding || 0}, NOW())
          ON CONFLICT (symbol) DO UPDATE SET
            price = EXCLUDED.price, changes_percentage = EXCLUDED.changes_percentage,
            day_low = EXCLUDED.day_low, day_high = EXCLUDED.day_high,
            year_high = EXCLUDED.year_high, year_low = EXCLUDED.year_low,
            market_cap = EXCLUDED.market_cap, price_avg_50 = EXCLUDED.price_avg_50,
            price_avg_200 = EXCLUDED.price_avg_200, volume = EXCLUDED.volume,
            avg_volume = EXCLUDED.avg_volume, eps = EXCLUDED.eps, pe = EXCLUDED.pe,
            shares_outstanding = EXCLUDED.shares_outstanding, updated_at = NOW()
        `;
      }

      // Ratios table — data from BOTH key-metrics and ratios endpoints
      // PE from ratios endpoint (priceToEarningsRatio), fallback to quote
      const peRatio = finRatios?.priceToEarningsRatio || quote?.pe || 0;
      const pbRatio = finRatios?.priceToBookRatio || 0;
      const priceToSales = finRatios?.priceToSalesRatio || 0;
      const debtToEquity = finRatios?.debtToEquityRatio || 0;
      const roe = metrics?.returnOnEquity || 0;
      const roic = metrics?.returnOnInvestedCapital || 0;
      const divYield = finRatios?.dividendYield || 0;
      const payoutR = finRatios?.dividendPayoutRatio || 0;
      const fcfPerShare = finRatios?.freeCashFlowPerShare || 0;
      const revPerShare = finRatios?.revenuePerShare || 0;
      const niPerShare = finRatios?.netIncomePerShare || 0;

      await sql`
        INSERT INTO ratios (
          symbol, pe_ratio, pb_ratio, price_to_sales_ratio, debt_to_equity, current_ratio, roe, roic,
          dividend_yield, payout_ratio, free_cash_flow_per_share, revenue_per_share, net_income_per_share,
          earnings_yield, ev_to_sales, enterprise_value,
          -- Key Metrics fields
          ev_to_operating_cash_flow, ev_to_free_cash_flow, ev_to_ebitda, net_debt_to_ebitda,
          income_quality, graham_number, graham_net_net, tax_burden, interest_burden,
          working_capital, invested_capital, return_on_assets, operating_return_on_assets,
          return_on_tangible_assets, return_on_capital_employed, free_cash_flow_yield,
          capex_to_operating_cash_flow, capex_to_depreciation, capex_to_revenue,
          sga_to_revenue, rd_to_revenue, sbc_to_revenue, intangibles_to_total_assets,
          average_receivables, average_payables, average_inventory,
          days_sales_outstanding, days_payables_outstanding, days_inventory_outstanding,
          operating_cycle, cash_conversion_cycle, free_cash_flow_to_equity, free_cash_flow_to_firm,
          tangible_asset_value, net_current_asset_value,
          -- Ratios endpoint fields
          gross_profit_margin, ebit_margin, ebitda_margin, operating_profit_margin,
          pretax_profit_margin, continuous_operations_profit_margin, net_profit_margin, bottom_line_profit_margin,
          receivables_turnover, payables_turnover, inventory_turnover, fixed_asset_turnover, asset_turnover,
          quick_ratio, solvency_ratio, cash_ratio, peg_ratio, forward_peg_ratio,
          price_to_fcf_ratio, price_to_ocf_ratio, debt_to_assets_ratio,
          debt_to_capital_ratio, lt_debt_to_capital_ratio, financial_leverage_ratio,
          working_capital_turnover_ratio, operating_cash_flow_ratio, operating_cash_flow_sales_ratio,
          fcf_to_ocf_ratio, debt_service_coverage_ratio, interest_coverage_ratio,
          short_term_ocf_coverage_ratio, ocf_coverage_ratio, capex_coverage_ratio, div_capex_coverage_ratio,
          dividend_yield_percentage, interest_debt_per_share, cash_per_share,
          book_value_per_share, tangible_book_value_per_share, shareholders_equity_per_share,
          operating_cash_flow_per_share, capex_per_share,
          net_income_per_ebt, ebt_per_ebit, price_to_fair_value, debt_to_market_cap,
          effective_tax_rate, enterprise_value_multiple,
          updated_at
        ) VALUES (
          ${sym}, ${peRatio}, ${pbRatio}, ${priceToSales}, ${debtToEquity},
          ${metrics?.currentRatio || finRatios?.currentRatio || 0}, ${roe}, ${roic},
          ${divYield}, ${payoutR}, ${fcfPerShare}, ${revPerShare}, ${niPerShare},
          ${metrics?.earningsYield || 0}, ${metrics?.evToSales || 0}, ${metrics?.enterpriseValue || 0},
          -- Key Metrics values
          ${metrics?.evToOperatingCashFlow || 0}, ${metrics?.evToFreeCashFlow || 0},
          ${metrics?.evToEBITDA || 0}, ${metrics?.netDebtToEBITDA || 0},
          ${metrics?.incomeQuality || 0}, ${metrics?.grahamNumber || 0}, ${metrics?.grahamNetNet || 0},
          ${metrics?.taxBurden || 0}, ${metrics?.interestBurden || 0},
          ${metrics?.workingCapital || 0}, ${metrics?.investedCapital || 0},
          ${metrics?.returnOnAssets || 0}, ${metrics?.operatingReturnOnAssets || 0},
          ${metrics?.returnOnTangibleAssets || 0}, ${metrics?.returnOnCapitalEmployed || 0},
          ${metrics?.freeCashFlowYield || 0},
          ${metrics?.capexToOperatingCashFlow || 0}, ${metrics?.capexToDepreciation || 0}, ${metrics?.capexToRevenue || 0},
          ${metrics?.salesGeneralAndAdministrativeToRevenue || 0}, ${metrics?.researchAndDevelopementToRevenue || 0},
          ${metrics?.stockBasedCompensationToRevenue || 0}, ${metrics?.intangiblesToTotalAssets || 0},
          ${metrics?.averageReceivables || 0}, ${metrics?.averagePayables || 0}, ${metrics?.averageInventory || 0},
          ${metrics?.daysOfSalesOutstanding || 0}, ${metrics?.daysOfPayablesOutstanding || 0}, ${metrics?.daysOfInventoryOutstanding || 0},
          ${metrics?.operatingCycle || 0}, ${metrics?.cashConversionCycle || 0},
          ${metrics?.freeCashFlowToEquity || 0}, ${metrics?.freeCashFlowToFirm || 0},
          ${metrics?.tangibleAssetValue || 0}, ${metrics?.netCurrentAssetValue || 0},
          -- Ratios endpoint values
          ${finRatios?.grossProfitMargin || 0}, ${finRatios?.ebitMargin || 0},
          ${finRatios?.ebitdaMargin || 0}, ${finRatios?.operatingProfitMargin || 0},
          ${finRatios?.pretaxProfitMargin || 0}, ${finRatios?.continuousOperationsProfitMargin || 0},
          ${finRatios?.netProfitMargin || 0}, ${finRatios?.bottomLineProfitMargin || 0},
          ${finRatios?.receivablesTurnover || 0}, ${finRatios?.payablesTurnover || 0},
          ${finRatios?.inventoryTurnover || 0}, ${finRatios?.fixedAssetTurnover || 0}, ${finRatios?.assetTurnover || 0},
          ${finRatios?.quickRatio || 0}, ${finRatios?.solvencyRatio || 0}, ${finRatios?.cashRatio || 0},
          ${finRatios?.priceToEarningsGrowthRatio || 0}, ${finRatios?.forwardPriceToEarningsGrowthRatio || 0},
          ${finRatios?.priceToFreeCashFlowRatio || 0}, ${finRatios?.priceToOperatingCashFlowRatio || 0},
          ${finRatios?.debtToAssetsRatio || 0},
          ${finRatios?.debtToCapitalRatio || 0}, ${finRatios?.longTermDebtToCapitalRatio || 0},
          ${finRatios?.financialLeverageRatio || 0},
          ${finRatios?.workingCapitalTurnoverRatio || 0}, ${finRatios?.operatingCashFlowRatio || 0},
          ${finRatios?.operatingCashFlowSalesRatio || 0},
          ${finRatios?.freeCashFlowOperatingCashFlowRatio || 0}, ${finRatios?.debtServiceCoverageRatio || 0},
          ${finRatios?.interestCoverageRatio || 0},
          ${finRatios?.shortTermOperatingCashFlowCoverageRatio || 0}, ${finRatios?.operatingCashFlowCoverageRatio || 0},
          ${finRatios?.capitalExpenditureCoverageRatio || 0}, ${finRatios?.dividendPaidAndCapexCoverageRatio || 0},
          ${finRatios?.dividendYieldPercentage || 0}, ${finRatios?.interestDebtPerShare || 0}, ${finRatios?.cashPerShare || 0},
          ${finRatios?.bookValuePerShare || 0}, ${finRatios?.tangibleBookValuePerShare || 0},
          ${finRatios?.shareholdersEquityPerShare || 0},
          ${finRatios?.operatingCashFlowPerShare || 0}, ${finRatios?.capexPerShare || 0},
          ${finRatios?.netIncomePerEBT || 0}, ${finRatios?.ebtPerEbit || 0},
          ${finRatios?.priceToFairValue || 0}, ${finRatios?.debtToMarketCap || 0},
          ${finRatios?.effectiveTaxRate || 0}, ${finRatios?.enterpriseValueMultiple || 0},
          NOW()
        )
        ON CONFLICT (symbol) DO UPDATE SET
          pe_ratio = EXCLUDED.pe_ratio, pb_ratio = EXCLUDED.pb_ratio, price_to_sales_ratio = EXCLUDED.price_to_sales_ratio,
          debt_to_equity = EXCLUDED.debt_to_equity, current_ratio = EXCLUDED.current_ratio, roe = EXCLUDED.roe, roic = EXCLUDED.roic,
          dividend_yield = EXCLUDED.dividend_yield, payout_ratio = EXCLUDED.payout_ratio, free_cash_flow_per_share = EXCLUDED.free_cash_flow_per_share,
          revenue_per_share = EXCLUDED.revenue_per_share, net_income_per_share = EXCLUDED.net_income_per_share,
          earnings_yield = EXCLUDED.earnings_yield, ev_to_sales = EXCLUDED.ev_to_sales, enterprise_value = EXCLUDED.enterprise_value,
          ev_to_operating_cash_flow = EXCLUDED.ev_to_operating_cash_flow, ev_to_free_cash_flow = EXCLUDED.ev_to_free_cash_flow,
          ev_to_ebitda = EXCLUDED.ev_to_ebitda, net_debt_to_ebitda = EXCLUDED.net_debt_to_ebitda,
          income_quality = EXCLUDED.income_quality, graham_number = EXCLUDED.graham_number, graham_net_net = EXCLUDED.graham_net_net,
          tax_burden = EXCLUDED.tax_burden, interest_burden = EXCLUDED.interest_burden,
          working_capital = EXCLUDED.working_capital, invested_capital = EXCLUDED.invested_capital,
          return_on_assets = EXCLUDED.return_on_assets, operating_return_on_assets = EXCLUDED.operating_return_on_assets,
          return_on_tangible_assets = EXCLUDED.return_on_tangible_assets, return_on_capital_employed = EXCLUDED.return_on_capital_employed,
          free_cash_flow_yield = EXCLUDED.free_cash_flow_yield,
          capex_to_operating_cash_flow = EXCLUDED.capex_to_operating_cash_flow, capex_to_depreciation = EXCLUDED.capex_to_depreciation,
          capex_to_revenue = EXCLUDED.capex_to_revenue, sga_to_revenue = EXCLUDED.sga_to_revenue,
          rd_to_revenue = EXCLUDED.rd_to_revenue, sbc_to_revenue = EXCLUDED.sbc_to_revenue,
          intangibles_to_total_assets = EXCLUDED.intangibles_to_total_assets,
          average_receivables = EXCLUDED.average_receivables, average_payables = EXCLUDED.average_payables, average_inventory = EXCLUDED.average_inventory,
          days_sales_outstanding = EXCLUDED.days_sales_outstanding, days_payables_outstanding = EXCLUDED.days_payables_outstanding,
          days_inventory_outstanding = EXCLUDED.days_inventory_outstanding,
          operating_cycle = EXCLUDED.operating_cycle, cash_conversion_cycle = EXCLUDED.cash_conversion_cycle,
          free_cash_flow_to_equity = EXCLUDED.free_cash_flow_to_equity, free_cash_flow_to_firm = EXCLUDED.free_cash_flow_to_firm,
          tangible_asset_value = EXCLUDED.tangible_asset_value, net_current_asset_value = EXCLUDED.net_current_asset_value,
          gross_profit_margin = EXCLUDED.gross_profit_margin, ebit_margin = EXCLUDED.ebit_margin,
          ebitda_margin = EXCLUDED.ebitda_margin, operating_profit_margin = EXCLUDED.operating_profit_margin,
          pretax_profit_margin = EXCLUDED.pretax_profit_margin, continuous_operations_profit_margin = EXCLUDED.continuous_operations_profit_margin,
          net_profit_margin = EXCLUDED.net_profit_margin, bottom_line_profit_margin = EXCLUDED.bottom_line_profit_margin,
          receivables_turnover = EXCLUDED.receivables_turnover, payables_turnover = EXCLUDED.payables_turnover,
          inventory_turnover = EXCLUDED.inventory_turnover, fixed_asset_turnover = EXCLUDED.fixed_asset_turnover, asset_turnover = EXCLUDED.asset_turnover,
          quick_ratio = EXCLUDED.quick_ratio, solvency_ratio = EXCLUDED.solvency_ratio, cash_ratio = EXCLUDED.cash_ratio,
          peg_ratio = EXCLUDED.peg_ratio, forward_peg_ratio = EXCLUDED.forward_peg_ratio,
          price_to_fcf_ratio = EXCLUDED.price_to_fcf_ratio, price_to_ocf_ratio = EXCLUDED.price_to_ocf_ratio,
          debt_to_assets_ratio = EXCLUDED.debt_to_assets_ratio,
          debt_to_capital_ratio = EXCLUDED.debt_to_capital_ratio, lt_debt_to_capital_ratio = EXCLUDED.lt_debt_to_capital_ratio,
          financial_leverage_ratio = EXCLUDED.financial_leverage_ratio,
          working_capital_turnover_ratio = EXCLUDED.working_capital_turnover_ratio, operating_cash_flow_ratio = EXCLUDED.operating_cash_flow_ratio,
          operating_cash_flow_sales_ratio = EXCLUDED.operating_cash_flow_sales_ratio,
          fcf_to_ocf_ratio = EXCLUDED.fcf_to_ocf_ratio, debt_service_coverage_ratio = EXCLUDED.debt_service_coverage_ratio,
          interest_coverage_ratio = EXCLUDED.interest_coverage_ratio,
          short_term_ocf_coverage_ratio = EXCLUDED.short_term_ocf_coverage_ratio, ocf_coverage_ratio = EXCLUDED.ocf_coverage_ratio,
          capex_coverage_ratio = EXCLUDED.capex_coverage_ratio, div_capex_coverage_ratio = EXCLUDED.div_capex_coverage_ratio,
          dividend_yield_percentage = EXCLUDED.dividend_yield_percentage, interest_debt_per_share = EXCLUDED.interest_debt_per_share,
          cash_per_share = EXCLUDED.cash_per_share, book_value_per_share = EXCLUDED.book_value_per_share,
          tangible_book_value_per_share = EXCLUDED.tangible_book_value_per_share, shareholders_equity_per_share = EXCLUDED.shareholders_equity_per_share,
          operating_cash_flow_per_share = EXCLUDED.operating_cash_flow_per_share, capex_per_share = EXCLUDED.capex_per_share,
          net_income_per_ebt = EXCLUDED.net_income_per_ebt, ebt_per_ebit = EXCLUDED.ebt_per_ebit,
          price_to_fair_value = EXCLUDED.price_to_fair_value, debt_to_market_cap = EXCLUDED.debt_to_market_cap,
          effective_tax_rate = EXCLUDED.effective_tax_rate, enterprise_value_multiple = EXCLUDED.enterprise_value_multiple,
          updated_at = NOW()
      `;

      // Profiles table — derive growth stats
      // Quarterly: period is "Q1","Q2","Q3","Q4" in /stable/ API (NOT "Q")
      const sortedQ = [...quarterlyGrowth]
        .filter((g) => g.period.startsWith("Q"))
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      let revQ = 0;
      for (const g of sortedQ) { if (g.revenueGrowth > 0) revQ++; else break; }
      let niQ = 0;
      for (const g of sortedQ) { if (g.netIncomeGrowth > 0) niQ++; else break; }

      // Annual: dividend growth years + recent annual growth rate
      const sortedA = [...annualGrowth]
        .filter((g) => g.period === "FY")
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      let divYrs = 0;
      for (const g of sortedA) { if (g.dividendsperShareGrowth > 0) divYrs++; else break; }
      const recentAnnual = sortedA[0];

      await sql`
        INSERT INTO profiles (symbol, revenue_growth, net_income_growth, earnings_growth, revenue_growth_quarters, net_income_growth_quarters, dividend_growth_years, profit_margin, historical_returns, updated_at)
        VALUES (${sym}, ${recentAnnual?.revenueGrowth || 0}, ${recentAnnual?.netIncomeGrowth || 0}, ${recentAnnual?.netIncomeGrowth || 0}, ${revQ}, ${niQ}, ${divYrs}, ${income[0]?.netIncomeRatio || 0}, ${'{}'}, NOW())
        ON CONFLICT (symbol) DO UPDATE SET
          revenue_growth = EXCLUDED.revenue_growth, net_income_growth = EXCLUDED.net_income_growth,
          earnings_growth = EXCLUDED.earnings_growth, revenue_growth_quarters = EXCLUDED.revenue_growth_quarters,
          net_income_growth_quarters = EXCLUDED.net_income_growth_quarters, dividend_growth_years = EXCLUDED.dividend_growth_years,
          profit_margin = EXCLUDED.profit_margin, updated_at = NOW()
      `;

      enriched++;
      if (enriched % 25 === 0) console.log(`  Enriched ${enriched}/${topSymbols.length}...`);
    } catch (e) {
      failed++;
      console.error(`  Error enriching ${sym}:`, e instanceof Error ? e.message : e);
    }
  }

  console.log(`  Enriched ${enriched} stocks (${failed} failed)`);
}

// ---------------------------------------------------------------------------
// Step 3: Record metadata
// ---------------------------------------------------------------------------

async function recordMeta() {
  console.log("Step 3/3: Recording metadata...");
  const timestamp = new Date().toISOString();
  await sql`
    INSERT INTO stock_meta (key, value, updated_at)
    VALUES (${'last_populate'}, ${timestamp}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `;

  const countResult = await sql`SELECT count(*) as cnt FROM stocks`;
  const quotesResult = await sql`SELECT count(*) as cnt FROM quotes`;
  const ratiosResult = await sql`SELECT count(*) as cnt FROM ratios`;
  const profilesResult = await sql`SELECT count(*) as cnt FROM profiles`;

  console.log("\nPopulation complete:");
  console.log(`  stocks:   ${countResult[0].cnt}`);
  console.log(`  quotes:   ${quotesResult[0].cnt}`);
  console.log(`  ratios:   ${ratiosResult[0].cnt}`);
  console.log(`  profiles: ${profilesResult[0].cnt}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== Stock Database Population ===\n");
  const start = Date.now();

  await populateStocks();
  await enrichTopStocks();
  await recordMeta();

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsed}s`);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
