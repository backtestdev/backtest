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
• The "Quantity" column shows the share count. Fidelity displays fractional shares with EXACTLY 3 decimal places (e.g., "119.808", "18.679", "727.082"). The decimal point may appear very small — look carefully. If a number seems unreasonably large (e.g., 119808 for a retail holding), it almost certainly has a decimal point you missed — re-examine.
• The "Cost Basis" area has TWO stacked values:
  - TOP line: Total cost basis dollar amount (e.g., "$6,507.43") — DO NOT use this
  - BOTTOM line: Per-share cost basis (e.g., "$54.30") — THIS is the costBasis to extract
  The per-share value is the SMALLER number. It is sometimes shown with "/share" or in smaller text below the total.
• The "Last Price" column is NOT cost basis. It shows the current market price. Ignore it for costBasis.
• The "Current Value" column shows total market value. Ignore it for costBasis.
• Skip non-stock rows: cash (SPAXX, FCASH, FDRXX), pending activity, totals.
• Same ticker appearing multiple times = separate tax lots. Include each as its own entry.

═══════════════════════════════════════════
OTHER BROKERAGES:
═══════════════════════════════════════════
For Schwab, Robinhood, E*TRADE, Vanguard, etc.:
- Shares/Quantity/Qty → shares
- Avg Cost / Cost Per Share / Cost Basis Per Share → costBasis
- Ignore: Last Price, Market Value, Today's Change

═══════════════════════════════════════════
SANITY CHECKS — apply to every value you extract:
═══════════════════════════════════════════
• Share counts for retail investors are almost always between 0.001 and 50,000. If you get a number above 50,000 (like 119808 or 18679), you very likely missed a decimal point. Re-examine the image for that cell.
• Cost basis per share should be a plausible stock price: typically $1–$5,000. If you get a value below $1 or above $10,000, double-check you read the right cell.
• If a cost basis seems to match the "Last Price" column instead, you are reading the wrong column — look further right for the actual cost basis.

OUTPUT:
First, write your row-by-row analysis (what you see for each holding).
Then, on a new line, output the final JSON array.
Format: [{"symbol":"AAPL","shares":119.808,"costBasis":54.30},...]
Use null for costBasis if not visible. Return [] if no holdings found.`,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Extract every stock holding from this brokerage portfolio screenshot.

Instructions:
1. First identify the column headers and brokerage
2. Then go row by row — for each row, write the ticker and what you read for shares and cost basis per share
3. Double-check: are share quantities fractional (have a decimal point)? Fidelity always shows 3 decimal places.
4. Double-check: is the cost basis the PER-SHARE amount (bottom line in stacked cells), not the total or the last price?
5. Finally output the JSON array`,
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

    const holdings = JSON.parse(jsonMatch[0]);

    return NextResponse.json({ holdings });
  } catch (error) {
    console.error("Image parsing error:", error);
    return NextResponse.json({ error: "Failed to parse image" }, { status: 500 });
  }
}
