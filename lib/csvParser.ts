/**
 * Multi-broker CSV/XLSX portfolio parser.
 *
 * Detects broker from header patterns, extracts holdings into a unified schema.
 * Supports: Fidelity, Schwab, E*TRADE, Merrill Edge, Vanguard, Robinhood,
 * Webull, Interactive Brokers, SoFi, and a generic fuzzy fallback.
 */

// ── Types ──

export interface ImportedHolding {
  symbol: string;
  name: string;
  quantity: number;
  currentValue: number;
  costBasis: number | null;
  averageCostPerShare: number | null;
  currentPrice: number | null;
  unrealizedGainLoss: number | null;
  unrealizedGainLossPct: number | null;
  accountName: string;
  accountType: "brokerage" | "401k" | "ira" | "roth" | "hsa" | "unknown";
  assetType: "stock" | "etf" | "mutual_fund" | "bond" | "crypto" | "cash" | "other";
  broker: string;
  sourceFile: string;
}

export interface ImportResult {
  holdings: ImportedHolding[];
  warnings: string[];
  summary: {
    totalHoldings: number;
    totalValue: number;
    accountsDetected: string[];
    brokersDetected: string[];
    skippedRows: number;
  };
}

// ── Constants ──

const BOND_ETFS = new Set([
  "AGG", "BND", "TLT", "IEF", "SHY", "VCIT", "LQD", "HYG", "JNK",
  "MUB", "VTEB", "BNDX", "EMB",
]);

const CRYPTO_SYMBOLS = new Set([
  "BTC", "ETH", "DOGE", "SOL", "ADA", "AVAX", "MATIC", "LTC", "XRP", "BCH",
]);

const CASH_SYMBOLS = new Set([
  "--", "SPAXX", "FCASH", "FDRXX", "CASH", "SWVXX", "VMFXX", "",
]);

// ── Helpers ──

function parseNumber(str: string | undefined | null): number | null {
  if (!str) return null;
  const s = str.trim();
  if (s === "" || s === "--" || s.toLowerCase() === "n/a") return null;
  // Handle parentheses for negative: (123.45) → -123.45
  const cleaned = s
    .replace(/[$%]/g, "")
    .replace(/\((.+)\)/, "-$1")
    .replace(/,/g, "")
    .trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function norm(h: string): string {
  return h.toLowerCase().trim();
}

function detectAssetType(
  symbol: string,
  securityType?: string
): "stock" | "etf" | "mutual_fund" | "bond" | "crypto" | "cash" | "other" {
  const sym = symbol.toUpperCase().trim();
  if (CASH_SYMBOLS.has(sym)) return "cash";
  if (CRYPTO_SYMBOLS.has(sym)) return "crypto";
  if (BOND_ETFS.has(sym)) return "bond";
  // Mutual funds: symbol ends in X and is >= 5 chars
  if (sym.length >= 5 && sym.endsWith("X")) return "mutual_fund";
  // Security type hints
  if (securityType) {
    const st = securityType.toLowerCase();
    if (st.includes("mutual") || st.includes("fund")) return "mutual_fund";
    if (st.includes("bond") || st.includes("fixed")) return "bond";
    if (st.includes("etf")) return "etf";
    if (st.includes("crypto")) return "crypto";
  }
  return "stock";
}

function detectAccountType(
  accountName: string
): "brokerage" | "401k" | "ira" | "roth" | "hsa" | "unknown" {
  const a = accountName.toLowerCase();
  if (a.includes("401k") || a.includes("401(k)")) return "401k";
  if (a.includes("roth") && a.includes("ira")) return "roth";
  if (a.includes("ira")) return "ira";
  if (a.includes("hsa")) return "hsa";
  if (a.includes("brokerage") || a.includes("individual") || a.includes("joint") || a.includes("tod"))
    return "brokerage";
  return "unknown";
}

// ── CSV Parser ──

export function parseCSVText(text: string): string[][] {
  const rows: string[][] = [];
  let current: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        current.push(field);
        field = "";
      } else if (ch === "\n" || (ch === "\r" && text[i + 1] === "\n")) {
        current.push(field);
        if (current.length > 1 || current[0].trim() !== "") {
          rows.push(current);
        }
        current = [];
        field = "";
        if (ch === "\r") i++;
      } else if (ch === "\r") {
        // Bare \r (old Mac format)
        current.push(field);
        if (current.length > 1 || current[0].trim() !== "") {
          rows.push(current);
        }
        current = [];
        field = "";
      } else {
        field += ch;
      }
    }
  }
  // Flush last row
  current.push(field);
  if (current.length > 1 || current[0].trim() !== "") {
    rows.push(current);
  }
  return rows;
}

