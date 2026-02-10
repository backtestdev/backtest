"use client";

const EXAMPLE_STRATEGIES = [
  {
    label: "Beaten-Down Cash Generators",
    query: "Stocks down 40%+ from 52-week highs with positive free cash flow",
  },
  {
    label: "Dividend Growers",
    query: "Companies with 5+ years of consecutive dividend increases",
  },
  {
    label: "Small Cap Growth Tech",
    query: "Tech stocks under $10B market cap with 25%+ revenue growth",
  },
  {
    label: "Classic Value",
    query: "Value stocks: P/E under 12, dividend yield over 3%",
  },
  {
    label: "High Margin Consumer",
    query: "High profit margin stocks (>20%) in consumer sectors",
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
