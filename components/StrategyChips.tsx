"use client";

const EXAMPLE_STRATEGIES = [
  // Value & Dividend
  {
    label: "Dividend Champions",
    query: "Stocks with 10+ consecutive years of dividend growth and dividend yield over 2%",
  },
  {
    label: "Deep Value",
    query: "Deep value: P/E under 10, price-to-book under 1.5, positive free cash flow",
  },
  {
    label: "High Yield Low Payout",
    query: "High dividend yield over 4% with payout ratio under 60%",
  },
  // Growth & Momentum
  {
    label: "Small Cap Growth",
    query: "Small cap under $10B market cap with revenue growth over 25%",
  },
  {
    label: "Revenue Growth Leaders",
    query: "Companies with 20%+ revenue growth and profit margin above 10%",
  },
  {
    label: "52-Week High Momentum",
    query: "Stocks within 5% of 52-week high with earnings growth over 10%",
  },
  // Quality & GARP
  {
    label: "Quality Compounders",
    query: "Quality compounders: ROE over 15%, debt-to-equity under 0.5, profit margin above 10%",
  },
  {
    label: "GARP Strategy",
    query: "GARP: P/E under 20, earnings growth over 15%, ROE above 12%",
  },
  // Income & Defensive
  {
    label: "Cash Flow Kings",
    query: "Strong free cash flow per share over $5 with price-to-free-cash-flow under 20",
  },
  {
    label: "Low Volatility Income",
    query: "Low beta stocks under 0.8 with dividend yield over 2.5%",
  },
  // Margin & Balance Sheet
  {
    label: "High Margin Leaders",
    query: "Gross margin above 60% and operating margin above 20% with market cap over $5B",
  },
  {
    label: "Strong Balance Sheet",
    query: "Debt-to-equity under 0.3, current ratio over 2, interest coverage over 10",
  },
  // Special
  {
    label: "Profitable Growth",
    query: "Large cap over $50B with revenue growth above 15% and gross margin over 50%",
  },
  {
    label: "Buyback Champions",
    query: "Companies reducing shares outstanding by 3%+ annually with positive earnings growth",
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
