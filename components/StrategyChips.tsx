"use client";

interface StrategyChipsProps {
  onSelect: (query: string) => void;
  onCreateOwn: () => void;
}

const EXAMPLE_STRATEGIES = [
  // Quality & Growth (metrics that matter most — ROE, earnings, margins, FCF)
  { label: "Quality Compounders", query: "Quality compounders: ROE over 15%, debt-to-equity under 0.5, consistent earnings growth" },
  { label: "High Profit Leaders", query: "Companies with profit margin above 15% and ROE over 20%" },
  { label: "Revenue Growth Stars", query: "Companies with 20%+ revenue growth and improving profit margins" },
  { label: "Small Cap Growth", query: "Stocks under $10B market cap with revenue growth over 25%" },
  // Value & GARP
  { label: "Growth at Fair Price", query: "GARP: P/E under 20, earnings growth over 15%, ROE above 12%" },
  { label: "Deep Value", query: "Deep value: P/E under 10, P/B under 1.5, positive free cash flow" },
  { label: "Cash-Rich Compounders", query: "Cash-rich compounders: Free cash flow yield over 8% with ROE above 15% and debt-to-equity under 0.5" },
  // Contrarian & Special Situations
  { label: "Fallen Angels", query: "Fallen angels: Stocks down 40%+ from 52-week highs with positive free cash flow and profit margin above 5%" },
  { label: "Overlooked Mid-Caps", query: "Overlooked quality: Mid-cap $2B-$20B market cap with ROIC over 15% and EV/EBITDA under 12" },
  // Dividend & Momentum
  { label: "Dividend Value", query: "Dividend yield over 3% with P/E under 15, payout ratio under 70%, and debt-to-equity under 1" },
  { label: "Momentum Leaders", query: "Stocks within 5% of 52-week highs with earnings growth over 15%" },
];

// Rotating color palette for hover effects — each chip gets a distinct color
const CHIP_HOVER_COLORS = [
  "hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:border-blue-400 dark:hover:text-blue-300 dark:hover:bg-blue-950/30",
  "hover:border-emerald-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:border-emerald-400 dark:hover:text-emerald-300 dark:hover:bg-emerald-950/30",
  "hover:border-violet-400 hover:text-violet-600 hover:bg-violet-50 dark:hover:border-violet-400 dark:hover:text-violet-300 dark:hover:bg-violet-950/30",
  "hover:border-amber-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:border-amber-400 dark:hover:text-amber-300 dark:hover:bg-amber-950/30",
  "hover:border-rose-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:border-rose-400 dark:hover:text-rose-300 dark:hover:bg-rose-950/30",
  "hover:border-cyan-400 hover:text-cyan-600 hover:bg-cyan-50 dark:hover:border-cyan-400 dark:hover:text-cyan-300 dark:hover:bg-cyan-950/30",
  "hover:border-indigo-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:border-indigo-400 dark:hover:text-indigo-300 dark:hover:bg-indigo-950/30",
  "hover:border-teal-400 hover:text-teal-600 hover:bg-teal-50 dark:hover:border-teal-400 dark:hover:text-teal-300 dark:hover:bg-teal-950/30",
  "hover:border-pink-400 hover:text-pink-600 hover:bg-pink-50 dark:hover:border-pink-400 dark:hover:text-pink-300 dark:hover:bg-pink-950/30",
  "hover:border-lime-400 hover:text-lime-600 hover:bg-lime-50 dark:hover:border-lime-400 dark:hover:text-lime-300 dark:hover:bg-lime-950/30",
  "hover:border-orange-400 hover:text-orange-600 hover:bg-orange-50 dark:hover:border-orange-400 dark:hover:text-orange-300 dark:hover:bg-orange-950/30",
];

export default function StrategyChips({ onSelect, onCreateOwn }: StrategyChipsProps) {
  return (
    <div className="flex flex-wrap gap-2 justify-center max-w-3xl mx-auto">
      {/* Create your own — prominent CTA */}
      <button
        onClick={onCreateOwn}
        className="px-4 sm:px-5 py-2 text-xs sm:text-sm font-semibold text-th-accent border-2 border-th-accent-border bg-th-accent-bg rounded-full hover:bg-th-accent hover:text-white transition-all duration-150 cursor-pointer flex items-center gap-1.5 shadow-sm"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        Create your own
      </button>
      {/* Prebuilt strategy chips */}
      {EXAMPLE_STRATEGIES.map((strategy, i) => (
        <button
          key={strategy.label}
          onClick={() => onSelect(strategy.query)}
          className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium text-th-text-2 bg-th-inset border border-th-border rounded-full transition-all duration-150 cursor-pointer hover:shadow-sm ${CHIP_HOVER_COLORS[i % CHIP_HOVER_COLORS.length]}`}
        >
          {strategy.label}
        </button>
      ))}
    </div>
  );
}
