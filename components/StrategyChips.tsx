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
    query: "Small cap tech under $10B with revenue growth over 25% annually",
  },
  {
    label: "Revenue Growth Leaders",
    query: "Companies with 20%+ revenue growth and improving profit margins",
  },
  {
    label: "52-Week High Momentum",
    query: "Stocks hitting new 52-week highs with strong earnings growth",
  },
  // Quality & GARP
  {
    label: "Quality Compounders",
    query: "Quality compounders: ROE over 15%, debt-to-equity under 0.5, consistent earnings",
  },
  {
    label: "GARP Strategy",
    query: "GARP: P/E under 20, earnings growth over 15%, ROE above 12%",
  },
  // Contrarian & Special Situations
  {
    label: "Fallen Angels",
    query: "Fallen angels: Stocks down 40%+ from highs with positive cash flow and insider buying",
  },
  {
    label: "Turnaround Candidates",
    query: "Turnaround candidates: Improving profit margins after 2+ quarters of losses",
  },
  {
    label: "Buyback Champions",
    query: "Share buyback programs: Companies reducing shares outstanding by 5%+ annually",
  },
  {
    label: "Spin-offs & New IPOs",
    query: "Spin-offs and recent IPOs under $5B market cap with institutional ownership under 50%",
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
