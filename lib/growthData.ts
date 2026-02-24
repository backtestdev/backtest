// Shared growth-data computation used by refresh-data and refresh-stocks routes

export interface IncomeStatementEntry {
  date: string;
  revenue: number;
  netIncome: number;
  eps: number;
  epsDiluted: number;
}

export interface GrowthData {
  revenueHistory: string | null;
  netIncomeHistory: string | null;
  epsHistory: string | null;
  consecutiveRevenueGrowthYears: number;
  consecutiveNetIncomeGrowthYears: number;
  consecutiveEpsGrowthYears: number;
  revenueGrowth3yrAvg: number | null;
  netIncomeGrowth3yrAvg: number | null;
  revenueGrowthYoy: number | null;
  earningsGrowthYoy: number | null;
  epsGrowthYoy: number | null;
  latestFiscalDate: string | null;
  revenueGrowthPositive3yrCount: number;
  netIncomeGrowthPositive3yrCount: number;
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function computeGrowthData(entries: IncomeStatementEntry[] | null): GrowthData | null {
  if (!entries || entries.length < 2) return null;

  const sorted = Array.from(entries).sort((a, b) => b.date.localeCompare(a.date));

  const latestFiscalDate = sorted[0]?.date ?? null;

  const revHist: Record<string, number> = {};
  const niHist: Record<string, number> = {};
  const epsHist: Record<string, number> = {};

  for (const e of sorted) {
    const year = e.date.substring(0, 4);
    if (e.revenue != null) revHist[year] = e.revenue;
    if (e.netIncome != null) niHist[year] = e.netIncome;
    const epsVal = e.epsDiluted ?? e.eps;
    if (epsVal != null) epsHist[year] = epsVal;
  }

  let consRevGrowth = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i].revenue > sorted[i + 1].revenue && sorted[i + 1].revenue > 0) consRevGrowth++;
    else break;
  }

  let consNiGrowth = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i].netIncome > sorted[i + 1].netIncome && sorted[i + 1].netIncome > 0) consNiGrowth++;
    else break;
  }

  let consEpsGrowth = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const curr = sorted[i].epsDiluted ?? sorted[i].eps;
    const prev = sorted[i + 1].epsDiluted ?? sorted[i + 1].eps;
    if (curr != null && prev != null && curr > prev && prev > 0) consEpsGrowth++;
    else break;
  }

  // Count how many of the last 3 YoY comparisons had positive growth
  let revGrowthPos3yr = 0;
  for (let i = 0; i < Math.min(3, sorted.length - 1); i++) {
    if (sorted[i].revenue > sorted[i + 1].revenue) revGrowthPos3yr++;
  }

  let niGrowthPos3yr = 0;
  for (let i = 0; i < Math.min(3, sorted.length - 1); i++) {
    if (sorted[i].netIncome > sorted[i + 1].netIncome) niGrowthPos3yr++;
  }

  function avgGrowth(getter: (e: IncomeStatementEntry) => number | null): number | null {
    const rates: number[] = [];
    for (let i = 0; i < Math.min(3, sorted.length - 1); i++) {
      const curr = getter(sorted[i]);
      const prev = getter(sorted[i + 1]);
      if (curr != null && prev != null && prev !== 0) {
        rates.push((curr - prev) / Math.abs(prev));
      }
    }
    return rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : null;
  }

  // YoY growth: most recent year vs prior year
  function yoyGrowth(curr: number | null, prev: number | null): number | null {
    if (curr == null || prev == null || prev === 0) return null;
    return (curr - prev) / Math.abs(prev);
  }

  const revYoy = sorted.length >= 2 ? yoyGrowth(sorted[0].revenue, sorted[1].revenue) : null;
  const niYoy = sorted.length >= 2 ? yoyGrowth(sorted[0].netIncome, sorted[1].netIncome) : null;
  const epsYoy = sorted.length >= 2
    ? yoyGrowth(sorted[0].epsDiluted ?? sorted[0].eps, sorted[1].epsDiluted ?? sorted[1].eps)
    : null;

  return {
    revenueHistory: Object.keys(revHist).length > 0 ? JSON.stringify(revHist) : null,
    netIncomeHistory: Object.keys(niHist).length > 0 ? JSON.stringify(niHist) : null,
    epsHistory: Object.keys(epsHist).length > 0 ? JSON.stringify(epsHist) : null,
    consecutiveRevenueGrowthYears: consRevGrowth,
    consecutiveNetIncomeGrowthYears: consNiGrowth,
    consecutiveEpsGrowthYears: consEpsGrowth,
    revenueGrowth3yrAvg: avgGrowth(e => toNum(e.revenue)),
    netIncomeGrowth3yrAvg: avgGrowth(e => toNum(e.netIncome)),
    revenueGrowthYoy: revYoy,
    earningsGrowthYoy: niYoy,
    epsGrowthYoy: epsYoy,
    latestFiscalDate,
    revenueGrowthPositive3yrCount: revGrowthPos3yr,
    netIncomeGrowthPositive3yrCount: niGrowthPos3yr,
  };
}
