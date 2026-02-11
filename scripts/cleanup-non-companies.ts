/**
 * One-time cleanup script: remove non-company entries from the stock database.
 *
 * Deletes mutual funds, indexes, ETFs, trusts, SPACs, preferred securities,
 * debt instruments, and other non-operating-company entries that slipped
 * through earlier population runs.
 *
 * CASCADE foreign keys on quotes/ratios/profiles mean child rows are
 * automatically deleted when a stock row is removed.
 *
 * Usage:
 *   npx tsx scripts/cleanup-non-companies.ts
 *
 * Required env var:
 *   DATABASE_URL — Neon PostgreSQL connection string
 */

import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL || "";
if (!DATABASE_URL) {
  console.error("ERROR: Set DATABASE_URL");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

// ---------------------------------------------------------------------------
// Non-company name patterns (PostgreSQL POSIX regex, case-insensitive)
// ---------------------------------------------------------------------------

// These match company_name values that are clearly NOT operating companies.
// Uses \y for word boundaries (PostgreSQL POSIX syntax).
const NAME_PATTERNS = [
  // ETFs, ETNs, exchange-traded products
  `\\y(ETF|ETN)\\y`,
  `Exchange.Traded`,
  // Funds
  `\\y(Index Fund|Mutual Fund|Bond Fund|Income Fund|Money Market)\\y`,
  `Closed.End`,
  // SPACs & shell companies
  `\\y(Acquisition Corp|Blank Check|SPAC|Special Purpose)\\y`,
  // Trust securities (statutory trusts, capital trusts — NOT operating companies like "Northern Trust")
  `\\y(Statutory Trust|Capital Trust|Investment Trust)\\y`,
  `Trust [IVX]+\\y`,           // "Trust I", "Trust II", "Trust III", etc.
  // Depositary instruments
  `Depositary (Shares?|Receipt)`,
  // Preferred / debt securities
  `Preferred (Shares?|Stock|Securities)`,
  `\\d+\\.?\\d*% `,             // "6.50% Trust..." or "5.75% Notes..." — debt instruments
  `Fixed.Income`,
  // Rights, warrants (these aren't common stocks)
  `\\yRights\\y$`,              // ends with "Rights"
  `\\yWarrants?\\y$`,           // ends with "Warrant" or "Warrants"
];

// Combine into one regex with OR
const COMBINED_PATTERN = NAME_PATTERNS.join("|");

async function main() {
  console.log("=== Non-Company Cleanup ===\n");

  // Count before
  const beforeCount = await sql`SELECT count(*) as cnt FROM stocks`;
  console.log(`Stocks before cleanup: ${beforeCount[0].cnt}`);

  // 1. Find and report entries flagged as ETF
  const etfRows = await sql`SELECT symbol, company_name FROM stocks WHERE is_etf = true ORDER BY symbol`;
  if (etfRows.length > 0) {
    console.log(`\n[ETF flag] ${etfRows.length} entries:`);
    for (const r of etfRows) console.log(`  ${r.symbol}  ${r.company_name}`);
  }

  // 2. Find and report entries with empty/null sector
  const noSectorRows = await sql`SELECT symbol, company_name FROM stocks WHERE sector IS NULL OR TRIM(sector) = '' ORDER BY symbol`;
  if (noSectorRows.length > 0) {
    console.log(`\n[No sector] ${noSectorRows.length} entries:`);
    for (const r of noSectorRows) console.log(`  ${r.symbol}  ${r.company_name}`);
  }

  // 3. Find and report entries with dot in symbol or symbol > 5 chars
  const badSymbolRows = await sql`SELECT symbol, company_name FROM stocks WHERE symbol LIKE '%.%' OR LENGTH(symbol) > 5 ORDER BY symbol`;
  if (badSymbolRows.length > 0) {
    console.log(`\n[Bad symbol] ${badSymbolRows.length} entries:`);
    for (const r of badSymbolRows) console.log(`  ${r.symbol}  ${r.company_name}`);
  }

  // 4. Find and report entries matching non-company name patterns
  const nameRows = await sql`
    SELECT symbol, company_name FROM stocks
    WHERE company_name ~* ${COMBINED_PATTERN}
    ORDER BY symbol
  `;
  if (nameRows.length > 0) {
    console.log(`\n[Name pattern] ${nameRows.length} entries:`);
    for (const r of nameRows) console.log(`  ${r.symbol}  ${r.company_name}`);
  }

  // Total unique symbols to delete
  const toDelete = await sql`
    SELECT count(*) as cnt FROM stocks
    WHERE is_etf = true
       OR sector IS NULL OR TRIM(sector) = ''
       OR symbol LIKE '%.%'
       OR LENGTH(symbol) > 5
       OR company_name ~* ${COMBINED_PATTERN}
  `;
  const deleteCount = Number(toDelete[0].cnt);

  if (deleteCount === 0) {
    console.log("\nNo non-company entries found. Database is clean.");
    return;
  }

  console.log(`\n--- Deleting ${deleteCount} non-company entries ---`);

  // Delete (CASCADE handles child tables)
  const deleted = await sql`
    DELETE FROM stocks
    WHERE is_etf = true
       OR sector IS NULL OR TRIM(sector) = ''
       OR symbol LIKE '%.%'
       OR LENGTH(symbol) > 5
       OR company_name ~* ${COMBINED_PATTERN}
    RETURNING symbol
  `;

  console.log(`Deleted ${deleted.length} stocks (+ cascaded quotes/ratios/profiles)`);

  // Clean up any orphaned child rows just in case
  const orphanQ = await sql`DELETE FROM quotes   WHERE symbol NOT IN (SELECT symbol FROM stocks) RETURNING symbol`;
  const orphanR = await sql`DELETE FROM ratios   WHERE symbol NOT IN (SELECT symbol FROM stocks) RETURNING symbol`;
  const orphanP = await sql`DELETE FROM profiles WHERE symbol NOT IN (SELECT symbol FROM stocks) RETURNING symbol`;
  if (orphanQ.length + orphanR.length + orphanP.length > 0) {
    console.log(`Cleaned up orphans: ${orphanQ.length} quotes, ${orphanR.length} ratios, ${orphanP.length} profiles`);
  }

  // Count after
  const afterCount = await sql`SELECT count(*) as cnt FROM stocks`;
  console.log(`\nStocks after cleanup: ${afterCount[0].cnt}`);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
