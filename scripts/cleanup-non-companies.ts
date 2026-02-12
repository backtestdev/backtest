/**
 * One-time cleanup script: remove non-company entries from the stock database.
 *
 * Deletes mutual funds, indexes, ETFs, trusts, SPACs, preferred securities,
 * debt instruments, and other non-operating-company entries that slipped
 * through earlier population runs.
 *
 * Works with the unified single `stocks` table — no orphan cleanup needed.
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

const NAME_PATTERNS = [
  `\\y(ETF|ETN)\\y`,
  `Exchange.Traded`,
  `\\yFunds?\\y`,
  `\\y(Money Market)\\y`,
  `Closed.End`,
  `\\y(Acquisition Corp|Blank Check|SPAC|Special Purpose)\\y`,
  `\\y(Statutory Trust|Capital Trust|Investment Trust)\\y`,
  `Trust [IVX]+\\y`,
  `Depositary (Shares?|Receipt)`,
  `Preferred (Shares?|Stock|Securities)`,
  `\\d+\\.?\\d*% `,
  `Fixed.Income`,
  `\\yRights\\y$`,
  `\\yWarrants?\\y$`,
  `\\yUnits?$`,
  `\\ySenior Notes?\\y`,
  `Notes Due`,
  `\\ySubordinated\\y`,
  `\\yDebentures?\\y`,
  `L\\.P\\.?$`,
];

const COMBINED_PATTERN = NAME_PATTERNS.join("|");

async function main() {
  console.log("=== Non-Company Cleanup ===\n");

  // Count before
  const beforeCount = await sql`SELECT count(*) as cnt FROM stocks`;
  console.log(`Stocks before cleanup: ${beforeCount[0].cnt}`);

  // Report matches per category
  const etfRows = await sql`SELECT symbol, company_name FROM stocks WHERE is_etf = true ORDER BY symbol`;
  if (etfRows.length > 0) {
    console.log(`\n[ETF flag] ${etfRows.length} entries:`);
    for (const r of etfRows) console.log(`  ${r.symbol}  ${r.company_name}`);
  }

  const noSectorRows = await sql`SELECT symbol, company_name FROM stocks WHERE sector IS NULL OR TRIM(sector) = '' ORDER BY symbol`;
  if (noSectorRows.length > 0) {
    console.log(`\n[No sector] ${noSectorRows.length} entries:`);
    for (const r of noSectorRows) console.log(`  ${r.symbol}  ${r.company_name}`);
  }

  const fundRows = await sql`SELECT symbol, company_name FROM stocks WHERE is_fund = true ORDER BY symbol`;
  if (fundRows.length > 0) {
    console.log(`\n[Fund flag] ${fundRows.length} entries:`);
    for (const r of fundRows) console.log(`  ${r.symbol}  ${r.company_name}`);
  }

  const badSymbolRows = await sql`SELECT symbol, company_name FROM stocks WHERE symbol LIKE '%.%' OR LENGTH(symbol) > 5 ORDER BY symbol`;
  if (badSymbolRows.length > 0) {
    console.log(`\n[Bad symbol] ${badSymbolRows.length} entries:`);
    for (const r of badSymbolRows) console.log(`  ${r.symbol}  ${r.company_name}`);
  }

  const assetMgmtRows = await sql`SELECT symbol, company_name, sector, industry FROM stocks WHERE LENGTH(symbol) = 5 AND symbol LIKE '%X' AND (sector = 'Asset Management' OR industry = 'Asset Management') ORDER BY symbol`;
  if (assetMgmtRows.length > 0) {
    console.log(`\n[Asset Mgmt 5-letter X] ${assetMgmtRows.length} entries:`);
    for (const r of assetMgmtRows) console.log(`  ${r.symbol}  ${r.company_name}  (${r.sector}/${r.industry})`);
  }

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
       OR is_fund = true
       OR sector IS NULL OR TRIM(sector) = ''
       OR symbol LIKE '%.%'
       OR LENGTH(symbol) > 5
       OR company_name ~* ${COMBINED_PATTERN}
       OR (LENGTH(symbol) = 5 AND symbol LIKE '%X' AND (sector = 'Asset Management' OR industry = 'Asset Management'))
  `;
  const deleteCount = Number(toDelete[0].cnt);

  if (deleteCount === 0) {
    console.log("\nNo non-company entries found. Database is clean.");
    return;
  }

  console.log(`\n--- Deleting ${deleteCount} non-company entries ---`);

  // Delete from unified stocks table (no CASCADE needed)
  const deleted = await sql`
    DELETE FROM stocks
    WHERE is_etf = true
       OR is_fund = true
       OR sector IS NULL OR TRIM(sector) = ''
       OR symbol LIKE '%.%'
       OR LENGTH(symbol) > 5
       OR company_name ~* ${COMBINED_PATTERN}
       OR (LENGTH(symbol) = 5 AND symbol LIKE '%X' AND (sector = 'Asset Management' OR industry = 'Asset Management'))
    RETURNING symbol
  `;

  console.log(`Deleted ${deleted.length} stocks`);

  // Count after
  const afterCount = await sql`SELECT count(*) as cnt FROM stocks`;
  console.log(`\nStocks after cleanup: ${afterCount[0].cnt}`);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
