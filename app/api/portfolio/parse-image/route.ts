import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export const dynamic = "force-dynamic";

/* ─── Prompt constants ─── */

const EXTRACTION_PROMPT = `You are a precise financial data extractor. Extract portfolio holdings from brokerage screenshots.

═══ CRITICAL — COLUMN DISTINCTION ═══
"Last Price" = CURRENT market price today.
"Cost Basis" = what the investor ORIGINALLY PAID.
These are DIFFERENT columns with DIFFERENT values.

═══ STEP 1: IDENTIFY LAYOUT ═══
1. Identify the brokerage
2. List ALL column headers left to right
3. Map each column to its data type

═══ STEP 2: ROW-BY-ROW EXTRACTION ═══
For each row, write values column by column:
"[SYMBOL]: Price=$X | Value=$Y | Qty=Z | CB Total=$A | CB/Share=$B"

═══ FIDELITY SPECIFICS ═══
Column order: Symbol | Description | Last Price | Change | Current Value | Quantity | Cost Basis | Gain/Loss

STACKED CELLS (two lines per cell):
• "Cost Basis" cell:
  - TOP line = TOTAL cost basis (e.g., $14,775.00) — the LARGER number
  - BOTTOM line = per-share cost (e.g., $49.25 / Share) — has "/ Share" suffix
• "Gain/Loss" cell: TOP = dollars, BOTTOM = percentage
• "Quantity": ALWAYS 3 decimal places (e.g., 195.217, NOT 1952, NOT 1990)

CRITICAL DECIMAL RULE: If a quantity looks like a large integer (>500 without decimals), you almost certainly missed a decimal point. Re-examine.

SKIP: SPAXX, FCASH, FDRXX (cash), pending activity, totals.
Same ticker multiple times = separate entries (tax lots).

═══ EMPLOYER / 401k ═══
Map fund descriptions: "S&P 500"→"VOO", "TOTAL MARKET"→"VTI", "GROWTH"→"VUG", "BOND"→"BND", "INTERNATIONAL"→"VXUS"

═══ OTHER BROKERAGES ═══
Extract visible fields. Use null for missing.

═══ STEP 3: VERIFY ═══
For EVERY row: quantity × lastPrice ≈ currentValue (within 5%). If not, re-read quantity.

═══ OUTPUT ═══
JSON array: [{"symbol":"AAPL","quantity":119.808,"lastPrice":182.50,"currentValue":21870.96,"totalCostBasis":6507.43,"costBasisPerShare":54.30}, ...]
Use null for any field not visible.`;

const VERIFICATION_PROMPT = `You are verifying portfolio data extracted from a brokerage screenshot. A first pass already extracted the data, but it may contain errors. Your job is to re-read EACH value from the screenshot and fix any mistakes.

═══ COMMON ERRORS TO WATCH FOR ═══

1. DECIMAL POINTS IN SHARES
   Fidelity ALWAYS shows 3 decimal places (e.g., 195.217).
   If you see shares like 1990, 1952, 3856 — a decimal was missed.
   Re-read very carefully: 195.217, not 1952. 28.850, not 38854.

2. COST BASIS — TWO STACKED NUMBERS
   The Cost Basis cell shows TWO lines:
   • TOP = total cost basis (larger number, e.g., $9,689.88)
   • BOTTOM = per-share cost (smaller number with "/ Share", e.g., $2,512.28 / Share)
   We want the BOTTOM number (per-share). If the extracted cost basis
   seems too low for the stock, you may have divided the per-share by shares.

3. ROW MIXING
   Make sure each row's values come from THAT row, not an adjacent row.
   Check: does this cost basis belong to THIS ticker or the one above/below?

4. VERIFICATION MATH
   For each row: shares × lastPrice should ≈ currentValue (within 5%).
   If not, the shares are wrong — re-read the Quantity column.

═══ INSTRUCTIONS ═══
Go through each holding IN ORDER. For each one:
1. Find that row in the screenshot
2. Re-read the Quantity column (3 decimal places!)
3. Re-read the BOTTOM number in the Cost Basis cell (per-share, has "/ Share")
4. If the extracted value was wrong, provide the corrected value
5. If it was correct, keep it

Output ALL holdings as a JSON array in the SAME ORDER:
[{"symbol":"INTC","shares":119.808,"costBasis":54.30}, ...]`;