// ── Broker detection ──

interface BrokerMatch {
  name: string;
  headerRowIndex: number;
  headers: string[];
  isTransactionHistory?: boolean;
  transactionWarning?: string;
}

const HEADER_KNOWN_WORDS = [
  "symbol", "ticker", "quantity", "shares", "price", "value",
  "cost", "description", "account", "gain", "loss", "market",
];

function scoreAsHeaderRow(row: string[]): number {
  let score = 0;
  for (const cell of row) {
    const c = norm(cell);
    for (const word of HEADER_KNOWN_WORDS) {
      if (c.includes(word)) { score++; break; }
    }
  }
  return score;
}

function detectBroker(rows: string[][]): BrokerMatch | null {
  // Find the best header row candidate
  let bestScore = 0;
  let bestIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const score = scoreAsHeaderRow(rows[i]);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  if (bestScore < 2 || bestIdx < 0) {
    // Check for IBKR multi-section format
    const ibkr = detectIBKR(rows);
    if (ibkr) return ibkr;
    return null;
  }

  const headers = rows[bestIdx].map((h) => h.trim());
  const normed = headers.map(norm);
  const joined = normed.join("|");

  // ── Fidelity ──
  if (
    (joined.includes("account name") || joined.includes("account number")) &&
    joined.includes("cost basis total")
  ) {
    return { name: "Fidelity", headerRowIndex: bestIdx, headers };
  }

  // ── Schwab ──
  if (joined.includes("reinvest dividends") || joined.includes("capital gains?")) {
    return { name: "Schwab", headerRowIndex: bestIdx, headers };
  }
  // Schwab alt: has "security type" and "% of account"
  if (joined.includes("security type") && joined.includes("% of account")) {
    return { name: "Schwab", headerRowIndex: bestIdx, headers };
  }

  // ── E*TRADE ──
  if (joined.includes("price paid") && (joined.includes("chg%") || joined.includes("day's gain") || joined.includes("total gain"))) {
    return { name: "E*TRADE", headerRowIndex: bestIdx, headers };
  }

  // ── Merrill Edge ──
  if (joined.includes("cusip")) {
    return { name: "Merrill Edge", headerRowIndex: bestIdx, headers };
  }

  // ── Vanguard ──
  if (joined.includes("investment name") && joined.includes("share price")) {
    return { name: "Vanguard", headerRowIndex: bestIdx, headers };
  }

  // ── SoFi ──
  if (joined.includes("average cost") && joined.includes("total return")) {
    return { name: "SoFi", headerRowIndex: bestIdx, headers };
  }

  // ── Robinhood (transaction history) ──
  if (joined.includes("trans code") && joined.includes("settle date")) {
    return {
      name: "Robinhood",
      headerRowIndex: bestIdx,
      headers,
      isTransactionHistory: true,
      transactionWarning:
        "This is a Robinhood transaction history export, not current positions. " +
        "For current holdings, use the Robinhood app's portfolio view or a Chrome extension that exports positions.",
    };
  }

  // ── Robinhood (positions via extension) ──
  if (normed.includes("code") && (joined.includes("equity") || joined.includes("equity ($)"))) {
    return { name: "Robinhood", headerRowIndex: bestIdx, headers };
  }

  // ── Webull (transaction history) ──
  if (joined.includes("reg fee") && joined.includes("order#")) {
    return {
      name: "Webull",
      headerRowIndex: bestIdx,
      headers,
      isTransactionHistory: true,
      transactionWarning:
        "This is a Webull transaction history export. For current positions, " +
        "use the Webull app's positions export instead.",
    };
  }

  // ── Webull (positions) ──
  if (joined.includes("ticker") && joined.includes("unrealized p&l")) {
    return { name: "Webull", headerRowIndex: bestIdx, headers };
  }

  // ── Generic fallback ──
  if (bestScore >= 2) {
    return { name: "Unknown", headerRowIndex: bestIdx, headers };
  }

  return null;
}

