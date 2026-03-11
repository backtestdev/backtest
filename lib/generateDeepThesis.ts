import OpenAI from "openai";

/**
 * Generates a 400-600 word analyst-quality investment write-up using GPT.
 * Called when new signal picks are created.
 */

interface StockData {
  symbol: string;
  name: string;
  sector: string;
  industry: string;
  marketCapB: number;
  score: number;
  earningsYield: number | null;
  roe: number | null;
  profitMargin: number | null;
  revenueGrowth: number | null;
  earningsGrowth: number | null;
  consecutiveEarningsGrowth: number;
  peRatio: number | null;
  debtToEquity: number | null;
  currentRatio: number | null;
  dividendYield: number | null;
  freeCashFlowYield: number | null;
  beta: number | null;
  priceToBook: number | null;
  pegRatio: number | null;
  evToEbitda: number | null;
  roic: number | null;
}

const SYSTEM_PROMPT = `You are a senior equity research analyst writing a concise investment thesis for individual investors. Write in a confident, analytical tone. Be specific — avoid generic filler. Structure your response with these sections using markdown headers:

## Executive Summary
2-3 sentences on why this stock stands out quantitatively and qualitatively.

## Why Now
What catalyst, timing, or inflection point makes this compelling today? Reference the sector/industry dynamics.

## Competitive Moat
What structural advantage does this company have? Be specific about the business model.

## Key Metrics That Stand Out
Highlight 3-4 metrics from the data that are genuinely impressive relative to peers. Explain why each matters.

## Primary Risks
2-3 specific risks investors should monitor. Be honest and specific, not generic.

## Valuation Context
Is the stock cheap, fair, or expensive relative to its quality? Reference P/E, EV/EBITDA, or earnings yield as appropriate.

Target 400-500 words total. Do not use bullet points — write in paragraphs. Do not include disclaimers or "not financial advice" language.`;

function buildMetricsString(stock: StockData): string {
  const lines: string[] = [];
  lines.push(`Symbol: ${stock.symbol}`);
  lines.push(`Company: ${stock.name}`);
  lines.push(`Sector: ${stock.sector} | Industry: ${stock.industry}`);
  lines.push(`Market Cap: $${stock.marketCapB.toFixed(1)}B`);
  lines.push(`Quant Score: ${stock.score}/100`);
  if (stock.peRatio != null) lines.push(`P/E Ratio: ${stock.peRatio.toFixed(1)}`);
  if (stock.priceToBook != null) lines.push(`Price/Book: ${stock.priceToBook.toFixed(2)}`);
  if (stock.pegRatio != null) lines.push(`PEG Ratio: ${stock.pegRatio.toFixed(2)}`);
  if (stock.evToEbitda != null) lines.push(`EV/EBITDA: ${stock.evToEbitda.toFixed(1)}`);
  if (stock.earningsYield != null) lines.push(`Earnings Yield: ${(stock.earningsYield * 100).toFixed(1)}%`);
  if (stock.roe != null) lines.push(`ROE: ${(stock.roe * 100).toFixed(1)}%`);
  if (stock.roic != null) lines.push(`ROIC: ${(stock.roic * 100).toFixed(1)}%`);
  if (stock.profitMargin != null) lines.push(`Net Profit Margin: ${(stock.profitMargin * 100).toFixed(1)}%`);
  if (stock.revenueGrowth != null) lines.push(`Revenue Growth YoY: ${(stock.revenueGrowth * 100).toFixed(1)}%`);
  if (stock.earningsGrowth != null) lines.push(`Earnings Growth YoY: ${(stock.earningsGrowth * 100).toFixed(1)}%`);
  if (stock.consecutiveEarningsGrowth >= 1) lines.push(`Consecutive Years of Earnings Growth: ${stock.consecutiveEarningsGrowth}`);
  if (stock.dividendYield != null) lines.push(`Dividend Yield: ${(stock.dividendYield * 100).toFixed(2)}%`);
  if (stock.freeCashFlowYield != null) lines.push(`Free Cash Flow Yield: ${(stock.freeCashFlowYield * 100).toFixed(1)}%`);
  if (stock.debtToEquity != null) lines.push(`Debt/Equity: ${stock.debtToEquity.toFixed(2)}`);
  if (stock.currentRatio != null) lines.push(`Current Ratio: ${stock.currentRatio.toFixed(2)}`);
  if (stock.beta != null) lines.push(`Beta: ${stock.beta.toFixed(2)}`);
  return lines.join("\n");
}

export async function generateDeepThesis(stock: StockData): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("[deep-thesis] No OPENAI_API_KEY configured, skipping deep thesis generation");
    return null;
  }

  const metrics = buildMetricsString(stock);
  const userPrompt = `Given the following fundamental data for ${stock.symbol} (${stock.name}), write a 400-500 word investment pitch that explains WHY this stock scores ${stock.score}/100 on our quantitative model and what the qualitative story is. Be specific about competitive positioning, industry dynamics, and near-term catalysts. Avoid generic language.\n\nData:\n${metrics}`;

  try {
    const openai = new OpenAI({ apiKey });
    const response = await openai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      // gpt-5-mini is a reasoning model: no temperature/top_p support
      reasoning_effort: "low",
      max_completion_tokens: 4096,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      console.error("[deep-thesis] OpenAI returned empty response for", stock.symbol);
      return null;
    }

    return content.trim();
  } catch (error) {
    console.error(`[deep-thesis] Failed to generate deep thesis for ${stock.symbol}:`, error);
    return null;
  }
}
