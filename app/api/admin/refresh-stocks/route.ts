/**
 * Admin endpoint to refresh the stock database from FMP API.
 *
 * GET  /api/admin/refresh-stocks — Vercel Cron handler (rotates batches)
 * POST /api/admin/refresh-stocks — Manual trigger (enriches top 150)
 *
 * Vercel cron sends GET with Authorization: Bearer <CRON_SECRET>.
 * Each cron run: refreshes ALL screener data + enriches the NEXT batch
 * of 150 stocks. Tracks offset in stock_meta so over ~10 days every
 * stock gets fully enriched.
 *
 * FMP Starter plan: 300 req/min. We throttle to ~200 req/min.
 *
 * Budget per run (5-min Vercel timeout):
 *   1 screener call + 150 stocks × 6 calls × 300ms ≈ 4.5 min
 */

import { NextRequest, NextResponse } from "next/server";
import { neon, NeonQueryFunction } from "@neondatabase/serverless";
import { refreshStockUniverse } from "@/lib/fmpService";
import { ensureStockTables } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 minutes

const ENRICH_BATCH_SIZE = 150;

// No rate limit — manual POST uses the same rotating offset as cron
// so you can call it repeatedly to populate all stocks.

const FMP_API_KEY =
  process.env.FINANCIAL_MODELING_PREP_API_KEY ||
  process.env.FMP_API_KEY ||
  "";
const FMP_BASE = "https://financialmodelingprep.com/stable";