// IBKR has a unique multi-section format
function detectIBKR(rows: string[][]): BrokerMatch | null {
  for (let i = 0; i < rows.length; i++) {
    const firstCell = (rows[i][0] || "").trim();
    if (firstCell === "Open Positions" && norm(rows[i][1] || "") === "header") {
      // Next row after "Open Positions,Header,..." is the actual header row
      // The header values are in columns starting from index 2
      // Actually, IBKR format: the "Header" row IS the header
      return {
        name: "Interactive Brokers",
        headerRowIndex: i,
        headers: rows[i].map((h) => h.trim()),
      };
    }
  }
  return null;
}

// ── Column mapping ──

type FieldName =
  | "symbol" | "quantity" | "currentPrice" | "currentValue"
  | "costBasisTotal" | "avgCostPerShare" | "gainLoss" | "gainLossPct"
  | "description" | "accountName" | "securityType";

// Aliases for fuzzy matching (generic fallback)
const FIELD_ALIASES: Record<FieldName, string[]> = {
  symbol: ["symbol", "ticker", "code", "instrument"],
  quantity: ["quantity", "shares", "qty", "units", "qty #", "share"],
  currentPrice: ["last price", "price", "last", "current price", "close price", "share price", "price ($)"],
  currentValue: ["current value", "market value", "value", "value $", "equity", "equity ($)", "total value"],
  costBasisTotal: ["cost basis total", "cost basis", "total cost"],
  avgCostPerShare: ["average cost basis", "average cost", "avg cost", "price paid", "price paid $"],
  gainLoss: [
    "total gain/loss dollar", "gain/loss $", "total gain", "unrealized p&l",
    "gain/loss amount", "total return", "unrealized gain/loss",
  ],
  gainLossPct: [
    "total gain/loss percent", "gain/loss %", "total gain%", "unrealized p&l %",
    "total return %", "unrealized gain/loss %",
  ],
  description: ["description", "company name", "name", "investment name"],
  accountName: ["account name/number", "account name", "account", "account number"],
  securityType: ["type", "security type", "asset class"],
};

function buildColumnMap(headers: string[]): Map<FieldName, number> {
  const map = new Map<FieldName, number>();
  const normedHeaders = headers.map(norm);

  const fieldNames = Object.keys(FIELD_ALIASES) as FieldName[];
  for (const field of fieldNames) {
    const aliases = FIELD_ALIASES[field];
    for (const alias of aliases) {
      const idx = normedHeaders.indexOf(alias);
      if (idx !== -1 && !map.has(field)) {
        map.set(field, idx);
        break;
      }
    }
    // Fuzzy match: check if any header contains the alias
    if (!map.has(field)) {
      for (const alias of aliases) {
        const idx = normedHeaders.findIndex((h) => h.includes(alias));
        if (idx !== -1) {
          map.set(field, idx);
          break;
        }
      }
    }
  }
  return map;
}

function getField(row: string[], colMap: Map<FieldName, number>, field: FieldName): string | undefined {
  const idx = colMap.get(field);
  if (idx === undefined || idx >= row.length) return undefined;
  return row[idx]?.trim();
}

// ── Row extraction ──

