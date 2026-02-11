import OpenAI from "openai";
import { StrategyParameters, StockFilter, StructuredParameters } from "./types";

const SECTOR_REVERSE: Record<number, string> = {
  1: "Technology",
  2: "Healthcare",
  3: "Financial",
  4: "Energy",
  5: "Consumer",
  6: "Industrials",
  7: "Basic Materials",
  8: "Real Estate",
  9: "Utilities",
  10: "Communication Services",
};

// All known metric names and their common aliases for fuzzy matching
const METRIC_ALIASES: Record<string, string[]> = {
  pe_ratio: ["pe", "p/e", "pe ratio", "price to earnings", "price-to-earnings", "price earnings"],
  forward_pe: ["forward pe", "forward p/e", "fwd pe", "fwd p/e"],
  price_to_book: ["pb", "p/b", "pb ratio", "price to book", "price-to-book"],
  dividend_yield: ["dividend", "div yield", "dividend yield", "yield"],
  dividend_growth_years: ["dividend growth", "div growth years", "consecutive dividend"],
  payout_ratio: ["payout", "payout ratio", "dividend payout"],
  revenue_growth: ["revenue growth", "rev growth", "sales growth", "top line growth"],
  revenue_growth_quarters: ["revenue growth quarters", "consecutive quarters revenue"],
  earnings_growth: ["earnings growth", "eps growth", "profit growth", "bottom line growth"],
  profit_margin: ["profit margin", "net margin", "margin", "net profit margin"],
  roe: ["roe", "return on equity"],
  roic: ["roic", "return on invested capital"],
  debt_to_equity: ["debt to equity", "d/e", "de ratio", "leverage", "debt/equity", "debt equity"],
  current_ratio: ["current ratio", "liquidity ratio"],
  free_cash_flow_per_share: ["fcf", "free cash flow", "fcf per share"],
  revenue_per_share: ["revenue per share", "rev per share", "sales per share", "rps"],
  net_income_per_share: ["net income per share", "earnings per share", "ni per share", "nips"],
  market_cap: ["market cap", "mcap", "market capitalization", "market value"],
  beta: ["beta", "volatility"],
  week52_high_pct: ["52 week high", "52-week high", "near high", "52w high"],
  sector: ["sector", "industry"],
  // Key Metrics endpoint
  enterprise_value: ["enterprise value", "ev"],
  ev_to_sales: ["ev to sales", "ev/sales"],
  ev_to_operating_cash_flow: ["ev to operating cash flow", "ev/ocf"],
  ev_to_free_cash_flow: ["ev to free cash flow", "ev/fcf"],
  ev_to_ebitda: ["ev to ebitda", "ev/ebitda"],
  net_debt_to_ebitda: ["net debt to ebitda", "net debt/ebitda"],
  income_quality: ["income quality"],
  graham_number: ["graham number"],
  graham_net_net: ["graham net net", "net-net"],
  tax_burden: ["tax burden"],
  interest_burden: ["interest burden"],
  working_capital: ["working capital"],
  invested_capital: ["invested capital"],
  return_on_assets: ["roa", "return on assets"],
  operating_return_on_assets: ["operating roa", "operating return on assets"],
  return_on_tangible_assets: ["return on tangible assets", "rota"],
  return_on_capital_employed: ["roce", "return on capital employed"],
  earnings_yield: ["earnings yield"],
  free_cash_flow_yield: ["fcf yield", "free cash flow yield"],
  capex_to_operating_cash_flow: ["capex to ocf", "capex/ocf"],
  capex_to_depreciation: ["capex to depreciation", "capex/depreciation"],
  capex_to_revenue: ["capex to revenue", "capex/revenue"],
  sga_to_revenue: ["sga to revenue", "sg&a to revenue", "selling general admin"],
  rd_to_revenue: ["r&d to revenue", "rd to revenue", "research development"],
  sbc_to_revenue: ["sbc to revenue", "stock based comp to revenue"],
  intangibles_to_total_assets: ["intangibles to assets", "intangible assets ratio"],
  days_sales_outstanding: ["dso", "days sales outstanding"],
  days_payables_outstanding: ["dpo", "days payables outstanding"],
  days_inventory_outstanding: ["dio", "days inventory outstanding"],
  operating_cycle: ["operating cycle"],
  cash_conversion_cycle: ["ccc", "cash conversion cycle"],
  free_cash_flow_to_equity: ["fcfe", "fcf to equity"],
  free_cash_flow_to_firm: ["fcff", "fcf to firm"],
  tangible_asset_value: ["tangible asset value", "tav"],
  net_current_asset_value: ["ncav", "net current asset value"],
  // Ratios endpoint
  gross_profit_margin: ["gross margin", "gross profit margin"],
  ebit_margin: ["ebit margin"],
  ebitda_margin: ["ebitda margin"],
  operating_profit_margin: ["operating margin", "operating profit margin"],
  pretax_profit_margin: ["pretax margin", "pretax profit margin"],
  net_profit_margin: ["net profit margin", "net margin ratio"],
  quick_ratio: ["quick ratio", "acid test"],
  solvency_ratio: ["solvency ratio", "solvency"],
  cash_ratio: ["cash ratio"],
  peg_ratio: ["peg", "peg ratio", "price earnings growth"],
  forward_peg_ratio: ["forward peg", "forward peg ratio"],
  price_to_fcf_ratio: ["price to fcf", "p/fcf", "price/fcf"],
  price_to_ocf_ratio: ["price to ocf", "p/ocf", "price/ocf"],
  debt_to_assets_ratio: ["debt to assets", "debt/assets"],
  debt_to_capital_ratio: ["debt to capital", "debt/capital"],
  lt_debt_to_capital_ratio: ["lt debt to capital", "long term debt to capital"],
  financial_leverage_ratio: ["financial leverage"],
  interest_coverage_ratio: ["interest coverage", "times interest earned"],
  debt_service_coverage_ratio: ["dscr", "debt service coverage"],
  dividend_yield_percentage: ["dividend yield pct", "dividend yield percentage"],
  cash_per_share: ["cash per share", "cps"],
  book_value_per_share: ["book value per share", "bvps"],
  tangible_book_value_per_share: ["tangible book value per share", "tbvps"],
  operating_cash_flow_per_share: ["ocf per share", "operating cash flow per share"],
  price_to_fair_value: ["price to fair value", "p/fv"],
  debt_to_market_cap: ["debt to market cap"],
  effective_tax_rate: ["effective tax rate", "tax rate"],
  enterprise_value_multiple: ["ev multiple", "enterprise value multiple"],
};

