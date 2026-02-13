"use client";

interface StrategyChipsProps {
  onSelect: (query: string) => void;
  onCreateOwn: () => void;
}

const FEATURED_STRATEGIES = [
  {
    label: "Dividend Value",
    description: "High-yield, low-valuation stocks with manageable debt",
    query:
      "Dividend yield over 3% with P/E under 15, payout ratio under 70%, and debt-to-equity under 1",
  },
  {
    label: "Quality Growth",
    description: "Profitable compounders with strong returns on equity",
    query:
      "Quality compounders: ROE over 15%, debt-to-equity under 0.5, consistent earnings growth",
  },
  {
    label: "Small Cap Momentum",
    description: "High-growth small caps in the technology sector",
    query:
      "Tech stocks under $10B market cap with revenue growth over 25%",
  },
];

export default function StrategyChips({ onSelect, onCreateOwn }: StrategyChipsProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {FEATURED_STRATEGIES.map((strategy) => (
        <button
          key={strategy.label}
          onClick={() => onSelect(strategy.query)}
          className="group text-left px-4 py-3.5 bg-white border border-gray-200 rounded-xl hover:border-blue-300 hover:shadow-sm transition-all duration-150 cursor-pointer"
        >
          <p className="text-sm font-semibold text-gray-800 group-hover:text-blue-600 transition-colors">
            {strategy.label}
          </p>
          <p className="text-xs text-gray-400 mt-1 leading-relaxed">
            {strategy.description}
          </p>
        </button>
      ))}
      <button
        onClick={onCreateOwn}
        className="group text-left px-4 py-3.5 border-2 border-dashed border-gray-200 rounded-xl hover:border-blue-400 hover:bg-blue-50/50 transition-all duration-150 cursor-pointer"
      >
        <p className="text-sm font-semibold text-gray-400 group-hover:text-blue-600 transition-colors flex items-center gap-1.5">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Create your own
        </p>
        <p className="text-xs text-gray-400 mt-1 leading-relaxed">
          Describe any strategy in plain English
        </p>
      </button>
    </div>
  );
}
