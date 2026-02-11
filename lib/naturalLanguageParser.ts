import OpenAI from "openai";
import { StrategyParameters, StockFilter, StructuredParameters } from "./types";

const SECTOR_REVERSE: Record<number, string> = {
  1: "Technology",
  2: "Healthcare",
  3: "Financial",
  4: "Energy",
  5: "Consumer",
};

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
- roe (return on equity as decimal)
- payout_ratio (dividend payout ratio as decimal)
- beta
- week52_high_pct (percentage of 52-week high, 1.0 = at the high)
- sector (use value 1 for tech, 2 for healthcare, 3 for finance, 4 for energy, 5 for consumer)

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
    return fallbackParse(userInput);
  }

  try {
    const openai = new OpenAI({ apiKey });

    const response = await openai.chat.completions.create({
      model: "gpt-5.1-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userInput },
      ],
      temperature: 0.1,
      max_tokens: 500,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("Empty response from OpenAI");

    const parsed = JSON.parse(content) as StrategyParameters;
    normalizeMarketCapValues(parsed);
    console.log("[Parser] Parsed filters:", JSON.stringify(parsed.filters, null, 2));
    return parsed;
  } catch (error) {
    console.error("OpenAI parsing failed, using fallback:", error);
    return fallbackParse(userInput);
  }
}

// Normalize market cap values to billions.
// If OpenAI returns raw dollar values (e.g. 10000000000 instead of 10),
// convert them to billions to match our stock database format.
function normalizeMarketCapValues(params: StrategyParameters): void {
  for (const filter of params.filters) {
    if (filter.metric === "market_cap") {
      // If value is >= 1000, it's likely in raw dollars or millions instead of billions
      // Our database max is ~3400 (NVDA at $3.4T), so any value > 5000 is certainly wrong
      if (filter.value > 5000) {
        const original = filter.value;
        filter.value = filter.value / 1_000_000_000;
        console.log(`[Parser] Normalized market_cap value from ${original} to ${filter.value} (converted to billions)`);
      }
      if (filter.valueEnd !== undefined && filter.valueEnd !== null && filter.valueEnd > 5000) {
        const original = filter.valueEnd;
        filter.valueEnd = filter.valueEnd / 1_000_000_000;
        console.log(`[Parser] Normalized market_cap valueEnd from ${original} to ${filter.valueEnd} (converted to billions)`);
      }
    }
  }
}

// Rule-based fallback parser for when OpenAI is unavailable
function fallbackParse(input: string): StrategyParameters {
  const lower = input.toLowerCase();
  const filters: StockFilter[] = [];
  let description = input;

  // P/E ratio patterns
  const peMatch = lower.match(/p\/e\s*(?:ratio\s*)?(?:under|below|less than|<)\s*(\d+)/);
  if (peMatch) {
    filters.push({ metric: "pe_ratio", operator: "<", value: parseFloat(peMatch[1]) });
  }
  if (lower.includes("low p/e") || lower.includes("low pe")) {
    filters.push({ metric: "pe_ratio", operator: "<", value: 15 });
  }

  // Dividend yield patterns
  const divMatch = lower.match(/dividend\s*yield\s*(?:over|above|greater than|>)\s*(\d+(?:\.\d+)?)\s*%/);
  if (divMatch) {
    filters.push({ metric: "dividend_yield", operator: ">", value: parseFloat(divMatch[1]) / 100 });
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

  // Payout ratio patterns
  const payoutMatch = lower.match(/payout\s*ratio\s*(?:under|below|less than|<)\s*(\d+(?:\.\d+)?)\s*%/);
  if (payoutMatch) {
    filters.push({ metric: "payout_ratio", operator: "<", value: parseFloat(payoutMatch[1]) / 100 });
  }

  // Positive earnings
  if (lower.includes("positive earnings")) {
    filters.push({ metric: "earnings_growth", operator: ">", value: 0 });
  }

  // 52-week high
  if (lower.includes("52-week high") || lower.includes("52 week high")) {
    filters.push({ metric: "week52_high_pct", operator: ">=", value: 0.95 });
  }

  // Tech sector
  if (lower.includes("tech")) {
    filters.push({ metric: "sector", operator: "==", value: 1 });
  }

  // If no filters matched, add a generic growth filter
  if (filters.length === 0) {
    description = input + " (interpreted as general growth stocks)";
    filters.push({ metric: "revenue_growth", operator: ">", value: 0.10 });
    filters.push({ metric: "pe_ratio", operator: "<", value: 30 });
  }

  return { description, filters };
}
