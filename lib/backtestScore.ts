// Shared multi-factor scoring model used by screener and signal tracker

export const SCORE_FACTORS: { column: string; weight: number; capLow: number; capHigh: number }[] = [
  // Earnings relative to price — strongest signal (higher is better)
  { column: "earnings_yield", weight: 20, capLow: -0.1, capHigh: 0.3 },
  // Earnings growth — capped tight to prevent turnaround distortion (higher is better)
  { column: "earnings_growth", weight: 10, capLow: -0.5, capHigh: 0.5 },
  // Earnings consistency — years of consecutive net income growth (higher is better)
  { column: "consecutive_earnings_growth", weight: 15, capLow: 0, capHigh: 10 },
  // Value (lower is better)
  { column: "pe_ratio", weight: -10, capLow: 0, capHigh: 60 },
  { column: "ev_to_ebitda", weight: -5, capLow: 0, capHigh: 40 },
  // Quality (higher is better)
  { column: "roe", weight: 10, capLow: -0.5, capHigh: 1.0 },
  { column: "profit_margin", weight: 10, capLow: -0.5, capHigh: 0.5 },
  { column: "roic", weight: 5, capLow: -0.3, capHigh: 0.5 },
  // Growth
  { column: "revenue_growth", weight: 5, capLow: -0.5, capHigh: 2.0 },
  // Cash flow (higher is better)
  { column: "free_cash_flow_yield", weight: 5, capLow: -0.2, capHigh: 0.3 },
  // Leverage (lower debt is better)
  { column: "debt_to_equity", weight: -5, capLow: 0, capHigh: 5 },
  // Beta — higher beta stocks show stronger raw returns in signal explorer data.
  // Strongest spread factor; weight aligns with empirical quintile results.
  { column: "beta", weight: 8, capLow: 0, capHigh: 3 },
  // Size confidence — log(market cap in $B). Soft gradient within percentile
  // ranking; the heavier size adjustment is the multiplicative dampener below.
  { column: "log_market_cap", weight: 4, capLow: -0.5, capHigh: 3.0 },
  // Revenue consistency — how many of last 3 years had positive revenue growth (0-3)
  { column: "revenue_growth_positive_3yr_count", weight: 8, capLow: 0, capHigh: 3 },
];

export function computeBacktestScore(stocks: Record<string, unknown>[]): Map<string, number> {
  const scores = new Map<string, number>();

  for (const factor of SCORE_FACTORS) {
    const values: { symbol: string; value: number }[] = [];
    for (const stock of stocks) {
      const val = Number(stock[factor.column]);
      if (isNaN(val) || !isFinite(val) || stock[factor.column] === null) continue;
      // Exclude negative P/E (unprofitable) — would distort percentile ranking
      if (factor.column === "pe_ratio" && val <= 0) continue;
      const capped = Math.max(factor.capLow, Math.min(factor.capHigh, val));
      values.push({ symbol: stock.symbol as string, value: capped });
    }

    if (values.length < 10) continue;

    // Tiebreaker on symbol ensures deterministic percentile assignment
    // when two stocks share the same metric value (prevents score flapping).
    values.sort((a, b) => a.value - b.value || a.symbol.localeCompare(b.symbol));
    for (let i = 0; i < values.length; i++) {
      const percentile = i / (values.length - 1);
      const contribution = factor.weight > 0
        ? percentile * Math.abs(factor.weight)
        : (1 - percentile) * Math.abs(factor.weight);

      const prev = scores.get(values[i].symbol) || 0;
      scores.set(values[i].symbol, prev + contribution);
    }
  }

  // Size-confidence dampener: multiply raw scores before normalization so
  // small-cap stocks are pushed down proportionally but the 1-100 range stays
  // intact after min-max rescaling.
  const mcapLookup = new Map<string, number>();
  for (const stock of stocks) {
    mcapLookup.set(stock.symbol as string, Number(stock.market_cap || 0) / 1_000_000_000);
  }
  scores.forEach((raw, symbol) => {
    const mcapB = mcapLookup.get(symbol) || 0;
    const confidence = mcapB > 0 ? Math.min(1.0, 0.70 + 0.10 * Math.log10(mcapB)) : 0.50;
    scores.set(symbol, raw * confidence);
  });

  // Normalize to 1-100
  const rawScores = Array.from(scores.entries());
  if (rawScores.length === 0) return scores;

  const maxRaw = Math.max(...rawScores.map(([, v]) => v));
  const minRaw = Math.min(...rawScores.map(([, v]) => v));
  const range = maxRaw - minRaw || 1;

  for (const [symbol, raw] of rawScores) {
    scores.set(symbol, Math.round(((raw - minRaw) / range) * 99) + 1);
  }

  return scores;
}