// Build reverse lookup: alias -> canonical metric name
const ALIAS_TO_METRIC: Record<string, string> = {};
for (const [metric, aliases] of Object.entries(METRIC_ALIASES)) {
  for (const alias of aliases) {
    ALIAS_TO_METRIC[alias.toLowerCase()] = metric;
  }
  ALIAS_TO_METRIC[metric.toLowerCase()] = metric;
}

/**
 * Attempts fuzzy matching of a metric name against known aliases.
 * Returns the canonical metric name or null if no match found.
 */
function fuzzyMatchMetric(input: string): string | null {
  const lower = input.toLowerCase().trim();

  // Exact match first
  if (ALIAS_TO_METRIC[lower]) return ALIAS_TO_METRIC[lower];

  // Check if input contains any alias
  for (const [alias, metric] of Object.entries(ALIAS_TO_METRIC)) {
    if (lower.includes(alias) || alias.includes(lower)) {
      return metric;
    }
  }

  // Levenshtein-style simple similarity: check if removing underscores/spaces matches
  const normalized = lower.replace(/[_\s\-\/]/g, "");
  for (const [alias, metric] of Object.entries(ALIAS_TO_METRIC)) {
    const normalizedAlias = alias.replace(/[_\s\-\/]/g, "");
    if (normalized === normalizedAlias) return metric;
  }

  return null;
}

