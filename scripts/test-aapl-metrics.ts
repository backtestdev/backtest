/**
 * Test script: Fetch AAPL data from FMP Key Metrics and Ratios endpoints
 * and verify that priceToEarningsRatio ≈ 37.29 and priceToBookRatio ≈ 61.37
 *
 * Usage:
 *   npx tsx scripts/test-aapl-metrics.ts
 *
 * Required env vars:
 *   FINANCIAL_MODELING_PREP_API_KEY or FMP_API_KEY
 */

const FMP_API_KEY =
  process.env.FINANCIAL_MODELING_PREP_API_KEY ||
  process.env.FMP_API_KEY ||
  "";
const FMP_BASE = "https://financialmodelingprep.com/stable";

if (!FMP_API_KEY) {
  console.error("ERROR: Set FINANCIAL_MODELING_PREP_API_KEY or FMP_API_KEY");
  process.exit(1);
}

async function fetchFMP<T>(endpoint: string): Promise<T | null> {
  const url = `${FMP_BASE}${endpoint}${endpoint.includes("?") ? "&" : "?"}apikey=${FMP_API_KEY}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) {
      console.error(`FMP ${res.status} for ${endpoint}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (e) {
    console.error(`Network error:`, e instanceof Error ? e.message : e);
    return null;
  }
}

async function main() {
  console.log("=== AAPL FMP API Verification ===\n");

  // Fetch Key Metrics
  console.log("Fetching /key-metrics for AAPL (annual, limit 1)...");
  const keyMetrics = await fetchFMP<Record<string, unknown>[]>(
    "/key-metrics?symbol=AAPL&period=annual&limit=1"
  );

  if (keyMetrics && keyMetrics[0]) {
    const km = keyMetrics[0];
    console.log("\n--- Key Metrics (selected fields) ---");
    console.log(`  returnOnEquity:                ${km.returnOnEquity}`);
    console.log(`  returnOnInvestedCapital:       ${km.returnOnInvestedCapital}`);
    console.log(`  returnOnAssets:                ${km.returnOnAssets}`);
    console.log(`  earningsYield:                 ${km.earningsYield}`);
    console.log(`  evToEBITDA:                    ${km.evToEBITDA}`);
    console.log(`  evToSales:                     ${km.evToSales}`);
    console.log(`  enterpriseValue:               ${km.enterpriseValue}`);
    console.log(`  currentRatio:                  ${km.currentRatio}`);
    console.log(`  grahamNumber:                  ${km.grahamNumber}`);
    console.log(`  freeCashFlowYield:             ${km.freeCashFlowYield}`);
    console.log(`  returnOnCapitalEmployed:       ${km.returnOnCapitalEmployed}`);
  } else {
    console.error("Failed to fetch key-metrics for AAPL");
  }

  // Fetch Ratios
  console.log("\nFetching /ratios for AAPL (annual, limit 1)...");
  const ratios = await fetchFMP<Record<string, unknown>[]>(
    "/ratios?symbol=AAPL&period=annual&limit=1"
  );

  if (ratios && ratios[0]) {
    const r = ratios[0];
    console.log("\n--- Ratios (selected fields) ---");
    console.log(`  priceToEarningsRatio:          ${r.priceToEarningsRatio}`);
    console.log(`  priceToBookRatio:              ${r.priceToBookRatio}`);
    console.log(`  priceToSalesRatio:             ${r.priceToSalesRatio}`);
    console.log(`  debtToEquityRatio:             ${r.debtToEquityRatio}`);
    console.log(`  dividendYield:                 ${r.dividendYield}`);
    console.log(`  dividendPayoutRatio:           ${r.dividendPayoutRatio}`);
    console.log(`  grossProfitMargin:             ${r.grossProfitMargin}`);
    console.log(`  netProfitMargin:               ${r.netProfitMargin}`);
    console.log(`  operatingProfitMargin:         ${r.operatingProfitMargin}`);
    console.log(`  freeCashFlowPerShare:          ${r.freeCashFlowPerShare}`);
    console.log(`  bookValuePerShare:             ${r.bookValuePerShare}`);
    console.log(`  interestCoverageRatio:         ${r.interestCoverageRatio}`);
    console.log(`  enterpriseValueMultiple:       ${r.enterpriseValueMultiple}`);
    console.log(`  pegRatio:                      ${r.priceToEarningsGrowthRatio}`);

    // Verification
    const pe = Number(r.priceToEarningsRatio);
    const pb = Number(r.priceToBookRatio);

    console.log("\n=== VERIFICATION ===");
    console.log(`  Expected PE ≈ 37.29,  Got: ${pe.toFixed(2)}`);
    console.log(`  Expected PB ≈ 61.37,  Got: ${pb.toFixed(2)}`);

    const pePassed = Math.abs(pe - 37.29) < 2;
    const pbPassed = Math.abs(pb - 61.37) < 5;

    console.log(`  PE check: ${pePassed ? "PASS" : "FAIL (outside tolerance)"}`);
    console.log(`  PB check: ${pbPassed ? "PASS" : "FAIL (outside tolerance)"}`);

    if (pePassed && pbPassed) {
      console.log("\n  All checks PASSED!");
    } else {
      console.log("\n  Some checks FAILED — values may have shifted since FY 2024.");
      console.log("  (Market data changes daily; slight deviation is expected.)");
    }
  } else {
    console.error("Failed to fetch ratios for AAPL");
  }
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
