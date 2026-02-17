"use client";

interface StrategyChipsProps {
  onSelect: (query: string) => void;
  onCreateOwn: () => void;
}

const EXAMPLE_STRATEGIES = [
  // Basic Value & Dividend
  { label: "Dividend Value", query: "Dividend yield over 3% with P/E under 15, payout ratio under 70%, and debt-to-equity under 1" },
  { label: "Deep Value", query: "Deep value: P/E under 10, P/B under 1.5, positive free cash flow" },
  { label: "High Yield Low Payout", query: "High dividend yield over 4% with payout ratio under 60%" },
  // Growth & Momentum
  { label: "Small Cap Growth Tech", query: "Tech stocks under $10B market cap with revenue growth over 25%" },
  { label: "Revenue Growth Leaders", query: "Companies with 20%+ revenue growth and improving profit margins" },
  { label: "52-Week High Momentum", query: "Stocks within 5% of 52-week highs with earnings growth over 15%" },
  // Quality & GARP
  { label: "Quality Compounders", query: "Quality compounders: ROE over 15%, debt-to-equity under 0.5, consistent earnings growth" },
  { label: "GARP Strategy", query: "GARP: P/E under 20, earnings growth over 15%, ROE above 12%" },
  // Contrarian & Special Situations
  { label: "Fallen Angels", query: "Fallen angels: Stocks down 40%+ from 52-week highs with positive free cash flow and profit margin above 5%" },
  { label: "Cash-Rich Compounders", query: "Cash-rich compounders: Free cash flow yield over 8% with ROE above 15% and debt-to-equity under 0.5" },
  { label: "Overlooked Quality", query: "Overlooked quality: Mid-cap $2B-$20B market cap with ROIC over 15% and EV/EBITDA under 12" },
];

export default function StrategyChips({ onSelect, onCreateOwn }: StrategyChipsProps) {
  return (
    <div className="flex flex-wrap gap-2 justify-center max-w-3xl mx-auto">
      {EXAMPLE_STRATEGIES.map((strategy) => (
        <button
          key={strategy.label}
          onClick={() => onSelect(strategy.query)}
          className="px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium text-th-text-2 bg-th-inset border border-th-border rounded-full hover:bg-th-hover hover:text-th-text hover:border-th-border transition-all duration-150 cursor-pointer"
        >
          {strategy.label}
        </button>
      ))}
      <button
        onClick={onCreateOwn}
        className="px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium text-th-text-3 border-2 border-dashed border-th-border rounded-full hover:border-th-accent-border hover:text-th-accent hover:bg-th-accent-bg/50 transition-all duration-150 cursor-pointer flex items-center gap-1.5"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        Create your own
      </button>
    </div>
  );
}
