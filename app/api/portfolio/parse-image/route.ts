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
      max_tokens: 4000,
      messages: [
        {
          role: "system",
          content: `You are a highly accurate portfolio screenshot parser that extracts stock holdings from brokerage account screenshots.

CRITICAL RULES — read carefully:

1. SHARES CAN BE FRACTIONAL. Many brokerages show fractional shares like 119.808 or 18.679 or 727.082. You MUST preserve the decimal point exactly as shown. Never drop decimals or round. If you see "119.808", output 119.808, NOT 119808.

2. COST BASIS means the AVERAGE COST PER SHARE the investor paid, NOT the current/last price. Brokerages label this column as "Cost Basis Per Share", "Avg Cost", "Average Cost", or "Unit Cost". It is a DIFFERENT column from "Last Price", "Current Price", or "Price". Read each column header carefully and match data to the correct column.

3. PARSE ROW BY ROW. Each row in the table corresponds to ONE holding. Read each row left-to-right, matching values to their column headers. Do NOT mix values from adjacent rows. If a ticker appears on row N, its shares and cost basis are on that SAME row N — never grab a number from row N+1 or N-1.

4. MULTIPLE LOTS: Some brokerages (especially Fidelity) show the same ticker multiple times for different tax lots or accounts. Each lot is a SEPARATE entry. Include every lot as its own object in the output array. Do not merge or skip lots.

5. READ ALL ROWS. Scroll down mentally and capture every single holding row visible in the image. Do not stop early.

FIDELITY-SPECIFIC LAYOUT:
Fidelity's "Positions" page typically has columns in this order:
  Symbol | Description | Last Price | Change Today ($) | Change Today (%) | Current Value | Quantity | Cost Basis Total | Cost Basis Per Share | Gain/Loss ($) | Gain/Loss (%)
- "Quantity" = number of shares (may be fractional like 119.808)
- "Cost Basis Per Share" = the costBasis you should extract (NOT "Last Price")
- Rows may include cash positions (e.g., "SPAXX") — skip non-stock entries like money market funds, pending activity, and cash

OTHER BROKERAGES:
For Schwab, Robinhood, E*TRADE, Vanguard, etc., look for column headers and map:
- Shares/Quantity/Qty → shares
- Avg Cost/Cost Per Share/Cost Basis Per Share → costBasis
- Ignore: Last Price, Market Value, Today's Change

OUTPUT FORMAT:
Return ONLY a JSON array. No other text, no markdown fences.
Each object: {"symbol":"AAPL","shares":119.808,"costBasis":54.30}
Use null for costBasis if that column is not visible or the value is unclear.
Example: [{"symbol":"AAPL","shares":100.5,"costBasis":150.00},{"symbol":"MSFT","shares":50,"costBasis":null}]
If no holdings found, return: []`,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Extract every stock holding from this brokerage portfolio screenshot. Pay close attention to decimal points in share quantities, and make sure cost basis comes from the correct column (average cost per share, NOT last price). Parse each row independently.",
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