/* ─── Cross-validation (used on Pass 1 to provide best-effort data to Pass 2) ─── */

function crossValidate(raw: {
  symbol: string;
  quantity: number | null;
  lastPrice: number | null;
  currentValue: number | null;
  totalCostBasis: number | null;
  costBasisPerShare: number | null;
}): { symbol: string; shares: number; costBasis: number | null; lastPrice: number | null } {
  const { symbol, quantity, lastPrice, currentValue, totalCostBasis, costBasisPerShare } = raw;

  // Derive shares from multiple sources
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
    if (
      quantity != null && quantity > 0 &&
      Math.abs(derivedFromPrice - quantity) / Math.max(derivedFromPrice, quantity) > 0.02
    ) {
      // Disagreement — use tiebreaker
      if (derivedFromCost !== null) {
        const priceAgreesWithCost =
          Math.abs(derivedFromCost - derivedFromPrice) / Math.max(derivedFromCost, derivedFromPrice) < 0.02;
        const quantityAgreesWithCost =
          Math.abs(derivedFromCost - quantity) / Math.max(derivedFromCost, quantity) < 0.02;
        if (priceAgreesWithCost) shares = derivedFromPrice;
        else if (quantityAgreesWithCost) shares = quantity;
        else shares = derivedFromPrice;
      } else {
        shares = derivedFromPrice;
      }
    } else {
      shares = derivedFromPrice;
    }
  } else if (quantity != null && quantity > 0) {
    shares = quantity;
  } else if (derivedFromCost !== null) {
    shares = derivedFromCost;
  }

  shares = Math.round(shares * 1000) / 1000;

  // Cost basis — prefer directly-read per-share
  let costBasis: number | null = null;
  if (costBasisPerShare != null && costBasisPerShare > 0) {
    costBasis = Math.round(costBasisPerShare * 100) / 100;
  } else if (totalCostBasis != null && totalCostBasis > 0 && shares > 0) {
    const looksLikeCurrentValue =
      currentValue != null && currentValue > 0 &&
      Math.abs(totalCostBasis - currentValue) / currentValue < 0.05;
    if (!looksLikeCurrentValue) {
      costBasis = Math.round((totalCostBasis / shares) * 100) / 100;
    }
  }

  return { symbol, shares, costBasis, lastPrice: lastPrice || null };
}

/* ─── JSON extraction helper ─── */

function extractJsonArray(content: string): unknown[] {
  const match = content.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    return JSON.parse(match[0]);
  } catch {
    return [];
  }
}

