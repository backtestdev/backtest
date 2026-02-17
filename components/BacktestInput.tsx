"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import StrategyChips from "./StrategyChips";
import { ParsingMethod } from "@/lib/types";

// ── Animated placeholder strategies ──
const PLACEHOLDER_STRATEGIES = [
  "Stocks with P/E under 15 and dividend yield over 3%",
  "Tech companies with revenue growth over 20%",
  "High ROE stocks with low debt-to-equity",
  "Small cap value stocks under $5B market cap",
  "Companies with 5+ years of consecutive earnings growth",
  "Fallen angels: stocks down 30%+ with positive free cash flow",
];

// ── Metric suggestions for autocomplete ──
interface MetricSuggestion {
  label: string;
  insert: string;
  category: string;
  keywords: string[];
}

const METRIC_SUGGESTIONS: MetricSuggestion[] = [
  // Valuation
  { label: "P/E Ratio", insert: "P/E", category: "Valuation", keywords: ["pe", "p/e", "price to earnings", "price earnings", "valuation"] },
  { label: "Forward P/E", insert: "forward P/E", category: "Valuation", keywords: ["forward pe", "forward p/e", "fwd pe"] },
  { label: "Price to Book", insert: "P/B", category: "Valuation", keywords: ["pb", "p/b", "price to book", "book value"] },
  { label: "PEG Ratio", insert: "PEG ratio", category: "Valuation", keywords: ["peg", "price earnings growth"] },
  { label: "EV/EBITDA", insert: "EV/EBITDA", category: "Valuation", keywords: ["ev", "ebitda", "enterprise value", "ev/ebitda"] },
  { label: "Price/FCF", insert: "price-to-free-cash-flow", category: "Valuation", keywords: ["price to fcf", "p/fcf", "price fcf"] },
  { label: "Earnings Yield", insert: "earnings yield", category: "Valuation", keywords: ["earnings yield"] },
  { label: "Graham Number", insert: "Graham number", category: "Valuation", keywords: ["graham", "graham number"] },
  // Growth
  { label: "Revenue Growth", insert: "revenue growth", category: "Growth", keywords: ["revenue growth", "sales growth", "top line"] },
  { label: "Earnings Growth", insert: "earnings growth", category: "Growth", keywords: ["earnings growth", "profit growth", "eps growth"] },
  { label: "Revenue Growth (3yr)", insert: "3-year average revenue growth", category: "Growth", keywords: ["3yr", "3 year", "average revenue"] },
  { label: "Consec. Revenue Growth Yrs", insert: "consecutive years of revenue growth", category: "Growth", keywords: ["consecutive", "years of revenue", "streak"] },
  { label: "Consec. Earnings Growth Yrs", insert: "consecutive years of earnings growth", category: "Growth", keywords: ["consecutive", "years of earnings"] },
  { label: "EPS Growth (YoY)", insert: "year-over-year EPS growth", category: "Growth", keywords: ["eps growth", "yoy", "year over year"] },
  // Profitability
  { label: "Profit Margin", insert: "profit margin", category: "Profitability", keywords: ["profit margin", "margin", "net margin"] },
  { label: "Gross Margin", insert: "gross margin", category: "Profitability", keywords: ["gross margin", "gross profit"] },
  { label: "Operating Margin", insert: "operating margin", category: "Profitability", keywords: ["operating margin", "operating profit"] },
  { label: "EBITDA Margin", insert: "EBITDA margin", category: "Profitability", keywords: ["ebitda margin"] },
  { label: "ROE", insert: "ROE", category: "Profitability", keywords: ["roe", "return on equity"] },
  { label: "ROA", insert: "ROA", category: "Profitability", keywords: ["roa", "return on assets"] },
  { label: "ROIC", insert: "ROIC", category: "Profitability", keywords: ["roic", "return on invested capital"] },
  { label: "ROCE", insert: "ROCE", category: "Profitability", keywords: ["roce", "return on capital employed"] },
  // Dividends
  { label: "Dividend Yield", insert: "dividend yield", category: "Dividends", keywords: ["dividend", "yield", "div"] },
  { label: "Payout Ratio", insert: "payout ratio", category: "Dividends", keywords: ["payout", "payout ratio"] },
  // Leverage & Liquidity
  { label: "Debt/Equity", insert: "debt-to-equity", category: "Leverage", keywords: ["debt", "equity", "d/e", "leverage", "de ratio"] },
  { label: "Current Ratio", insert: "current ratio", category: "Leverage", keywords: ["current ratio", "liquidity"] },
  { label: "Quick Ratio", insert: "quick ratio", category: "Leverage", keywords: ["quick ratio", "acid test"] },
  { label: "Interest Coverage", insert: "interest coverage", category: "Leverage", keywords: ["interest coverage", "times interest"] },
  { label: "Debt/Assets", insert: "debt-to-assets", category: "Leverage", keywords: ["debt to assets", "debt/assets"] },
  // Cash Flow
  { label: "Free Cash Flow/Share", insert: "free cash flow per share", category: "Cash Flow", keywords: ["fcf", "free cash flow", "cash flow"] },
  { label: "FCF Yield", insert: "free cash flow yield", category: "Cash Flow", keywords: ["fcf yield", "free cash flow yield"] },
  // Market
  { label: "Market Cap", insert: "market cap", category: "Market", keywords: ["market cap", "mcap", "cap", "size"] },
  { label: "Beta", insert: "beta", category: "Market", keywords: ["beta", "volatility"] },
  { label: "52-Week High %", insert: "% of 52-week high", category: "Market", keywords: ["52 week", "52-week", "high", "near high"] },
  // Sector
  { label: "Sector", insert: "sector", category: "Sector", keywords: ["sector", "industry", "tech", "healthcare", "financial", "energy", "consumer", "industrial", "utilities", "real estate"] },
];