const SYSTEM_PROMPT = `You are a financial strategy parser. Given a natural language description of a stock investment strategy, extract structured parameters.

Return a JSON object with this exact structure:
{
  "description": "A clean, short description of the strategy",
  "filters": [
    {
      "metric": "<metric_name>",
      "operator": "<operator>",
      "value": <number>,
      "valueEnd": <number or null>
    }
  ],
  "sortBy": "<optional metric to sort by>",
  "sortOrder": "asc" or "desc",
  "maxStocks": <optional number limit>
}

Available metrics:
- pe_ratio (Price-to-Earnings ratio)
- forward_pe (Forward P/E ratio)
- dividend_yield (as decimal, e.g. 0.04 for 4%)
- dividend_growth_years (consecutive years of dividend growth)
- revenue_growth (annual revenue growth rate as decimal, e.g. 0.20 for 20%)
- revenue_growth_quarters (consecutive quarters of revenue growth)
- earnings_growth (annual earnings growth rate as decimal)
- profit_margin (as decimal, e.g. 0.15 for 15%)
- market_cap (CRITICAL: value must be in BILLIONS. Examples: "$10B" or "10 billion" = 10, "$200B" = 200, "$300M" = 0.3, "$2 trillion" = 2000, "under $10B" = use operator "<" with value 10)
- price_to_book
- debt_to_equity
- current_ratio
- roe (return on equity as decimal)
- roic (return on invested capital as decimal)
- payout_ratio (dividend payout ratio as decimal)
- beta
- week52_high_pct (percentage of 52-week high, 1.0 = at the high)
- sector (use value 1 for tech, 2 for healthcare, 3 for finance, 4 for energy, 5 for consumer, 6 for industrials, 7 for basic materials, 8 for real estate, 9 for utilities, 10 for communication services)
- free_cash_flow_per_share
- enterprise_value, ev_to_sales, ev_to_operating_cash_flow, ev_to_free_cash_flow, ev_to_ebitda
- net_debt_to_ebitda, income_quality, graham_number, graham_net_net
- tax_burden, interest_burden, working_capital, invested_capital
- return_on_assets (ROA as decimal), operating_return_on_assets, return_on_tangible_assets
- return_on_capital_employed (ROCE as decimal), earnings_yield, free_cash_flow_yield
- capex_to_operating_cash_flow, capex_to_depreciation, capex_to_revenue
- sga_to_revenue, rd_to_revenue, sbc_to_revenue, intangibles_to_total_assets
- days_sales_outstanding, days_payables_outstanding, days_inventory_outstanding
- operating_cycle, cash_conversion_cycle
- free_cash_flow_to_equity, free_cash_flow_to_firm, tangible_asset_value, net_current_asset_value
- gross_profit_margin, ebit_margin, ebitda_margin, operating_profit_margin, pretax_profit_margin
- net_profit_margin, quick_ratio, solvency_ratio, cash_ratio
- peg_ratio, forward_peg_ratio, price_to_fcf_ratio, price_to_ocf_ratio
- debt_to_assets_ratio, debt_to_capital_ratio, lt_debt_to_capital_ratio, financial_leverage_ratio
- interest_coverage_ratio, debt_service_coverage_ratio
- book_value_per_share, tangible_book_value_per_share, cash_per_share
- operating_cash_flow_per_share, capex_per_share, revenue_per_share, net_income_per_share
- price_to_fair_value, debt_to_market_cap, effective_tax_rate, enterprise_value_multiple

Available operators: ">", "<", ">=", "<=", "==", "between"

For "between" operator, use "value" for the lower bound and "valueEnd" for the upper bound.

MARKET CAP CONVERSION RULES (values MUST be in billions):
- "$10B" or "10 billion" → value: 10
- "$200B" or "200 billion" → value: 200
- "$300M" or "300 million" → value: 0.3
- "$50M" → value: 0.05
- "$2T" or "2 trillion" → value: 2000
- "under X" or "below X" → operator: "<", value: X (in billions)
- "over X" or "above X" → operator: ">", value: X (in billions)
- "between X and Y" → operator: "between", value: X, valueEnd: Y (both in billions)

Market cap category definitions:
- Mega cap: market_cap > 200 (i.e. >$200B)
- Large cap: market_cap between 10 and 200
- Mid cap: market_cap between 2 and 10
- Small cap: market_cap between 0.3 and 2
- Micro cap: market_cap between 0.05 and 0.3

If something is ambiguous, make reasonable assumptions. For example:
- "low P/E" → pe_ratio < 15
- "high dividend" → dividend_yield > 0.03
- "large cap" → market_cap > 200
- "small cap" → market_cap < 2
- "mid cap" → market_cap between 2 and 10
- "growth stocks" → revenue_growth > 0.15
- "value stocks" → pe_ratio < 20 AND price_to_book < 3
- "low debt" → debt_to_equity < 0.5
- "high ROE" → roe > 0.15
- "profitable" → profit_margin > 0

IMPORTANT: Return ONLY the JSON object, no markdown formatting or explanation.`;

