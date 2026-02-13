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
      model: "gpt-4o-mini",
      max_tokens: 1000,
      messages: [
        {
          role: "system",
          content: `You are a portfolio screenshot parser. Extract stock holdings from the image.
Return ONLY a JSON array with objects containing:
- "symbol": stock ticker symbol (uppercase, e.g., "AAPL")
- "shares": number of shares (numeric, best guess if unclear)
- "costBasis": per-share cost basis if visible (numeric, or null)

Example output: [{"symbol":"AAPL","shares":100,"costBasis":150.00},{"symbol":"MSFT","shares":50,"costBasis":null}]

If you cannot identify any holdings, return an empty array: []
Return ONLY the JSON array, no other text.`,
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Extract the stock holdings from this portfolio screenshot:" },
            {
              type: "image_url",
              image_url: { url: `data:${mimeType};base64,${base64}` },
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