// ── Types ──
interface BacktestInputProps {
  onSubmit: (strategy: string) => void;
  isLoading: boolean;
  parsingMethod?: ParsingMethod;
  dataSource?: "fmp" | "hardcoded";
  stockUniverseSize?: number;
  warnings?: string[];
  stockSourceError?: string;
}

// ── Sub-components ──

function ParsingBadge({ method }: { method: ParsingMethod }) {
  switch (method) {
    case "ai":
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          Parsed with AI
        </span>
      );
    case "fallback":
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-amber-50 text-amber-700 border border-amber-200">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
          Using rule-based parsing
        </span>
      );
    case "failed":
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-red-50 text-red-700 border border-red-200">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
          Parsing failed - showing all stocks
        </span>
      );
    default:
      return null;
  }
}

function DataSourceBadge({ source, count }: { source: "fmp" | "hardcoded"; count?: number }) {
  if (source === "fmp") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-blue-50 text-blue-700 border border-blue-200">
        <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
        Live data{count ? ` (${count.toLocaleString()} stocks)` : ""}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-gray-50 text-gray-600 border border-gray-200">
      <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
      Sample data{count ? ` (${count} stocks)` : ""}
    </span>
  );
}

// ── Hooks ──

function useAnimatedPlaceholder(isActive: boolean) {
  const [displayText, setDisplayText] = useState("");
  const indexRef = useRef(0);
  const charRef = useRef(0);
  const phaseRef = useRef<"typing" | "pausing" | "erasing">("typing");
  const rafRef = useRef<number>(0);
  const lastTickRef = useRef(0);

  useEffect(() => {
    if (!isActive) {
      setDisplayText("");
      return;
    }

    const TYPING_SPEED = 40;
    const PAUSE_DURATION = 2000;
    const ERASE_SPEED = 20;

    phaseRef.current = "typing";
    charRef.current = 0;
    lastTickRef.current = 0;

    const tick = (timestamp: number) => {
      const elapsed = timestamp - lastTickRef.current;
      const strategy = PLACEHOLDER_STRATEGIES[indexRef.current];

      if (phaseRef.current === "typing") {
        if (elapsed >= TYPING_SPEED) {
          lastTickRef.current = timestamp;
          charRef.current++;
          setDisplayText(strategy.slice(0, charRef.current));
          if (charRef.current >= strategy.length) {
            phaseRef.current = "pausing";
          }
        }
      } else if (phaseRef.current === "pausing") {
        if (elapsed >= PAUSE_DURATION) {
          lastTickRef.current = timestamp;
          phaseRef.current = "erasing";
        }
      } else if (phaseRef.current === "erasing") {
        if (elapsed >= ERASE_SPEED) {
          lastTickRef.current = timestamp;
          charRef.current--;
          setDisplayText(strategy.slice(0, charRef.current));
          if (charRef.current <= 0) {
            indexRef.current = (indexRef.current + 1) % PLACEHOLDER_STRATEGIES.length;
            phaseRef.current = "typing";
          }
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isActive]);

  return displayText;
}

function useMetricAutocomplete(strategy: string, cursorPos: number) {
  const [suggestions, setSuggestions] = useState<MetricSuggestion[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (!strategy || cursorPos === 0) {
      setSuggestions([]);
      return;
    }

    // Extract the current word fragment at the cursor
    const textBeforeCursor = strategy.slice(0, cursorPos);
    // Get last 1-4 words for multi-word metric matching
    const words = textBeforeCursor.split(/[\s,]+/);
    const fragments = [
      words.slice(-1).join(" "),
      words.slice(-2).join(" "),
      words.slice(-3).join(" "),
    ].map((f) => f.toLowerCase().trim());

    const lastWord = fragments[0];

    // Don't show suggestions for very short fragments or common words
    const IGNORE_WORDS = new Set([
      "a", "an", "the", "and", "or", "with", "of", "to", "in", "on",
      "is", "are", "over", "under", "above", "below", "than", "from",
      "stocks", "stock", "companies", "company", "buy", "sell", "for",
      "that", "have", "has", "their", "its", "at", "least", "most",
      "more", "less", "not", "no", "any", "all", "each", "between",
    ]);

    if (lastWord.length < 2 || IGNORE_WORDS.has(lastWord)) {
      setSuggestions([]);
      return;
    }

    // Score each metric based on how well the fragments match
    const scored = METRIC_SUGGESTIONS.map((metric) => {
      let bestScore = 0;

      for (const fragment of fragments) {
        if (!fragment) continue;

        // Check label match
        if (metric.label.toLowerCase().startsWith(fragment)) {
          bestScore = Math.max(bestScore, 10);
        } else if (metric.label.toLowerCase().includes(fragment)) {
          bestScore = Math.max(bestScore, 6);
        }

        // Check keyword matches
        for (const keyword of metric.keywords) {
          if (keyword.startsWith(fragment)) {
            bestScore = Math.max(bestScore, 9);
          } else if (keyword.includes(fragment)) {
            bestScore = Math.max(bestScore, 5);
          } else if (fragment.includes(keyword.slice(0, 3)) && keyword.length > 2) {
            bestScore = Math.max(bestScore, 3);
          }
        }

        // Check insert text match
        if (metric.insert.toLowerCase().startsWith(fragment)) {
          bestScore = Math.max(bestScore, 8);
        }
      }

      return { metric, score: bestScore };
    });

    const matches = scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map((s) => s.metric);

    setSuggestions(matches);
    setSelectedIndex(0);
  }, [strategy, cursorPos]);

  return { suggestions, selectedIndex, setSelectedIndex, setSuggestions };
}

// ── Main Component ──

export default function BacktestInput({
  onSubmit,
  isLoading,
  parsingMethod,
  dataSource,
  stockUniverseSize,
  warnings,
  stockSourceError,
}: BacktestInputProps) {
  const [strategy, setStrategy] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [cursorPos, setCursorPos] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  const showPlaceholder = !strategy && !isFocused;
  const animatedText = useAnimatedPlaceholder(showPlaceholder);
  const { suggestions, selectedIndex, setSelectedIndex, setSuggestions } =
    useMetricAutocomplete(strategy, isFocused ? cursorPos : 0);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (strategy.trim() && !isLoading) {
      onSubmit(strategy.trim());
      setSuggestions([]);
    }
  };

  const handleChipSelect = (query: string) => {
    setStrategy(query);
    // Focus textarea so user can see what was filled in
    textareaRef.current?.focus();
  };

  const handleCreateOwn = () => {
    setStrategy("");
    textareaRef.current?.focus();
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setStrategy(e.target.value);
    setCursorPos(e.target.selectionStart || 0);
  };

  const handleSelect = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const target = e.target as HTMLTextAreaElement;
    setCursorPos(target.selectionStart || 0);
  };

  const insertSuggestion = useCallback(
    (metric: MetricSuggestion) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const textBeforeCursor = strategy.slice(0, cursorPos);
      const textAfterCursor = strategy.slice(cursorPos);

      // Find how much of the current word(s) to replace
      // Walk back to find the start of the matching fragment
      const words = textBeforeCursor.split(/[\s,]+/);
      const lowerText = textBeforeCursor.toLowerCase();

      let replaceFrom = cursorPos;
      // Try matching 3, 2, then 1 words back
      for (let n = 3; n >= 1; n--) {
        const fragment = words.slice(-n).join(" ").toLowerCase();
        if (!fragment) continue;
        const matchesKeyword = metric.keywords.some(
          (k) => k.startsWith(fragment) || fragment.startsWith(k.slice(0, Math.max(2, fragment.length)))
        );
        const matchesLabel = metric.label.toLowerCase().includes(fragment);
        const matchesInsert = metric.insert.toLowerCase().startsWith(fragment);
        if (matchesKeyword || matchesLabel || matchesInsert) {
          // Find position of this fragment in the text before cursor
          const idx = lowerText.lastIndexOf(fragment);
          if (idx !== -1) {
            replaceFrom = idx;
            break;
          }
        }
      }

      const before = strategy.slice(0, replaceFrom);
      const needsSpace = before.length > 0 && !before.endsWith(" ") && !before.endsWith(",");
      const newText = before + (needsSpace ? " " : "") + metric.insert + " " + textAfterCursor.trimStart();
      const newCursor = before.length + (needsSpace ? 1 : 0) + metric.insert.length + 1;

      setStrategy(newText);
      setCursorPos(newCursor);
      setSuggestions([]);

      // Restore focus and cursor position
      requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(newCursor, newCursor);
      });
    },
    [strategy, cursorPos, setSuggestions]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Tab" || e.key === "Enter") {
      if (suggestions.length > 0) {
        e.preventDefault();
        insertSuggestion(suggestions[selectedIndex]);
      }
    } else if (e.key === "Escape") {
      setSuggestions([]);
    }
  };

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(e.target as Node) &&
        textareaRef.current &&
        !textareaRef.current.contains(e.target as Node)
      ) {
        setSuggestions([]);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [setSuggestions]);

  return (
    <div className="w-full max-w-3xl mx-auto">
      {/* Strategy cards */}
      <div className="mb-6">
        <p className="text-sm text-gray-400 text-center mb-3">
          Try a strategy
        </p>
        <StrategyChips onSelect={handleChipSelect} onCreateOwn={handleCreateOwn} />
      </div>

      {/* Main input */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={strategy}
            onChange={handleChange}
            onSelect={handleSelect}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onKeyDown={handleKeyDown}
            placeholder=""
            className="w-full h-28 sm:h-32 px-4 sm:px-6 py-3 sm:py-4 text-base sm:text-lg text-gray-900 bg-white border-2 border-gray-200 rounded-2xl resize-none focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50 transition-all duration-200"
            disabled={isLoading}
          />

          {/* Animated placeholder overlay */}
          {showPlaceholder && (
            <div
              className="absolute inset-0 px-4 sm:px-6 py-3 sm:py-4 pointer-events-none"
              aria-hidden="true"
            >
              <span className="text-base sm:text-lg text-gray-300">
                {animatedText}
                <span className="inline-block w-0.5 h-5 bg-gray-300 align-text-bottom ml-0.5 animate-pulse" />
              </span>
            </div>
          )}

          {/* Metric autocomplete dropdown */}
          {suggestions.length > 0 && isFocused && (
            <div
              ref={suggestionsRef}
              className="absolute left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-20 overflow-hidden"
            >
              <div className="px-3 py-1.5 border-b border-gray-100">
                <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">
                  Metrics
                </span>
                <span className="text-[10px] text-gray-300 ml-2">
                  Tab to insert
                </span>
              </div>
              {suggestions.map((metric, i) => (
                <button
                  key={metric.label}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault(); // prevent textarea blur
                    insertSuggestion(metric);
                  }}
                  onMouseEnter={() => setSelectedIndex(i)}
                  className={`w-full text-left px-3 py-2 flex items-center justify-between transition-colors ${
                    i === selectedIndex
                      ? "bg-blue-50 text-blue-700"
                      : "text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  <span className="text-sm font-medium">{metric.label}</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                      i === selectedIndex
                        ? "bg-blue-100 text-blue-600"
                        : "bg-gray-100 text-gray-400"
                    }`}
                  >
                    {metric.category}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={!strategy.trim() || isLoading}
          className="w-full py-3 sm:py-4 px-6 sm:px-8 text-base sm:text-lg font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-200 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center gap-3"
        >
          {isLoading ? (
            <>
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Running Backtest...
            </>
          ) : (
            "Backtest Strategy"
          )}
        </button>
      </form>

      {/* Status badges - shown after results */}
      {parsingMethod && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <ParsingBadge method={parsingMethod} />
          {dataSource && <DataSourceBadge source={dataSource} count={stockUniverseSize} />}
        </div>
      )}

      {/* Warnings */}
      {warnings && warnings.length > 0 && parsingMethod === "fallback" && (
        <div className="mt-3 max-w-2xl mx-auto">
          <details className="text-xs text-amber-600">
            <summary className="cursor-pointer hover:text-amber-700">View parsing details</summary>
            <ul className="mt-1 space-y-0.5 pl-4 list-disc">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </details>
        </div>
      )}

      {/* Stock source details */}
      {dataSource === "hardcoded" && stockSourceError && (
        <div className="mt-3 max-w-2xl mx-auto">
          <details className="text-xs text-gray-600">
            <summary className="cursor-pointer hover:text-gray-700">View stock source details</summary>
            <div className="mt-1 pl-4">
              <p className="text-amber-600">
                <strong>Using fallback data source:</strong> {stockSourceError}
              </p>
              <p className="mt-1 text-gray-500">
                The backtest is using a hardcoded dataset of {stockUniverseSize} stocks instead of live FMP data.
              </p>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