export function filtersToStructuredParams(params: StrategyParameters): StructuredParameters {
  const structured: StructuredParameters = {
    metrics: [],
    market_cap: { min: null, max: null },
    sectors: { include: [], exclude: [] },
    time_horizon: "20_years",
  };

  for (const filter of params.filters) {
    if (filter.metric === "market_cap") {
      if (filter.operator === ">" || filter.operator === ">=") {
        structured.market_cap.min = filter.value;
      } else if (filter.operator === "<" || filter.operator === "<=") {
        structured.market_cap.max = filter.value;
      } else if (filter.operator === "between") {
        structured.market_cap.min = filter.value;
        structured.market_cap.max = filter.valueEnd ?? null;
      }
      continue;
    }

    if (filter.metric === "sector") {
      const sectorName = SECTOR_REVERSE[filter.value];
      if (sectorName) {
        structured.sectors.include.push(sectorName);
      }
      continue;
    }

    structured.metrics.push({
      name: filter.metric,
      operator: filter.operator,
      value: filter.value,
      valueEnd: filter.valueEnd,
      period: "annual",
    });
  }

  return structured;
}

export function structuredParamsToFilters(structured: StructuredParameters): StockFilter[] {
  const filters: StockFilter[] = [];

  for (const metric of structured.metrics) {
    filters.push({
      metric: metric.name,
      operator: metric.operator as StockFilter["operator"],
      value: metric.value,
      valueEnd: metric.valueEnd,
    });
  }

  if (structured.market_cap.min !== null && structured.market_cap.max !== null) {
    filters.push({
      metric: "market_cap",
      operator: "between",
      value: structured.market_cap.min,
      valueEnd: structured.market_cap.max,
    });
  } else if (structured.market_cap.min !== null) {
    filters.push({ metric: "market_cap", operator: ">", value: structured.market_cap.min });
  } else if (structured.market_cap.max !== null) {
    filters.push({ metric: "market_cap", operator: "<", value: structured.market_cap.max });
  }

  const SECTOR_MAP: Record<string, number> = {
    Technology: 1,
    Healthcare: 2,
    Financial: 3,
    Energy: 4,
    Consumer: 5,
    Industrials: 6,
    "Basic Materials": 7,
    "Real Estate": 8,
    Utilities: 9,
    "Communication Services": 10,
  };

  for (const sector of structured.sectors.include) {
    const val = SECTOR_MAP[sector];
    if (val) {
      filters.push({ metric: "sector", operator: "==", value: val });
    }
  }

  return filters;
}

