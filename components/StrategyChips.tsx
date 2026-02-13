"use client";

const EXAMPLE_STRATEGIES = [
  // Basic Value & Dividend
  {
    label: "Dividend Aristocrats",
    query: "Dividend aristocrats: 25+ years of consecutive dividend increases",
  },
  {
    label: "Deep Value",
    query: "Deep value: P/E under 10, P/B under 1.5, positive free cash flow",
  },
  {
    label: "High Yield Low Payout",
    query: "High dividend yield over 4% with payout ratio under 60%",
  },
  // Growth & Momentum
  {
    label: "Small Cap Growth Tech",
    query: "Tech stocks under $10B market cap with revenue growth over 25%",
  },
  {
    label: "Revenue Growth Leaders",
    query: "Companies with 20%+ revenue growth and improving profit margins",
  },
  {
    label: "52-Week High Momentum",
    query: "Stocks within 5% of 52-week highs with earnings growth over 15%",
  },
  // Quality & GARP
  {
    label: "Quality Compounders",
    query: "Quality compounders: ROE over 15%, debt-to-equity under 0.5, consistent earnings growth",
  },
  {
    label: "GARP Strategy",
    query: "GARP: P/E under 20, earnings growth over 15%, ROE above 12%",
  },
  // Contrarian & Special Situations
  {
    label: "Fallen Angels",
    query: "Fallen angels: Stocks down 40%+ from 52-week highs with positive free cash flow and profit margin above 5%",
  },
  {
    label: "Turnaround Candidates",
    query: "Turnaround candidates: Positive profit margins with 2+ years of consecutive earnings growth and P/E under 15",
  },
  {
    label: "Cash-Rich Compounders",
    query: "Cash-rich compounders: Free cash flow yield over 8% with ROE above 15% and debt-to-equity under 0.5",
  },
  {
    label: "Overlooked Quality",
    query: "Overlooked quality: Mid-cap $2B-$20B market cap with ROIC over 15% and EV/EBITDA under 12",
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
