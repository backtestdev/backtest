import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export const dynamic = "force-dynamic";

/**
 * Derive shares and cost basis from redundant extracted fields.
 *
 * Priority order:
 *   Shares  → currentValue ÷ lastPrice  (most reliable — two independent reads)
 *           → quantity                    (direct read, but GPT sometimes misreads)
 *           → totalCostBasis ÷ costBasisPerShare (last resort)
 *
 *   CostBasis → costBasisPerShare          (direct read — no math, no error propagation)
 *             → totalCostBasis ÷ shares    (only if costBasisPerShare missing)
 *
 * When derivedShares and quantity disagree significantly, we use a three-way
 * vote with totalCostBasis ÷ costBasisPerShare to break the tie.
 */
function crossValidate(raw: {
  symbol: string;
  quantity: number | null;
  lastPrice: number | null;
  currentValue: number | null;
  totalCostBasis: number | null;
  costBasisPerShare: number | null;
}): { symbol: string; shares: number; costBasis: number | null; lastPrice: number | null } {
  const { symbol, quantity, lastPrice, currentValue, totalCostBasis, costBasisPerShare } = raw;

  // ── Step 1: Derive shares ──
  const derivedFromPrice =
    currentValue != null && currentValue > 0 && lastPrice != null && lastPrice > 0
      ? currentValue / lastPrice
      : null;
  const derivedFromCost =
    totalCostBasis != null && totalCostBasis > 0 && costBasisPerShare != null && costBasisPerShare > 0
      ? totalCostBasis / costBasisPerShare
      : null;

  let shares = 0;

  if (derivedFromPrice !== null) {
    // Primary source available — but sanity-check against quantity if present
    if (
      quantity != null &&
      quantity > 0 &&
      Math.abs(derivedFromPrice - quantity) / Math.max(derivedFromPrice, quantity) > 0.02
    ) {
      // Significant disagreement (>2%) — use third source as tiebreaker
      if (derivedFromCost !== null) {
        const priceAgreesWithCost =
          Math.abs(derivedFromCost - derivedFromPrice) / Math.max(derivedFromCost, derivedFromPrice) < 0.02;
        const quantityAgreesWithCost =
          Math.abs(derivedFromCost - quantity) / Math.max(derivedFromCost, quantity) < 0.02;

        if (priceAgreesWithCost) {
          shares = derivedFromPrice; // price + cost agree
        } else if (quantityAgreesWithCost) {
          shares = quantity; // quantity + cost agree
        } else {
          shares = derivedFromPrice; // no consensus, trust price derivation
        }
      } else {
        shares = derivedFromPrice; // no cost data, trust price derivation
      }
    } else {
      shares = derivedFromPrice; // agrees with quantity or quantity not available
    }
  } else if (quantity != null && quantity > 0) {
    shares = quantity;
  } else if (derivedFromCost !== null) {
    shares = derivedFromCost;
  }

  shares = Math.round(shares * 1000) / 1000;

  // ── Step 2: Derive cost basis — ALWAYS prefer directly-read per-share ──
  let costBasis: number | null = null;

  if (costBasisPerShare != null && costBasisPerShare > 0) {
    costBasis = Math.round(costBasisPerShare * 100) / 100;
  } else if (totalCostBasis != null && totalCostBasis > 0 && shares > 0) {
    // Fallback: totalCostBasis ÷ shares
    // Guard: reject if totalCostBasis ≈ currentValue (column confusion)
    const looksLikeCurrentValue =
      currentValue != null &&
      currentValue > 0 &&
      Math.abs(totalCostBasis - currentValue) / currentValue < 0.05;
    if (!looksLikeCurrentValue) {
      costBasis = Math.round((totalCostBasis / shares) * 100) / 100;
    }
  }

  return { symbol, shares, costBasis, lastPrice: lastPrice || null };
}

/**
 * Portfolio-level sanity check: if the majority of holdings have
 * costBasis ≈ lastPrice, the model confused the price column with
 * the cost basis column. Null out all cost bases rather than show
 * confidently wrong data.
 */
function portfolioSanityCheck(
  holdings: Array<{ symbol: string; shares: number; costBasis: number | null; lastPrice: number | null }>
): Array<{ symbol: string; shares: number; costBasis: number | null }> {
  const withBoth = holdings.filter(
    (h) => h.costBasis !== null && h.lastPrice !== null && h.lastPrice > 0
  );

  if (withBoth.length >= 2) {
    const matchCount = withBoth.filter((h) => {
      const diff = Math.abs(h.costBasis! - h.lastPrice!) / h.lastPrice!;
      return diff < 0.05;
    }).length;

    if (matchCount / withBoth.length > 0.6) {
      console.warn(
        `[parse-image] Column confusion detected: ${matchCount}/${withBoth.length} ` +
          `holdings have costBasis ≈ lastPrice. Nulling all cost bases.`
      );
      return holdings.map((h) => ({
        symbol: h.symbol,
        shares: h.shares,
        costBasis: null,
      }));
    }
  }

  return holdings.map((h) => ({
    symbol: h.symbol,
    shares: h.shares,
    costBasis: h.costBasis,
  }));
}