function extractHolding(
  row: string[],
  colMap: Map<FieldName, number>,
  broker: string,
  sourceFile: string,
  defaultAccount: string
): ImportedHolding | null {
  const symbol = (getField(row, colMap, "symbol") || "").toUpperCase().trim();
  if (!symbol) return null;

  // Skip cash positions
  if (CASH_SYMBOLS.has(symbol)) return null;

  const quantity = parseNumber(getField(row, colMap, "quantity"));
  if (quantity === null || quantity === 0) return null;

  const currentPrice = parseNumber(getField(row, colMap, "currentPrice"));
  const currentValue = parseNumber(getField(row, colMap, "currentValue"));
  const costBasisTotal = parseNumber(getField(row, colMap, "costBasisTotal"));
  let avgCostPerShare = parseNumber(getField(row, colMap, "avgCostPerShare"));
  const gainLoss = parseNumber(getField(row, colMap, "gainLoss"));
  const gainLossPct = parseNumber(getField(row, colMap, "gainLossPct"));
  const description = getField(row, colMap, "description") || "";
  const accountName = getField(row, colMap, "accountName") || defaultAccount;
  const securityType = getField(row, colMap, "securityType");

  // Derive missing values
  const value = currentValue ?? (currentPrice && quantity ? currentPrice * quantity : 0);

  // If we have total cost basis but not per-share, derive it
  if (avgCostPerShare === null && costBasisTotal !== null && quantity > 0) {
    avgCostPerShare = Math.round((costBasisTotal / quantity) * 100) / 100;
  }

  // If we have per-share but not total, and it's used as total by some brokers
  // (Schwab "Cost Basis" is total, not per-share)
  let cbTotal = costBasisTotal;
  if (cbTotal === null && avgCostPerShare !== null && quantity > 0) {
    cbTotal = avgCostPerShare * quantity;
  }

  return {
    symbol,
    name: description,
    quantity,
    currentValue: value,
    costBasis: cbTotal,
    averageCostPerShare: avgCostPerShare,
    currentPrice,
    unrealizedGainLoss: gainLoss,
    unrealizedGainLossPct: gainLossPct !== null ? gainLossPct / 100 : null,
    accountName,
    accountType: detectAccountType(accountName),
    assetType: detectAssetType(symbol, securityType),
    broker,
    sourceFile,
  };
}

// ── Broker-specific adjustments ──

/**
 * Schwab's "Cost Basis" column is the TOTAL cost basis, not per-share.
 * We need to remap: costBasisTotal = "Cost Basis", avgCostPerShare = derived.
 */
function adjustSchwabColumns(colMap: Map<FieldName, number>, headers: string[]): void {
  const normed = headers.map(norm);
  // Schwab has "Cost Basis" = total. Remove avgCostPerShare mapping if it points to same column.
  const cbIdx = normed.indexOf("cost basis");
  if (cbIdx !== -1) {
    colMap.set("costBasisTotal", cbIdx);
    // If avgCostPerShare also points to the same index, remove it
    if (colMap.get("avgCostPerShare") === cbIdx) {
      colMap.delete("avgCostPerShare");
    }
  }
}

/**
 * For IBKR, skip rows where the 2nd column is "Header" or "Total" or "SubTotal".
 */
function isIBKRDataRow(row: string[]): boolean {
  const second = (row[1] || "").trim();
  return second !== "Header" && second !== "Total" && second !== "SubTotal" && second !== "";
}

// ── Main parser ──