// ── Rate-limited FMP fetch ───────────────────────────────────────────

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

  const sep = endpoint.includes("?") ? "&" : "?";
  const url = `${FMP_BASE}${endpoint}${sep}apikey=${FMP_API_KEY}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (res.status === 429 && retries > 0) {
      console.warn(`[refresh] 429 on ${endpoint}, retry in 3s...`);
      await sleep(3000);
      return fetchFMP<T>(endpoint, retries - 1);
    }
    if (!res.ok) {
      console.error(`[refresh] FMP ${res.status} for ${endpoint}`);
      return null;
    }
    const data = await res.json();
    if (data && typeof data === "object" && "Error Message" in data) {
      console.error(`[refresh] FMP error for ${endpoint}:`, (data as Record<string, string>)["Error Message"]);
      return null;
    }
    return data as T;
  } catch (err) {
    console.error(`[refresh] FMP fetch failed for ${endpoint}:`, err);
    return null;
  }
}

// ── Types ──────────────────────────────────────────────────────────

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

// ── Shared refresh logic ───────────────────────────────────────────

async function runRefresh(
  sql: NeonQueryFunction<false, false>,
  enrichOffset: number
): Promise<{ stocks: number; enriched: number; enrichFailed: number; nextOffset: number }> {
  await ensureStockTables(sql);

  // Step 1: Screener — always refresh ALL stocks basic data
  const results = await fetchFMP<ScreenerResult[]>(
    "/company-screener?marketCapMoreThan=300000000&isEtf=false&isFund=false&isActivelyTrading=true&exchange=NYSE,NASDAQ&limit=3000"
  );
  if (!results || results.length === 0) {
    throw new Error("FMP screener returned no results — check API key and plan");
  }

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
  console.log(`[refresh] ${results.length} screener → ${filtered.length} common stocks`);

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

  // Step 2: Enrich a batch of stocks starting at enrichOffset
  const allRows = await sql`SELECT symbol FROM stocks ORDER BY market_cap DESC`;
  const allSymbols = allRows.map((r) => String(r.symbol));
  const totalStocks = allSymbols.length;

  // Wrap around if offset is past the end
  const safeOffset = enrichOffset >= totalStocks ? 0 : enrichOffset;
  const batch = allSymbols.slice(safeOffset, safeOffset + ENRICH_BATCH_SIZE);
  console.log(`[refresh] Enriching batch ${safeOffset}–${safeOffset + batch.length - 1} of ${totalStocks} (${batch.length} stocks)`);

  let enriched = 0;
  let enrichFailed = 0;

  for (const sym of batch) {
    try {
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
            price=EXCLUDED.price, changes_percentage=EXCLUDED.changes_percentage,
            day_low=EXCLUDED.day_low, day_high=EXCLUDED.day_high,
            year_high=EXCLUDED.year_high, year_low=EXCLUDED.year_low,
            market_cap=EXCLUDED.market_cap, price_avg_50=EXCLUDED.price_avg_50,
            price_avg_200=EXCLUDED.price_avg_200, volume=EXCLUDED.volume,
            avg_volume=EXCLUDED.avg_volume, eps=EXCLUDED.eps, pe=EXCLUDED.pe,
            shares_outstanding=EXCLUDED.shares_outstanding, updated_at=NOW()
        `;
      }

      // Ratios table — data from BOTH key-metrics and ratios endpoints
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
          pe_ratio=EXCLUDED.pe_ratio, pb_ratio=EXCLUDED.pb_ratio, price_to_sales_ratio=EXCLUDED.price_to_sales_ratio,
          debt_to_equity=EXCLUDED.debt_to_equity, current_ratio=EXCLUDED.current_ratio, roe=EXCLUDED.roe, roic=EXCLUDED.roic,
          dividend_yield=EXCLUDED.dividend_yield, payout_ratio=EXCLUDED.payout_ratio, free_cash_flow_per_share=EXCLUDED.free_cash_flow_per_share,
          revenue_per_share=EXCLUDED.revenue_per_share, net_income_per_share=EXCLUDED.net_income_per_share,
          earnings_yield=EXCLUDED.earnings_yield, ev_to_sales=EXCLUDED.ev_to_sales, enterprise_value=EXCLUDED.enterprise_value,
          ev_to_operating_cash_flow=EXCLUDED.ev_to_operating_cash_flow, ev_to_free_cash_flow=EXCLUDED.ev_to_free_cash_flow,
          ev_to_ebitda=EXCLUDED.ev_to_ebitda, net_debt_to_ebitda=EXCLUDED.net_debt_to_ebitda,
          income_quality=EXCLUDED.income_quality, graham_number=EXCLUDED.graham_number, graham_net_net=EXCLUDED.graham_net_net,
          tax_burden=EXCLUDED.tax_burden, interest_burden=EXCLUDED.interest_burden,
          working_capital=EXCLUDED.working_capital, invested_capital=EXCLUDED.invested_capital,
          return_on_assets=EXCLUDED.return_on_assets, operating_return_on_assets=EXCLUDED.operating_return_on_assets,
          return_on_tangible_assets=EXCLUDED.return_on_tangible_assets, return_on_capital_employed=EXCLUDED.return_on_capital_employed,
          free_cash_flow_yield=EXCLUDED.free_cash_flow_yield,
          capex_to_operating_cash_flow=EXCLUDED.capex_to_operating_cash_flow, capex_to_depreciation=EXCLUDED.capex_to_depreciation,
          capex_to_revenue=EXCLUDED.capex_to_revenue, sga_to_revenue=EXCLUDED.sga_to_revenue,
          rd_to_revenue=EXCLUDED.rd_to_revenue, sbc_to_revenue=EXCLUDED.sbc_to_revenue,
          intangibles_to_total_assets=EXCLUDED.intangibles_to_total_assets,
          average_receivables=EXCLUDED.average_receivables, average_payables=EXCLUDED.average_payables, average_inventory=EXCLUDED.average_inventory,
          days_sales_outstanding=EXCLUDED.days_sales_outstanding, days_payables_outstanding=EXCLUDED.days_payables_outstanding,
          days_inventory_outstanding=EXCLUDED.days_inventory_outstanding,
          operating_cycle=EXCLUDED.operating_cycle, cash_conversion_cycle=EXCLUDED.cash_conversion_cycle,
          free_cash_flow_to_equity=EXCLUDED.free_cash_flow_to_equity, free_cash_flow_to_firm=EXCLUDED.free_cash_flow_to_firm,
          tangible_asset_value=EXCLUDED.tangible_asset_value, net_current_asset_value=EXCLUDED.net_current_asset_value,
          gross_profit_margin=EXCLUDED.gross_profit_margin, ebit_margin=EXCLUDED.ebit_margin,
          ebitda_margin=EXCLUDED.ebitda_margin, operating_profit_margin=EXCLUDED.operating_profit_margin,
          pretax_profit_margin=EXCLUDED.pretax_profit_margin, continuous_operations_profit_margin=EXCLUDED.continuous_operations_profit_margin,
          net_profit_margin=EXCLUDED.net_profit_margin, bottom_line_profit_margin=EXCLUDED.bottom_line_profit_margin,
          receivables_turnover=EXCLUDED.receivables_turnover, payables_turnover=EXCLUDED.payables_turnover,
          inventory_turnover=EXCLUDED.inventory_turnover, fixed_asset_turnover=EXCLUDED.fixed_asset_turnover, asset_turnover=EXCLUDED.asset_turnover,
          quick_ratio=EXCLUDED.quick_ratio, solvency_ratio=EXCLUDED.solvency_ratio, cash_ratio=EXCLUDED.cash_ratio,
          peg_ratio=EXCLUDED.peg_ratio, forward_peg_ratio=EXCLUDED.forward_peg_ratio,
          price_to_fcf_ratio=EXCLUDED.price_to_fcf_ratio, price_to_ocf_ratio=EXCLUDED.price_to_ocf_ratio,
          debt_to_assets_ratio=EXCLUDED.debt_to_assets_ratio,
          debt_to_capital_ratio=EXCLUDED.debt_to_capital_ratio, lt_debt_to_capital_ratio=EXCLUDED.lt_debt_to_capital_ratio,
          financial_leverage_ratio=EXCLUDED.financial_leverage_ratio,
          working_capital_turnover_ratio=EXCLUDED.working_capital_turnover_ratio, operating_cash_flow_ratio=EXCLUDED.operating_cash_flow_ratio,
          operating_cash_flow_sales_ratio=EXCLUDED.operating_cash_flow_sales_ratio,
          fcf_to_ocf_ratio=EXCLUDED.fcf_to_ocf_ratio, debt_service_coverage_ratio=EXCLUDED.debt_service_coverage_ratio,
          interest_coverage_ratio=EXCLUDED.interest_coverage_ratio,
          short_term_ocf_coverage_ratio=EXCLUDED.short_term_ocf_coverage_ratio, ocf_coverage_ratio=EXCLUDED.ocf_coverage_ratio,
          capex_coverage_ratio=EXCLUDED.capex_coverage_ratio, div_capex_coverage_ratio=EXCLUDED.div_capex_coverage_ratio,
          dividend_yield_percentage=EXCLUDED.dividend_yield_percentage, interest_debt_per_share=EXCLUDED.interest_debt_per_share,
          cash_per_share=EXCLUDED.cash_per_share, book_value_per_share=EXCLUDED.book_value_per_share,
          tangible_book_value_per_share=EXCLUDED.tangible_book_value_per_share, shareholders_equity_per_share=EXCLUDED.shareholders_equity_per_share,
          operating_cash_flow_per_share=EXCLUDED.operating_cash_flow_per_share, capex_per_share=EXCLUDED.capex_per_share,
          net_income_per_ebt=EXCLUDED.net_income_per_ebt, ebt_per_ebit=EXCLUDED.ebt_per_ebit,
          price_to_fair_value=EXCLUDED.price_to_fair_value, debt_to_market_cap=EXCLUDED.debt_to_market_cap,
          effective_tax_rate=EXCLUDED.effective_tax_rate, enterprise_value_multiple=EXCLUDED.enterprise_value_multiple,
          updated_at=NOW()
      `;

      // Profiles table — derive growth stats
      const sortedQ = [...quarterlyGrowth]
        .filter((g) => g.period.startsWith("Q"))
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      let revQ = 0;
      for (const g of sortedQ) { if (g.revenueGrowth > 0) revQ++; else break; }
      let niQ = 0;
      for (const g of sortedQ) { if (g.netIncomeGrowth > 0) niQ++; else break; }

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
          revenue_growth=EXCLUDED.revenue_growth, net_income_growth=EXCLUDED.net_income_growth,
          earnings_growth=EXCLUDED.earnings_growth, revenue_growth_quarters=EXCLUDED.revenue_growth_quarters,
          net_income_growth_quarters=EXCLUDED.net_income_growth_quarters, dividend_growth_years=EXCLUDED.dividend_growth_years,
          profit_margin=EXCLUDED.profit_margin, updated_at=NOW()
      `;

      enriched++;
    } catch {
      enrichFailed++;
    }
  }

  // Calculate next offset (wrap around)
  const nextOffset = safeOffset + ENRICH_BATCH_SIZE >= totalStocks ? 0 : safeOffset + ENRICH_BATCH_SIZE;

  // Save next offset + timestamp
  const timestamp = new Date().toISOString();
  await sql`
    INSERT INTO stock_meta (key, value, updated_at)
    VALUES (${'last_populate'}, ${timestamp}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `;
  await sql`
    INSERT INTO stock_meta (key, value, updated_at)
    VALUES (${'enrich_offset'}, ${String(nextOffset)}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `;

  // Cleanup: remove non-company entries that slipped through earlier imports.
  // Uses PostgreSQL POSIX regex (~*) for case-insensitive matching.
  // CASCADE foreign keys auto-delete quotes/ratios/profiles rows.
  const NON_COMPANY_PATTERN = [
    '\\y(ETF|ETN)\\y',
    'Exchange.Traded',
    '\\y(Index Fund|Mutual Fund|Bond Fund|Income Fund|Money Market)\\y',
    'Closed.End',
    '\\y(Acquisition Corp|Blank Check|SPAC|Special Purpose)\\y',
    '\\y(Statutory Trust|Capital Trust|Investment Trust)\\y',
    'Trust [IVX]+\\y',
    'Depositary (Shares?|Receipt)',
    'Preferred (Shares?|Stock|Securities)',
    '\\d+\\.?\\d*% ',
    'Fixed.Income',
    '\\yRights$',
    '\\yWarrants?$',
  ].join('|');

  const purged = await sql`
    DELETE FROM stocks
    WHERE is_etf = true
       OR sector IS NULL OR TRIM(sector) = ''
       OR symbol LIKE '%.%'
       OR LENGTH(symbol) > 5
       OR company_name ~* ${NON_COMPANY_PATTERN}
    RETURNING symbol
  `;
  if (purged.length > 0) {
    console.log(`[refresh] Purged ${purged.length} non-company entries`);
  }

  // Remove stale stocks not refreshed by screener in the last 7 days.
  await sql`DELETE FROM stocks WHERE updated_at < NOW() - INTERVAL '7 days'`;

  // Remove orphaned enrichment rows (symbol exists in child but not parent)
  await sql`DELETE FROM quotes   WHERE symbol NOT IN (SELECT symbol FROM stocks)`;
  await sql`DELETE FROM ratios   WHERE symbol NOT IN (SELECT symbol FROM stocks)`;
  await sql`DELETE FROM profiles WHERE symbol NOT IN (SELECT symbol FROM stocks)`;

  await refreshStockUniverse();

  return { stocks: filtered.length, enriched, enrichFailed, nextOffset };
}

