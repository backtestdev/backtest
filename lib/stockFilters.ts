/**
 * Shared PostgreSQL POSIX regex pattern for non-company entries.
 * Used by both the cleanup endpoint and query-time filters (screener, signals).
 *
 * Matches: ETFs, funds, SPACs, trusts, preferred shares, bonds/notes,
 * warrants/rights/units, LPs, finance subsidiaries with debt issuances,
 * and entries with percentage rates in the name (bond coupons).
 */
export const NON_COMPANY_PATTERN = [
  // Funds & ETFs
  '\\y(ETF|ETN)\\y',
  'Exchange.Traded',
  '\\yFunds?\\y',
  '\\y(Money Market)\\y',
  'Closed.End',
  // SPACs & blank checks
  '\\y(Acquisition Corp|Blank Check|SPAC|Special Purpose)\\y',
  // Trusts
  '\\y(Statutory Trust|Capital Trust|Investment Trust)\\y',
  'Trust [IVX]+\\y',
  // Depositary / preferred
  'Depositary (Shares?|Receipt)',
  'Preferred (Shares?|Stock|Securities)',
  // Debt instruments — percentage rates in name (bond coupons like "4.625%")
  '\\d+\\.?\\d*%',
  'Fixed.Income',
  '\\ySenior Notes?\\y',
  'Notes Due',
  '\\ySubordinated\\y',
  '\\yDebentures?\\y',
  // Rights / warrants / units
  '\\yRights$',
  '\\yWarrants?$',
  '\\yUnits?$',
  // Limited partnerships
  'L\\.P\\.?$',
  // Finance subsidiaries (issue debt on behalf of parent — not operating companies)
  '\\yFinance (Co\\b|Inc\\b|LLC\\b)',
  '\\yFunding (Co\\b|Inc\\b|LLC\\b)',
].join('|');
