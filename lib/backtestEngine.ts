import { BacktestResult, StrategyParameters } from "./types";
import { filterStocks, getStockNames, calculateReturns } from "./stockData";

export function runBacktest(params: StrategyParameters): BacktestResult {
  const matchedStocks = filterStocks(params.filters);

  if (matchedStocks.length === 0) {
    return {
      strategyName: params.description,
      description: params.description,
      matchedStocks: [],
      matchedStockCount: 0,
      timeHorizons: [],
      chartData: [],
      runDate: new Date().toISOString(),
    };
  }

  const periods = [
    { label: "1yr", years: 1 },
    { label: "5yr", years: 5 },
    { label: "10yr", years: 10 },
    { label: "20yr", years: 20 },
  ];

  const timeHorizons = periods.map(({ label, years }) => {
    const { strategyReturn, benchmarkReturn } = calculateReturns(matchedStocks, years);
    return {
      period: label,
      strategyReturn: Math.round(strategyReturn * 100) / 100,
      benchmarkReturn: Math.round(benchmarkReturn * 100) / 100,
      outperforms: strategyReturn > benchmarkReturn,
    };
  });

  // Get chart data for the longest available period (20yr)
  const { chartData } = calculateReturns(matchedStocks, 20);

  return {
    strategyName: params.description,
    description: params.description,
    matchedStocks: getStockNames(matchedStocks),
    matchedStockCount: matchedStocks.length,
    timeHorizons,
    chartData,
    runDate: new Date().toISOString(),
  };
}