export async function parseStrategy(
  userInput: string
): Promise<StrategyParameters> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    const reason = "OpenAI API key not configured - using rule-based parser";
    console.warn(`[Parser] WARNING: ${reason}`);
    return fallbackParse(userInput, reason);
  }

  try {
    const openai = new OpenAI({ apiKey });

    const response = await openai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userInput },
      ],
      // gpt-5-mini is a reasoning model: no temperature/top_p support.
      // Use reasoning_effort to control cost/latency vs quality.
      reasoning_effort: "low",
      max_completion_tokens: 500,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      const reason = "OpenAI returned empty response - using rule-based parser";
      console.error(`[Parser] ERROR: ${reason}`);
      return fallbackParse(userInput, reason);
    }

    let parsed: StrategyParameters;
    try {
      parsed = JSON.parse(content) as StrategyParameters;
    } catch (jsonError) {
      const reason = `OpenAI response was not valid JSON - using rule-based parser. Response: ${content.substring(0, 100)}`;
      console.error(`[Parser] ERROR: JSON parsing failed:`, jsonError);
      console.error(`[Parser] OpenAI response was:`, content);
      return fallbackParse(userInput, reason);
    }

    // Validate that we got filters
    if (!parsed.filters || !Array.isArray(parsed.filters) || parsed.filters.length === 0) {
      const reason = "OpenAI returned no filters - using rule-based parser";
      console.warn(`[Parser] WARNING: ${reason}`);
      return fallbackParse(userInput, reason);
    }

    // Fuzzy-match any unrecognized metric names from AI response
    const validMetrics = new Set(Object.keys(METRIC_ALIASES));
    for (const filter of parsed.filters) {
      if (!validMetrics.has(filter.metric)) {
        const matched = fuzzyMatchMetric(filter.metric);
        if (matched) {
          console.log(`[Parser] Fuzzy-matched metric "${filter.metric}" -> "${matched}"`);
          filter.metric = matched;
        } else {
          console.warn(`[Parser] Unknown metric from AI: "${filter.metric}" - removing filter`);
        }
      }
    }

    // Remove filters with unrecognized metrics
    parsed.filters = parsed.filters.filter(f => validMetrics.has(f.metric));

    if (parsed.filters.length === 0) {
      const reason = "All AI-parsed filters had unrecognized metrics - using rule-based parser";
      console.warn(`[Parser] WARNING: ${reason}`);
      return fallbackParse(userInput, reason);
    }

    normalizeMarketCapValues(parsed);
    parsed.parsingMethod = "ai";
    parsed.warnings = parsed.warnings || [];

    console.log("[Parser] Successfully parsed with OpenAI GPT");
    console.log("[Parser] Parsed filters:", JSON.stringify(parsed.filters, null, 2));
    return parsed;
  } catch (error) {
    const reason = `OpenAI API call failed: ${error instanceof Error ? error.message : String(error)} - using rule-based parser`;
    console.error(`[Parser] ERROR: ${reason}`);
    console.error("[Parser] Full error:", error);
    return fallbackParse(userInput, reason);
  }
}

// Normalize market cap values to billions.
// If OpenAI returns raw dollar values (e.g. 10000000000 instead of 10),
// convert them to billions to match our stock database format.
function normalizeMarketCapValues(params: StrategyParameters): void {
  if (!params.warnings) {
    params.warnings = [];
  }

  for (const filter of params.filters) {
    if (filter.metric === "market_cap") {
      // If value is >= 1000, it's likely in raw dollars or millions instead of billions
      // Our database max is ~3400 (NVDA at $3.4T), so any value > 5000 is certainly wrong
      if (filter.value > 5000) {
        const original = filter.value;
        filter.value = filter.value / 1_000_000_000;
        const warning = `Market cap value auto-corrected from ${original} to ${filter.value}B (OpenAI returned incorrect units)`;
        console.warn(`[Parser] WARNING: ${warning}`);
        params.warnings.push(warning);
      }
      if (filter.valueEnd !== undefined && filter.valueEnd !== null && filter.valueEnd > 5000) {
        const original = filter.valueEnd;
        filter.valueEnd = filter.valueEnd / 1_000_000_000;
        const warning = `Market cap upper bound auto-corrected from ${original} to ${filter.valueEnd}B (OpenAI returned incorrect units)`;
        console.warn(`[Parser] WARNING: ${warning}`);
        params.warnings.push(warning);
      }
    }
  }
}

