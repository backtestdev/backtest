import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export const dynamic = "force-dynamic";

/**
 * Cross-validate extracted values using redundant data from the table.
 * Fidelity shows multiple related fields per row — we can derive the same
 * value multiple ways and pick the most consistent answer.
 */
function crossValidate(raw: {
  symbol: string;
  quantity: number | null;
  lastPrice: number | null;
  currentValue: number | null;
  totalCostBasis: number | null;
  costBasisPerShare: number | null;
}): { symbol: string; shares: number; costBasis: number | null } {
  const { symbol, quantity, lastPrice, currentValue, totalCostBasis, costBasisPerShare } = raw;

  // ── Derive shares from multiple sources ──
  const candidates: number[] = [];

  if (quantity && quantity > 0) {
    candidates.push(quantity);
  }
  // currentValue / lastPrice = shares
  if (currentValue && lastPrice && lastPrice > 0) {
    candidates.push(Math.round((currentValue / lastPrice) * 1000) / 1000);
  }
  // totalCostBasis / costBasisPerShare = shares
  if (totalCostBasis && costBasisPerShare && costBasisPerShare > 0) {
    candidates.push(Math.round((totalCostBasis / costBasisPerShare) * 1000) / 1000);
  }

  let shares = quantity || 0;

  if (candidates.length >= 2) {
    // Find the value that most candidates agree on (within 1% tolerance)
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

  // ── Derive cost basis from totalCostBasis / shares (always prefer division) ──
  let costBasis: number | null = null;

  if (totalCostBasis && shares > 0) {
    costBasis = Math.round((totalCostBasis / shares) * 100) / 100;
  } else if (costBasisPerShare) {
    costBasis = costBasisPerShare;
  }

  return { symbol, shares, costBasis };
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
      model: "gpt-4o",
      max_tokens: 8000,
      messages: [
        {
          role: "system",
          content: `You are a highly accurate portfolio screenshot parser. You extract ALL numeric fields from each row so we can cross-verify values in code.

PROCESS:
1. Identify the brokerage and column headers. Note their exact left-to-right order.
2. For each holding row, read ALL visible numeric values and write them out.
3. Output the JSON array with ALL fields.

═══════════════════════════════════════════
FIDELITY LAYOUT (columns left to right):
═══════════════════════════════════════════
Symbol | Description | Last Price | Today's Change | Current Value | Quantity | Cost Basis Total | Cost Basis/Share | Gain/Loss

STACKED CELLS — Fidelity shows two lines in many cells:
• "Current Value" cell: top = total value, bottom = may show additional info
• "Quantity" cell: share count, ALWAYS 3 decimal places for fractional shares (e.g., 119.808, 18.679, 28.850). If you see what looks like a large integer like 119808, it MUST have a decimal — re-examine.
• "Cost Basis" cell: top = TOTAL cost basis ($6,507.43), bottom = per-share cost ($54.30)
• "Gain/Loss" cell: top = dollar gain/loss, bottom = percentage

EXTRACT ALL OF THESE PER ROW (we cross-verify in code):
• "lastPrice": from the Last Price column (current market price per share)
• "currentValue": from the Current Value column (total market value of this position)
• "quantity": from the Quantity column (number of shares, may be fractional)
• "totalCostBasis": the TOP number in the cost basis cell (total dollars)
• "costBasisPerShare": the BOTTOM number in the cost basis cell (per-share)

WHY: We verify shares = currentValue / lastPrice, and also shares = totalCostBasis / costBasisPerShare. This catches any single misread digit.

SKIP: cash (SPAXX, FCASH, FDRXX), pending activity, totals.
Same ticker multiple times = separate tax lots → separate entries.

═══════════════════════════════════════════
EMPLOYER PLANS / 401k:
═══════════════════════════════════════════
Long alphanumeric "tickers" with descriptions like "S&P 500 INDEX" → map to:
  "S&P 500"/"500 INDEX" → "VOO", "TOTAL MARKET" → "VTI", "GROWTH" → "VUG",
  "BOND"/"FIXED INCOME" → "BND", "INTERNATIONAL" → "VXUS"

═══════════════════════════════════════════
OTHER BROKERAGES:
═══════════════════════════════════════════
Extract whatever fields are visible. Set missing fields to null.

OUTPUT:
First, write row-by-row analysis of what you see.
Then output the JSON array:
[{"symbol":"AAPL","quantity":119.808,"lastPrice":182.50,"currentValue":21870.96,"totalCostBasis":6507.43,"costBasisPerShare":54.30},...]
Use null for any field that is not visible.`,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Extract ALL numeric fields from every stock holding in this brokerage screenshot.

For each row, extract: symbol, quantity (shares), lastPrice, currentValue, totalCostBasis, costBasisPerShare.

Look carefully at decimal points in the quantity — Fidelity always shows 3 decimal places.
We will cross-verify: quantity should ≈ currentValue ÷ lastPrice and also ≈ totalCostBasis ÷ costBasisPerShare.`,
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

    // Cross-validate each holding using redundant data
    const holdings = rawHoldings.map((h) => crossValidate(h));

    return NextResponse.json({ holdings });
  } catch (error) {
    console.error("Image parsing error:", error);
    return NextResponse.json({ error: "Failed to parse image" }, { status: 500 });
  }
}