export async function POST(request: NextRequest) {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    return NextResponse.json({ error: "OpenAI not configured" }, { status: 503 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("image") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No image uploaded" }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const base64 = Buffer.from(bytes).toString("base64");
    const mimeType = file.type || "image/png";

    const openai = new OpenAI({ apiKey: openaiKey });

    const response = await openai.chat.completions.create({
      model: "gpt-4.1",
      max_tokens: 8000,
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content: `You are a precise financial data extractor. Extract portfolio holdings from brokerage screenshots.

═══════════════════════════════════════════
CRITICAL — COLUMN DISTINCTION
═══════════════════════════════════════════

"Last Price" = CURRENT market price (what the stock trades at today).
"Cost Basis" = what the investor ORIGINALLY PAID (purchase price).
These are DIFFERENT columns with DIFFERENT values.

═══════════════════════════════════════════
STEP 1: IDENTIFY LAYOUT
═══════════════════════════════════════════
1. Identify the brokerage (Fidelity, Schwab, Vanguard, etc.)
2. List ALL column headers left to right
3. Map each column to its data type

═══════════════════════════════════════════
STEP 2: ROW-BY-ROW EXTRACTION
═══════════════════════════════════════════
For each row, write out values column by column:
"[SYMBOL]: Price=$X | Value=$Y | Qty=Z | CB Total=$A | CB/Share=$B"

═══════════════════════════════════════════
FIDELITY SPECIFICS
═══════════════════════════════════════════
Column order: Symbol | Description | Last Price | Change | Current Value | Quantity | Cost Basis | Gain/Loss

STACKED CELLS (two lines per cell):
• "Cost Basis" cell:
  - TOP line = TOTAL cost basis (e.g., $14,775.00)
  - BOTTOM line = per-share cost, has "/ Share" or "/Share" suffix (e.g., $49.25 / Share)
  The TOP number is ALWAYS LARGER than the bottom when shares > 1.
• "Gain/Loss" cell: TOP = dollars, BOTTOM = percentage
• "Quantity": 3 decimal places for fractional shares (119.808, NOT 119808)

CRITICAL: Read the per-share cost from the BOTTOM of the Cost Basis cell.
It will have "/ Share" next to it. This is your costBasisPerShare field.
The TOP number is totalCostBasis.

IMPORTANT — DECIMAL POINTS:
• Quantity ALWAYS has 3 decimal places (e.g., 195.217, not 1952, not 1990)
• If a quantity looks like a large integer (>1000), re-examine for a missed decimal

SKIP: SPAXX, FCASH, FDRXX (cash), pending activity, totals.
Same ticker multiple times = separate tax lots → separate entries.

═══════════════════════════════════════════
EMPLOYER / 401k PLANS
═══════════════════════════════════════════
Map fund descriptions to ETF proxies:
"S&P 500"/"500 INDEX" → "VOO", "TOTAL MARKET" → "VTI",
"GROWTH" → "VUG", "BOND"/"FIXED INCOME" → "BND",
"INTERNATIONAL" → "VXUS"

═══════════════════════════════════════════
OTHER BROKERAGES
═══════════════════════════════════════════
Extract visible fields. Use null for missing.

═══════════════════════════════════════════
STEP 3: VERIFY BEFORE OUTPUT
═══════════════════════════════════════════
For EVERY row, check:
✓ quantity × lastPrice ≈ currentValue (within 5%)
  — If NOT, your quantity is likely wrong. Re-read it.
✓ totalCostBasis ÷ quantity ≈ costBasisPerShare (within 5%)
  — If NOT, re-read the cost basis cell (top = total, bottom = per-share).
✓ costBasisPerShare ≠ lastPrice for most rows.

═══════════════════════════════════════════
OUTPUT
═══════════════════════════════════════════
JSON array with ALL fields per row:
[{"symbol":"AAPL","quantity":119.808,"lastPrice":182.50,"currentValue":21870.96,"totalCostBasis":6507.43,"costBasisPerShare":54.30}, ...]
Use null for any field not visible.`,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Extract all holdings from this brokerage screenshot.

1. Identify brokerage and columns
2. Extract each row — read EVERY numeric field carefully
3. Verify: quantity × lastPrice ≈ currentValue for each row
4. Output JSON array`,
            },
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${base64}`,
                detail: "high",
              },
            },
          ],
        },
      ],
    });

    const content = response.choices[0]?.message?.content || "[]";

    // Extract JSON array from response
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return NextResponse.json({ holdings: [], raw: content });
    }

    const rawHoldings: Array<{
      symbol: string;
      quantity: number | null;
      lastPrice: number | null;
      currentValue: number | null;
      totalCostBasis: number | null;
      costBasisPerShare: number | null;
    }> = JSON.parse(jsonMatch[0]);

    // Per-holding cross-validation
    const validated = rawHoldings.map((h) => crossValidate(h));

    // Portfolio-level sanity check
    const holdings = portfolioSanityCheck(validated);

    return NextResponse.json({ holdings });
  } catch (error) {
    console.error("Image parsing error:", error);
    return NextResponse.json({ error: "Failed to parse image" }, { status: 500 });
  }
}