// Rule-based fallback parser for when OpenAI is unavailable
function fallbackParse(input: string, reason: string): StrategyParameters {
  const lower = input.toLowerCase();
  const filters: StockFilter[] = [];
  let description = input;
  const warnings: string[] = [reason];

  // P/E ratio patterns
  const peMatch = lower.match(/p\/e\s*(?:ratio\s*)?(?:under|below|less than|<)\s*(\d+)/);
  if (peMatch) {
    filters.push({ metric: "pe_ratio", operator: "<", value: parseFloat(peMatch[1]) });
  }
  if (lower.includes("low p/e") || lower.includes("low pe")) {
    if (!peMatch) filters.push({ metric: "pe_ratio", operator: "<", value: 15 });
  }
  const peOverMatch = lower.match(/p\/e\s*(?:ratio\s*)?(?:over|above|greater than|>)\s*(\d+)/);
  if (peOverMatch) {
    filters.push({ metric: "pe_ratio", operator: ">", value: parseFloat(peOverMatch[1]) });
  }

  // Dividend yield patterns
  const divMatch = lower.match(/dividend\s*yield\s*(?:over|above|greater than|>)\s*(\d+(?:\.\d+)?)\s*%/);
  if (divMatch) {
    filters.push({ metric: "dividend_yield", operator: ">", value: parseFloat(divMatch[1]) / 100 });
  }
  if (lower.includes("high dividend") && !divMatch) {
    filters.push({ metric: "dividend_yield", operator: ">", value: 0.03 });
  }

  // Dividend growth patterns
  const divGrowthMatch = lower.match(/(\d+)\+?\s*years?\s*(?:of\s*)?(?:consecutive\s*)?dividend\s*growth/);
  if (divGrowthMatch) {
    filters.push({ metric: "dividend_growth_years", operator: ">=", value: parseFloat(divGrowthMatch[1]) });
  }
  if (lower.includes("dividend aristocrat")) {
    filters.push({ metric: "dividend_growth_years", operator: ">=", value: 25 });
  }

  // Revenue growth patterns
  const revMatch = lower.match(/revenue\s*growth\s*(?:over|above|greater than|>)\s*(\d+(?:\.\d+)?)\s*%/);
  if (revMatch) {
    filters.push({ metric: "revenue_growth", operator: ">", value: parseFloat(revMatch[1]) / 100 });
  }
  const revQuarterMatch = lower.match(/(\d+)\+?\s*consecutive\s*quarters?\s*(?:of\s*)?revenue\s*growth/);
  if (revQuarterMatch) {
    filters.push({ metric: "revenue_growth_quarters", operator: ">=", value: parseFloat(revQuarterMatch[1]) });
  }

  // Earnings growth patterns
  const earningsMatch = lower.match(/earnings\s*growth\s*(?:over|above|greater than|>)\s*(\d+(?:\.\d+)?)\s*%/);
  if (earningsMatch) {
    filters.push({ metric: "earnings_growth", operator: ">", value: parseFloat(earningsMatch[1]) / 100 });
  }

  // Market cap patterns - values in billions
  const mcapBMatch = lower.match(/(?:market\s*cap|under|below)\s*(?:under|below|less than|<)?\s*\$?(\d+(?:\.\d+)?)\s*b/i);
  if (mcapBMatch) {
    filters.push({ metric: "market_cap", operator: "<", value: parseFloat(mcapBMatch[1]) });
  }
  const mcapMMatch = lower.match(/(?:market\s*cap|under|below)\s*(?:under|below|less than|<)?\s*\$?(\d+(?:\.\d+)?)\s*m/i);
  if (mcapMMatch && !mcapBMatch) {
    filters.push({ metric: "market_cap", operator: "<", value: parseFloat(mcapMMatch[1]) / 1000 });
  }
  const mcapOverMatch = lower.match(/market\s*cap\s*(?:over|above|greater than|>)\s*\$?(\d+(?:\.\d+)?)\s*b/i);
  if (mcapOverMatch) {
    filters.push({ metric: "market_cap", operator: ">", value: parseFloat(mcapOverMatch[1]) });
  }

  // Named market cap categories
  if (lower.includes("small cap") && !mcapBMatch && !mcapMMatch) {
    filters.push({ metric: "market_cap", operator: "<", value: 2 });
  } else if (lower.includes("micro cap") && !mcapBMatch && !mcapMMatch) {
    filters.push({ metric: "market_cap", operator: "<", value: 0.3 });
  } else if (lower.includes("mid cap") && !mcapBMatch && !mcapOverMatch) {
    filters.push({ metric: "market_cap", operator: "between", value: 2, valueEnd: 10 });
  } else if (lower.includes("large cap") && !mcapOverMatch) {
    filters.push({ metric: "market_cap", operator: ">", value: 200 });
  } else if (lower.includes("mega cap") && !mcapOverMatch) {
    filters.push({ metric: "market_cap", operator: ">", value: 200 });
  }

  // Profit margin patterns
  const marginMatch = lower.match(/profit\s*margins?\s*(?:over|above|greater than|>)\s*(\d+(?:\.\d+)?)\s*%/);
  if (marginMatch) {
    filters.push({ metric: "profit_margin", operator: ">", value: parseFloat(marginMatch[1]) / 100 });
  }

  // ROE patterns
  const roeMatch = lower.match(/roe\s*(?:over|above|greater than|>)\s*(\d+(?:\.\d+)?)\s*%/);
  if (roeMatch) {
    filters.push({ metric: "roe", operator: ">", value: parseFloat(roeMatch[1]) / 100 });
  }
  if (lower.includes("high roe") && !roeMatch) {
    filters.push({ metric: "roe", operator: ">", value: 0.15 });
  }

  // Debt to equity patterns
  const deMatch = lower.match(/debt[\s-]*(?:to[\s-]*)?equity\s*(?:under|below|less than|<)\s*(\d+(?:\.\d+)?)/);
  if (deMatch) {
    filters.push({ metric: "debt_to_equity", operator: "<", value: parseFloat(deMatch[1]) });
  }
  if (lower.includes("low debt") && !deMatch) {
    filters.push({ metric: "debt_to_equity", operator: "<", value: 0.5 });
  }

  // Current ratio patterns
  const crMatch = lower.match(/current\s*ratio\s*(?:over|above|greater than|>)\s*(\d+(?:\.\d+)?)/);
  if (crMatch) {
    filters.push({ metric: "current_ratio", operator: ">", value: parseFloat(crMatch[1]) });
  }

  // Price to book patterns
  const pbMatch = lower.match(/(?:price[\s-]*to[\s-]*book|p\/b)\s*(?:under|below|less than|<)\s*(\d+(?:\.\d+)?)/);
  if (pbMatch) {
    filters.push({ metric: "price_to_book", operator: "<", value: parseFloat(pbMatch[1]) });
  }

  // Beta patterns
  const betaMatch = lower.match(/beta\s*(?:under|below|less than|<)\s*(\d+(?:\.\d+)?)/);
  if (betaMatch) {
    filters.push({ metric: "beta", operator: "<", value: parseFloat(betaMatch[1]) });
  }
  if (lower.includes("low beta") || lower.includes("low volatility")) {
    if (!betaMatch) filters.push({ metric: "beta", operator: "<", value: 0.8 });
  }

  // Payout ratio patterns
  const payoutMatch = lower.match(/payout\s*ratio\s*(?:under|below|less than|<)\s*(\d+(?:\.\d+)?)\s*%/);
  if (payoutMatch) {
    filters.push({ metric: "payout_ratio", operator: "<", value: parseFloat(payoutMatch[1]) / 100 });
  }

  // Positive earnings
  if (lower.includes("positive earnings") || lower.includes("profitable")) {
    filters.push({ metric: "profit_margin", operator: ">", value: 0 });
  }

  // 52-week high
  if (lower.includes("52-week high") || lower.includes("52 week high")) {
    filters.push({ metric: "week52_high_pct", operator: ">=", value: 0.95 });
  }

  // Value stocks composite
  if (lower.includes("value stock")) {
    if (!peMatch && !peOverMatch) filters.push({ metric: "pe_ratio", operator: "<", value: 20 });
    if (!pbMatch) filters.push({ metric: "price_to_book", operator: "<", value: 3 });
  }

  // Growth stocks composite
  if (lower.includes("growth stock") && !revMatch) {
    filters.push({ metric: "revenue_growth", operator: ">", value: 0.15 });
  }

  // Sector patterns
  if (lower.includes("tech")) {
    filters.push({ metric: "sector", operator: "==", value: 1 });
  }
  if (lower.includes("healthcare") || lower.includes("health care") || lower.includes("pharma")) {
    filters.push({ metric: "sector", operator: "==", value: 2 });
  }
  if (lower.includes("financial") || lower.includes("banking") || lower.includes("bank")) {
    filters.push({ metric: "sector", operator: "==", value: 3 });
  }
  if (lower.includes("energy") || lower.includes("oil")) {
    filters.push({ metric: "sector", operator: "==", value: 4 });
  }
  if (lower.includes("consumer")) {
    filters.push({ metric: "sector", operator: "==", value: 5 });
  }

  // If no filters matched, add a generic growth filter
  if (filters.length === 0) {
    description = input + " (interpreted as general growth stocks)";
    filters.push({ metric: "revenue_growth", operator: ">", value: 0.10 });
    filters.push({ metric: "pe_ratio", operator: "<", value: 30 });
    warnings.push("No specific patterns matched - using generic growth stock filter");
  }

  return { description, filters, warnings, parsingMethod: "fallback" };
}
