export interface StrategyParameters {
  description: string;
  filters: StockFilter[];
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  maxStocks?: number;
}

export interface StockFilter {
  metric: string;
  operator: ">" | "<" | ">=" | "<=" | "==" | "between";
  value: number;
  valueEnd?: number; // for "between" operator
}

export interface StructuredParameters {
  metrics: {
    name: string;
    operator: string;
    value: number;
    valueEnd?: number;
    period?: string;
  }[];
  market_cap: { min: number | null; max: number | null };
  sectors: { include: string[]; exclude: string[] };
  time_horizon: string;
}

export interface DebugInfo {
  appliedFilters: string[];
  matchedCount: number;
  sampleTickers: string[];
}

export interface BacktestResult {
  strategyName: string;
  description: string;
  matchedStocks: string[];
  matchedStockCount: number;
  timeHorizons: TimeHorizonResult[];
  chartData: ChartDataPoint[];
  runDate: string;
  parsedParams?: StructuredParameters;
  debugInfo?: DebugInfo;
}

export interface TimeHorizonResult {
  period: string; // "1yr", "5yr", "10yr", "20yr"
  strategyReturn: number; // percentage
  benchmarkReturn: number; // S&P 500 percentage
  outperforms: boolean;
}

export interface ChartDataPoint {
  date: string;
  strategy: number;
  benchmark: number;
}

export interface LeaderboardEntry {
  id: string;
  name: string;
  description: string;
  return1yr: number;
  return5yr: number;
  return10yr: number;
  return20yr: number;
  matchedStocks: number;
  createdAt: string;
  user_id?: string;
  parameters_json?: StructuredParameters;
  parameters_hash?: string;
}
