import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export const dynamic = "force-dynamic";

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
          content: `You are a highly accurate portfolio screenshot parser. You extract stock holdings from brokerage screenshots with perfect precision.

PROCESS — follow these steps in order:

STEP 1: Identify the brokerage and column headers visible in the image. Note their exact left-to-right order.

STEP 2: For each holding row, read the values under each column header carefully, staying strictly within that row. Write out what you see for that row before moving to the next.

STEP 3: After processing all rows, output the final JSON array.

═══════════════════════════════════════════
FIDELITY-SPECIFIC LAYOUT (critical details):
═══════════════════════════════════════════

Fidelity's "Positions" page has these columns (left to right):
  Symbol | Description | Last Price | Today's Change | Current Value | Quantity | Cost Basis Total | Cost Basis/Share | Gain/Loss

IMPORTANT — Fidelity uses STACKED CELLS (two lines per cell):

QUANTITY COLUMN:
• Shows the share count with EXACTLY 3 decimal places for fractional shares (e.g., "119.808", "18.679", "727.082", "28.850").
• The decimal point may appear very small — look carefully.
• If a number seems unreasonably large (e.g., 119808 for a retail holding), it almost certainly has a decimal point you missed — re-examine.

COST BASIS COLUMN — THIS IS THE TRICKIEST PART:
• The cost basis area shows TWO stacked dollar values per row:
  - TOP line: Total cost basis (larger amount, e.g., "$6,507.43") — this is shares × per-share cost
  - BOTTOM line: Per-share cost basis (smaller amount, e.g., "$54.30") — this is what we need
• You MUST extract BOTH values:
  - "totalCostBasis": the TOP line (total dollar amount)
  - "costBasis": the BOTTOM line (per-share amount, the smaller number)
• We use totalCostBasis ÷ shares to cross-verify costBasis, so read both carefully.
• COMMON MISTAKE: reading from the "Last Price" or "Current Value" column instead. The cost basis columns are FURTHER RIGHT than those. Count columns carefully from left to right.

OTHER COLUMNS TO IGNORE FOR COST BASIS:
• "Last Price" = current market price per share (NOT cost basis)
• "Current Value" = shares × last price (NOT cost basis)
• "Gain/Loss" = difference between current value and cost basis total

SKIP these rows: cash (SPAXX, FCASH, FDRXX), pending activity, total/summary rows.
Same ticker appearing multiple times = separate tax lots → include each as its own entry.

═══════════════════════════════════════════
EMPLOYER-SPONSORED PLANS / 401k / PROFIT SHARING:
═══════════════════════════════════════════
• Fidelity may show employer plan holdings with long numeric "tickers" (e.g., "O4FP2", "94304P881", or similar alphanumeric codes).
• These often have a description like "S&P 500 INDEX", "FID 500 INDEX PR", "GROWTH FUND", etc.
• For these entries, use the DESCRIPTION to map to the closest standard ETF/index ticker:
  - "S&P 500" / "500 INDEX" → symbol: "VOO"
  - "TOTAL MARKET" / "TOTAL STOCK" → symbol: "VTI"
  - "GROWTH" → symbol: "VUG"
  - "BOND" / "FIXED INCOME" → symbol: "BND"
  - "INTERNATIONAL" / "FOREIGN" → symbol: "VXUS"
  - If description doesn't clearly match, use the best-fit standard ETF ticker
• Still extract shares and cost basis normally for these rows.

═══════════════════════════════════════════
OTHER BROKERAGES:
═══════════════════════════════════════════
For Schwab, Robinhood, E*TRADE, Vanguard, etc.:
- Shares/Quantity/Qty → shares
- Avg Cost / Cost Per Share / Cost Basis Per Share → costBasis
- Set totalCostBasis to null if not shown separately
- Ignore: Last Price, Market Value, Today's Change

═══════════════════════════════════════════
SANITY CHECKS — apply to EVERY value you extract:
═══════════════════════════════════════════
• Share counts: almost always 0.001–50,000. If > 50,000, you likely missed a decimal.
• Cost basis per share: should be a plausible stock price ($0.50–$10,000). If outside this range, re-read.
• Cross-check: totalCostBasis ÷ shares should ≈ costBasis (within a few cents). If way off, one of the three values is wrong — re-read that row.

OUTPUT:
First, write your row-by-row analysis (what you see for each holding).
Then, on a new line, output the final JSON array.
Format: [{"symbol":"AAPL","shares":119.808,"costBasis":54.30,"totalCostBasis":6507.43},...]
Use null for costBasis/totalCostBasis if not visible. Return [] if no holdings found.`,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Extract every stock holding from this brokerage portfolio screenshot.

Instructions:
1. First identify the column headers and brokerage
2. Then go row by row — for each row, write the ticker and note:
   a. The share quantity (look for decimal point — Fidelity shows 3 decimal places)
   b. The TOTAL cost basis (top line of cost basis cell — the bigger dollar amount)
   c. The PER-SHARE cost basis (bottom line of cost basis cell — the smaller dollar amount)
3. Verify: does totalCostBasis ÷ shares ≈ costBasis? If not, re-read that row.
4. For employer plan holdings with numeric tickers, map to the equivalent ETF symbol based on the fund description.
5. Finally output the JSON array with symbol, shares, costBasis, and totalCostBasis`,
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

    // Parse the JSON response
    // Try to extract JSON from the response (it might have markdown fences)
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return NextResponse.json({ holdings: [], raw: content });
    }

    const rawHoldings = JSON.parse(jsonMatch[0]);

    // Post-process: use totalCostBasis / shares to compute accurate per-share
    // cost basis, since the total is displayed in larger text and is more
    // reliably read by the vision model than the tiny per-share line.
    const holdings = rawHoldings.map(
      (h: { symbol: string; shares: number; costBasis: number | null; totalCostBasis?: number | null }) => {
        let costBasis = h.costBasis;
        const total = h.totalCostBasis;
        const shares = h.shares;

        if (total && shares && shares > 0) {
          const computed = Math.round((total / shares) * 100) / 100;
          // If the model also returned a per-share value, check if the computed
          // value is reasonably close. If they diverge significantly, prefer the
          // computed value (division is more reliable than OCR of tiny text).
          if (costBasis == null || Math.abs(costBasis - computed) > 0.5) {
            costBasis = computed;
          }
        }

        return {
          symbol: h.symbol,
          shares: h.shares,
          costBasis,
        };
      }
    );

    return NextResponse.json({ holdings });
  } catch (error) {
    console.error("Image parsing error:", error);
    return NextResponse.json({ error: "Failed to parse image" }, { status: 500 });
  }
}
