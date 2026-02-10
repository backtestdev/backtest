import OpenAI from "openai";
import { StrategyParameters, StockFilter } from "./types";

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
- market_cap (in billions, e.g. 10 for $10B)
- price_to_book
- debt_to_equity
- roe (return on equity as decimal)
- payout_ratio (dividend payout ratio as decimal)
- beta
- week52_high_pct (percentage of 52-week high, 1.0 = at the high)
- sector (use value 1 for tech, 2 for healthcare, 3 for finance, 4 for energy, 5 for consumer)

Available operators: ">", "<", ">=", "<=", "==", "between"

For "between" operator, use "value" for the lower bound and "valueEnd" for the upper bound.

If something is ambiguous, make reasonable assumptions. For example:
- "low P/E" → pe_ratio < 15
- "high dividend" → dividend_yield > 0.03
- "large cap" → market_cap > 100
- "small cap" → market_cap < 10
- "mid cap" → market_cap between 10 and 100
- "growth stocks" → revenue_growth > 0.15
- "value stocks" → pe_ratio < 20 AND price_to_book < 3

IMPORTANT: Return ONLY the JSON object, no markdown formatting or explanation.`;

export async function parseStrategy(
  userInput: string
): Promise<StrategyParameters> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    // Fall back to rule-based parsing if no API key
    return fallbackParse(userInput);
  }

  try {
    const openai = new OpenAI({ apiKey });

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userInput },
      ],
      temperature: 0.1,
      max_tokens: 500,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("Empty response from OpenAI");

    const parsed = JSON.parse(content);
    return parsed as StrategyParameters;
  } catch (error) {
    console.error("OpenAI parsing failed, using fallback:", error);
    return fallbackParse(userInput);
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

  // Market cap patterns
  const mcapMatch = lower.match(/market\s*cap\s*(?:under|below|less than|<)\s*\$?(\d+(?:\.\d+)?)\s*b/i);
  if (mcapMatch) {
    filters.push({ metric: "market_cap", operator: "<", value: parseFloat(mcapMatch[1]) });
  }
  const mcapOverMatch = lower.match(/market\s*cap\s*(?:over|above|greater than|>)\s*\$?(\d+(?:\.\d+)?)\s*b/i);
  if (mcapOverMatch) {
    filters.push({ metric: "market_cap", operator: ">", value: parseFloat(mcapOverMatch[1]) });
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