export function parseCSVFile(csvText: string, sourceFile: string): ImportResult {
  const rows = parseCSVText(csvText);
  const warnings: string[] = [];
  let skippedRows = 0;

  if (rows.length === 0) {
    return {
      holdings: [],
      warnings: ["File is empty or could not be parsed."],
      summary: { totalHoldings: 0, totalValue: 0, accountsDetected: [], brokersDetected: [], skippedRows: 0 },
    };
  }

  const brokerMatch = detectBroker(rows);

  if (!brokerMatch) {
    return {
      holdings: [],
      warnings: ["Could not detect broker format or find a valid header row. Please check the file."],
      summary: { totalHoldings: 0, totalValue: 0, accountsDetected: [], brokersDetected: [], skippedRows: rows.length },
    };
  }

  // Transaction history warning
  if (brokerMatch.isTransactionHistory) {
    return {
      holdings: [],
      warnings: [brokerMatch.transactionWarning || "This appears to be a transaction history, not a positions export."],
      summary: { totalHoldings: 0, totalValue: 0, accountsDetected: [], brokersDetected: [brokerMatch.name], skippedRows: rows.length },
    };
  }

  const { name: broker, headerRowIndex, headers } = brokerMatch;
  const colMap = buildColumnMap(headers);

  // Broker-specific adjustments
  if (broker === "Schwab") {
    adjustSchwabColumns(colMap, headers);
  }

  // Must have at least symbol + quantity to proceed
  if (!colMap.has("symbol") || !colMap.has("quantity")) {
    // Try alternate column names for quantity
    const normed = headers.map(norm);
    if (!colMap.has("symbol")) {
      warnings.push(`Could not find a "Symbol" or "Ticker" column in ${sourceFile}.`);
    }
    if (!colMap.has("quantity")) {
      // Check for "shares" in any form
      const sharesIdx = normed.findIndex((h) => h === "shares" || h === "qty" || h === "quantity");
      if (sharesIdx !== -1) {
        colMap.set("quantity", sharesIdx);
      } else {
        warnings.push(`Could not find a "Quantity" or "Shares" column in ${sourceFile}.`);
      }
    }
  }

  if (!colMap.has("symbol")) {
    return {
      holdings: [],
      warnings,
      summary: { totalHoldings: 0, totalValue: 0, accountsDetected: [], brokersDetected: [broker], skippedRows: rows.length },
    };
  }

  // Detect default account name from metadata rows (Fidelity puts it in the first row)
  let defaultAccount = "";
  if (broker === "Fidelity" && headerRowIndex > 0) {
    // First row often has the account name
    const firstRowText = rows[0].join(" ").trim();
    if (firstRowText) defaultAccount = firstRowText;
  }

  if (broker === "Unknown") {
    warnings.push(
      "Unknown broker format detected. Some data may be incomplete — please verify the imported values."
    );
  }

  // Parse data rows
  const holdings: ImportedHolding[] = [];
  const startRow = headerRowIndex + 1;

  for (let i = startRow; i < rows.length; i++) {
    const row = rows[i];

    // IBKR: skip non-data rows and only parse Open Positions section
    if (broker === "Interactive Brokers") {
      if (!isIBKRDataRow(row)) continue;
      // Stop if we hit a new section
      const firstCell = (row[0] || "").trim();
      if (firstCell !== "" && firstCell !== "Open Positions") {
        // New section started, stop
        break;
      }
    }

    // Schwab: skip totals/summary rows
    if (broker === "Schwab") {
      const sym = (row[colMap.get("symbol") ?? 0] || "").trim();
      if (!sym || sym.toLowerCase().includes("cash") || sym.toLowerCase().includes("total")) {
        continue;
      }
    }

    // Fidelity: skip cash and totals
    if (broker === "Fidelity") {
      const sym = (row[colMap.get("symbol") ?? 0] || "").trim();
      if (sym === "--" || sym === "" || CASH_SYMBOLS.has(sym.toUpperCase())) {
        continue;
      }
      // Update default account if this row has account info
      const acct = getField(row, colMap, "accountName");
      if (acct && acct.trim()) defaultAccount = acct.trim();
    }

    const holding = extractHolding(row, colMap, broker, sourceFile, defaultAccount);
    if (holding) {
      holdings.push(holding);
    } else {
      skippedRows++;
    }
  }

  // Compute summary
  const accountsSet = new Set<string>();
  let totalValue = 0;
  for (const h of holdings) {
    if (h.accountName) accountsSet.add(h.accountName);
    totalValue += h.currentValue;
  }

  return {
    holdings,
    warnings,
    summary: {
      totalHoldings: holdings.length,
      totalValue,
      accountsDetected: Array.from(accountsSet),
      brokersDetected: [broker],
      skippedRows,
    },
  };
}