/* ─── Route handler ─── */

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
    const imageUrl = `data:${mimeType};base64,${base64}`;

    const openai = new OpenAI({ apiKey: openaiKey });

    // ══════════════════════════════════════════════
    // PASS 1: Initial extraction (all fields)
    // ══════════════════════════════════════════════
    const pass1Response = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 8000,
      temperature: 0.1,
      messages: [
        { role: "system", content: EXTRACTION_PROMPT },
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
            { type: "image_url", image_url: { url: imageUrl, detail: "high" } },
          ],
        },
      ],
    });

    const pass1Content = pass1Response.choices[0]?.message?.content || "[]";
    const rawHoldings = extractJsonArray(pass1Content) as Array<{
      symbol: string;
      quantity: number | null;
      lastPrice: number | null;
      currentValue: number | null;
      totalCostBasis: number | null;
      costBasisPerShare: number | null;
    }>;

    if (rawHoldings.length === 0) {
      return NextResponse.json({ holdings: [], raw: pass1Content });
    }

    // Cross-validate Pass 1 for best-effort baseline
    const pass1Validated = rawHoldings.map((h) => crossValidate(h));

    // ══════════════════════════════════════════════
    // PASS 2: Verification — re-read with focused prompt
    // ══════════════════════════════════════════════
    // Build the list of holdings for verification, flagging suspicious values
    const holdingLines = pass1Validated.map((h, i) => {
      const warnings: string[] = [];
      if (h.shares >= 500 && Math.abs(h.shares - Math.round(h.shares)) < 0.01) {
        warnings.push("shares is a round number ≥500 — check for missed decimal point");
      }
      if (h.shares >= 1000) {
        warnings.push("very high share count — likely decimal error");
      }
      if (h.costBasis === null) {
        warnings.push("cost basis missing — read bottom of Cost Basis cell");
      }
      if (h.costBasis !== null && h.lastPrice !== null && h.lastPrice > 0) {
        if (Math.abs(h.costBasis - h.lastPrice) / h.lastPrice < 0.03) {
          warnings.push("cost basis ≈ current price — likely column confusion");
        }
      }
      const warn = warnings.length > 0 ? `  ⚠️ ${warnings.join("; ")}` : "";
      return `${i + 1}. ${h.symbol}: shares=${h.shares}, costBasis=$${h.costBasis ?? "unknown"}${warn}`;
    }).join("\n");

    let finalHoldings: Array<{ symbol: string; shares: number; costBasis: number | null }>;

    try {
      const pass2Response = await openai.chat.completions.create({
        model: "gpt-4o",
        max_tokens: 4000,
        temperature: 0,
        messages: [
          { role: "system", content: VERIFICATION_PROMPT },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Here are the holdings extracted in Pass 1:\n\n${holdingLines}\n\nRe-read each holding's shares and per-share cost basis from the screenshot. Fix any errors.\n\nOutput JSON array in the SAME ORDER:\n[{"symbol":"INTC","shares":119.808,"costBasis":54.30}, ...]`,
              },
              { type: "image_url", image_url: { url: imageUrl, detail: "high" } },
            ],
          },
        ],
      });

      const pass2Content = pass2Response.choices[0]?.message?.content || "[]";
      const pass2Holdings = extractJsonArray(pass2Content) as Array<{
        symbol: string;
        shares: number;
        costBasis: number | null;
      }>;

      // Use Pass 2 if it returned a reasonable number of results
      if (pass2Holdings.length >= pass1Validated.length * 0.8) {
        finalHoldings = pass2Holdings.map((h) => ({
          symbol: (h.symbol || "").toUpperCase(),
          shares: h.shares || 0,
          costBasis: h.costBasis ?? null,
        }));
      } else {
        // Pass 2 returned too few results — fall back to Pass 1
        finalHoldings = pass1Validated.map((h) => ({
          symbol: h.symbol,
          shares: h.shares,
          costBasis: h.costBasis,
        }));
      }
    } catch (pass2Error) {
      // Pass 2 failed — fall back to Pass 1
      console.error("Pass 2 verification failed, using Pass 1:", pass2Error);
      finalHoldings = pass1Validated.map((h) => ({
        symbol: h.symbol,
        shares: h.shares,
        costBasis: h.costBasis,
      }));
    }

    // Portfolio-level sanity check — if most cost bases ≈ last price, null them
    const withPrice = finalHoldings.map((h, i) => ({
      ...h,
      lastPrice: i < pass1Validated.length ? pass1Validated[i].lastPrice : null,
    }));
    const withBoth = withPrice.filter(
      (h) => h.costBasis !== null && h.lastPrice !== null && h.lastPrice > 0
    );
    if (withBoth.length >= 2) {
      const confusedCount = withBoth.filter((h) => {
        return Math.abs(h.costBasis! - h.lastPrice!) / h.lastPrice! < 0.05;
      }).length;
      if (confusedCount / withBoth.length > 0.6) {
        console.warn(
          `[parse-image] Column confusion: ${confusedCount}/${withBoth.length} costBasis ≈ lastPrice. Nulling.`
        );
        finalHoldings = finalHoldings.map((h) => ({ ...h, costBasis: null }));
      }
    }

    return NextResponse.json({ holdings: finalHoldings });
  } catch (error) {
    console.error("Image parsing error:", error);
    return NextResponse.json({ error: "Failed to parse image" }, { status: 500 });
  }
}
