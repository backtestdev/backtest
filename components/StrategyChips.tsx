"use client";

const EXAMPLE_STRATEGIES = [
  {
    label: "Dividend Aristocrats",
    query: "Stocks with 10+ years of consecutive dividend growth",
  },
  {
    label: "High Revenue Growth",
    query: "Tech companies with revenue growth over 20% annually",
  },
  {
    label: "Low P/E Value Stocks",
    query: "Stocks with P/E under 15 and positive earnings",
  },
  {
    label: "Small Cap Quality",
    query: "Companies with market cap under $10B and profit margins over 15%",
  },
  {
    label: "High Yield Income",
    query: "Dividend yield over 4% with payout ratio under 60%",
  },
  {
    label: "52-Week High Momentum",
    query: "Stocks that hit 52-week highs",
  },
];

interface StrategyChipsProps {
  onSelect: (query: string) => void;
}

export default function StrategyChips({ onSelect }: StrategyChipsProps) {
  return (
    <div className="flex flex-wrap gap-2 justify-center">
      {EXAMPLE_STRATEGIES.map((strategy) => (
        <button
          key={strategy.label}
          onClick={() => onSelect(strategy.query)}
          className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-full hover:bg-gray-100 hover:text-gray-900 hover:border-gray-300 transition-all duration-150 cursor-pointer"
        >
          {strategy.label}
        </button>
      ))}
    </div>
  );
}
