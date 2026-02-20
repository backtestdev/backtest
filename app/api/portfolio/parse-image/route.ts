import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export const dynamic = "force-dynamic";

/**
 * Cross-validate extracted values using redundant data from the table.
 * Detects column confusion (e.g., currentValue mistaken for totalCostBasis)
 * and resolves conflicts between multiple cost basis sources.
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

  // ── Derive shares from multiple sources ──
  const candidates: number[] = [];

  if (quantity && quantity > 0) {
    candidates.push(quantity);
  }
  if (currentValue && lastPrice && lastPrice > 0) {
    candidates.push(Math.round((currentValue / lastPrice) * 1000) / 1000);
  }
  if (totalCostBasis && costBasisPerShare && costBasisPerShare > 0) {
    candidates.push(Math.round((totalCostBasis / costBasisPerShare) * 1000) / 1000);
  }

  let shares = quantity || 0;

  if (candidates.length >= 2) {
    let bestCount = 0;
    let bestValue = candidates[0];
    for (const c of candidates) {
      let count = 0;
      for (const other of candidates) {
        if (other > 0 && Math.abs(c - other) / other < 0.01) count++;
      }
      if (count > bestCount) {
        bestCount = count;
        bestValue = c;
      }
    }
    shares = bestValue;
  } else if (candidates.length === 1) {
    shares = candidates[0];
  }

  // ── Detect column confusion at the totals level ──
  // If totalCostBasis ≈ currentValue, GPT likely read the "Current Value"
  // column instead of the "Cost Basis" column. Don't trust it.
  const totalCbLooksLikeCurrentValue =
    totalCostBasis != null && currentValue != null && currentValue > 0 &&
    Math.abs(totalCostBasis - currentValue) / currentValue < 0.05;

  const trustedTotalCb = totalCbLooksLikeCurrentValue ? null : totalCostBasis;

  // ── Derive cost basis per share from two sources ──
  const cbFromDivision =
    trustedTotalCb != null && shares > 0
      ? Math.round((trustedTotalCb / shares) * 100) / 100
      : null;
  const cbDirect =
    costBasisPerShare != null
      ? Math.round(costBasisPerShare * 100) / 100
      : null;

  // Check if a value suspiciously matches the current market price
  const isNearLastPrice = (val: number | null): boolean => {
    if (val == null || !lastPrice || lastPrice <= 0) return false;
    return Math.abs(val - lastPrice) / lastPrice < 0.03;
  };

  let costBasis: number | null = null;

  if (cbFromDivision !== null && cbDirect !== null) {
    const agree =
      Math.abs(cbFromDivision - cbDirect) / Math.max(cbFromDivision, cbDirect) < 0.05;

    if (agree) {
      // Both sources agree — use direct read (less math, fewer error propagation)
      costBasis = cbDirect;
    } else {
      // They disagree — prefer the one that does NOT equal the current price.
      // If costBasis = lastPrice, it's almost certainly column confusion.
      const divMatchesPrice = isNearLastPrice(cbFromDivision);
      const directMatchesPrice = isNearLastPrice(cbDirect);

      if (divMatchesPrice && !directMatchesPrice) {
        costBasis = cbDirect;
      } else if (!divMatchesPrice && directMatchesPrice) {
        costBasis = cbFromDivision;
      } else {
        // Both or neither match — prefer direct per-share reading
        costBasis = cbDirect;
      }
    }
  } else if (cbFromDivision !== null) {
    costBasis = cbFromDivision;
  } else if (cbDirect !== null) {
    costBasis = cbDirect;
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
      return diff < 0.05; // within 5%
    }).length;

    // If > 60% of holdings have costBasis ≈ lastPrice, it's column confusion
    if (matchCount / withBoth.length > 0.6) {
      console.warn(
        `[parse-image] Column confusion detected: ${matchCount}/${withBoth.length} holdings have costBasis ≈ lastPrice. Nulling all cost bases.`
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

    // Convert to base64
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
          content: `You are a precise financial data extractor. Your task is to extract portfolio holdings from a brokerage screenshot.

═══════════════════════════════════════════
CRITICAL — READ THIS FIRST
═══════════════════════════════════════════

Brokerage screenshots have SEPARATE columns for:
• "Last Price" / "Price" = the stock's CURRENT market price today
• "Cost Basis" / "Average Cost" = what the investor ORIGINALLY PAID

These are DIFFERENT values. The cost basis reflects the historical purchase price, which is usually DIFFERENT from the current price. If you find yourself extracting the same number for both lastPrice and costBasisPerShare on most rows, STOP — you are reading the wrong column.

═══════════════════════════════════════════
STEP 1: IDENTIFY THE LAYOUT
═══════════════════════════════════════════
1. What brokerage is this? (Fidelity, Schwab, Vanguard, Robinhood, etc.)
2. List ALL column headers from LEFT to RIGHT exactly as they appear.
3. Explicitly identify which column contains:
   • Current stock price (the "Last Price" or "Price" column)
   • Number of shares ("Quantity" or "Shares")
   • Current total market value ("Market Value" or "Current Value")
   • Total cost basis ("Cost Basis Total" — what was PAID in total)
   • Per-share cost basis ("Cost Basis/Share" — what was PAID per share)

═══════════════════════════════════════════
STEP 2: EXTRACT DATA ROW BY ROW
═══════════════════════════════════════════
For each stock row, read the value under each identified column.
Write it out explicitly before producing JSON:
"[SYMBOL]: Price col=$X | Shares col=Y | Value col=$Z | CostBasis Total col=$A | CostBasis/Share col=$B"

═══════════════════════════════════════════
BROKERAGE-SPECIFIC NOTES
═══════════════════════════════════════════

FIDELITY:
• Column order (left to right): Symbol | Description | Last Price | Today's Change | Current Value | Quantity | Cost Basis Total | Cost Basis/Share | Gain/Loss
• STACKED CELLS — some columns show TWO lines of data:
  - "Cost Basis" cell: TOP = total cost basis (e.g., $6,507.43), BOTTOM = per-share cost (e.g., $54.30)
  - "Gain/Loss" cell: TOP = dollar gain/loss, BOTTOM = percentage
  - "Quantity" cell: share count with 3 decimal places (e.g., 119.808)
• IMPORTANT: The "Last Price" column and the "Cost Basis/Share" (bottom number in the cost basis cell) are in DIFFERENT columns — they are NOT the same number.
• Skip: SPAXX, FCASH, FDRXX (cash positions), pending activity, totals row
• Same ticker appearing multiple times = separate tax lots → separate entries

EMPLOYER / 401k PLANS:
• Long alphanumeric fund IDs → map to ETF proxies:
  "S&P 500"/"500 INDEX" → "VOO"
  "TOTAL MARKET" → "VTI"
  "GROWTH" → "VUG"
  "BOND"/"FIXED INCOME" → "BND"
  "INTERNATIONAL" → "VXUS"

OTHER BROKERAGES:
• Extract whatever columns are visible. Use null for missing fields.

═══════════════════════════════════════════
STEP 3: SELF-VERIFICATION
═══════════════════════════════════════════
Before producing JSON, verify:
✓ quantity × lastPrice ≈ currentValue (within 5%) for each row
✓ If both totalCostBasis and costBasisPerShare exist: totalCostBasis ÷ quantity ≈ costBasisPerShare
✓ CRITICAL: costBasisPerShare should NOT equal lastPrice for most holdings.
  If they're the same for most rows, you read the Price column as Cost Basis — go back and re-examine.

═══════════════════════════════════════════
OUTPUT
═══════════════════════════════════════════
After your analysis, output a JSON array:
[{"symbol":"AAPL","quantity":119.808,"lastPrice":182.50,"currentValue":21870.96,"totalCostBasis":6507.43,"costBasisPerShare":54.30}, ...]

Use null for any field not visible in the screenshot.`,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Extract all holdings from this brokerage screenshot.

Follow the steps exactly:
1. First identify the brokerage and column layout
2. Then extract each row, mapping values to the correct columns
3. Self-verify before producing JSON — especially check that costBasisPerShare is NOT the same as lastPrice`,
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

    // Per-holding cross-validation (detects column confusion per row)
    const validated = rawHoldings.map((h) => crossValidate(h));

    // Portfolio-level sanity check (detects systemic column confusion)
    const holdings = portfolioSanityCheck(validated);

    return NextResponse.json({ holdings });
  } catch (error) {
    console.error("Image parsing error:", error);
    return NextResponse.json({ error: "Failed to parse image" }, { status: 500 });
  }
}