// ── GET: Vercel Cron handler + status ──────────────────────────────

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  const isCron = cronSecret && authHeader === `Bearer ${cronSecret}`;

  if (!isCron) {
    // Not a cron request — return status
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      return NextResponse.json({ configured: false, message: "DATABASE_URL not set" });
    }
    try {
      const sql = neon(databaseUrl);
      const meta = await sql`SELECT * FROM stock_meta WHERE key IN ('last_populate', 'enrich_offset')`;
      const stockCount = await sql`SELECT count(*) as cnt FROM stocks`;
      const lastPopulate = meta.find((r) => r.key === "last_populate")?.value || null;
      const enrichOffset = meta.find((r) => r.key === "enrich_offset")?.value || "0";
      return NextResponse.json({
        configured: true,
        lastPopulate,
        enrichOffset: Number(enrichOffset),
        stockCount: Number(stockCount[0]?.cnt || 0),
      });
    } catch {
      return NextResponse.json({ configured: true, error: "Could not query stock_meta — run POST /api/db/init first" });
    }
  }

  // Cron request — run refresh with rotating batch
  if (!FMP_API_KEY) {
    return NextResponse.json({ error: "FMP API key not configured" }, { status: 400 });
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 400 });
  }

  const sql = neon(databaseUrl);

  try {
    // Read current offset from DB (persists across invocations)
    await ensureStockTables(sql);
    let offset = 0;
    try {
      const offsetRow = await sql`SELECT value FROM stock_meta WHERE key = 'enrich_offset'`;
      if (offsetRow[0]?.value) offset = parseInt(offsetRow[0].value as string, 10) || 0;
    } catch { /* first run, start at 0 */ }

    console.log(`[cron] Starting refresh, enrich offset: ${offset}`);
    const result = await runRefresh(sql, offset);

    return NextResponse.json({
      success: true,
      ...result,
      message: `Enriched batch ${offset}–${offset + result.enriched - 1}, next batch starts at ${result.nextOffset}`,
    });
  } catch (error) {
    console.error("Cron refresh error:", error);
    return NextResponse.json({ error: "Refresh failed", details: String(error) }, { status: 500 });
  }
}

// ── POST: Manual trigger ───────────────────────────────────────────

export async function POST(request: NextRequest) {
  const adminSecret = process.env.ADMIN_SECRET;
  const adminHeader = request.headers.get("x-admin-secret");
  const isAdmin = adminSecret ? adminHeader === adminSecret : true;

  if (!isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!FMP_API_KEY) {
    return NextResponse.json({ error: "FMP API key not configured" }, { status: 400 });
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 400 });
  }

  const sql = neon(databaseUrl);

  try {
    // Read rotating offset from DB (same mechanism as cron)
    await ensureStockTables(sql);
    let offset = 0;
    try {
      const offsetRow = await sql`SELECT value FROM stock_meta WHERE key = 'enrich_offset'`;
      if (offsetRow[0]?.value) offset = parseInt(offsetRow[0].value as string, 10) || 0;
    } catch { /* first run */ }

    const result = await runRefresh(sql, offset);
    return NextResponse.json({
      success: true,
      ...result,
      message: `Enriched batch ${offset}–${offset + result.enriched - 1}, next batch starts at ${result.nextOffset}`,
    });
  } catch (error) {
    console.error("Refresh error:", error);
    return NextResponse.json({ error: "Refresh failed", details: String(error) }, { status: 500 });
  }
}
