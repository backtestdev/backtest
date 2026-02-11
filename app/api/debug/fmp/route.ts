import { NextResponse } from "next/server";
export const runtime = "nodejs";

export async function GET() {
  const key = process.env.FINANCIAL_MODELING_PREP_API_KEY || process.env.FMP_API_KEY;
  const url = `https://financialmodelingprep.com/stable/actively-trading-list?apikey=${key}`;
  const res = await fetch(url);

  if (!res.ok) {
    return NextResponse.json({
      status: res.status,
      error: `FMP API returned ${res.status} ${res.statusText}`,
    }, { status: res.status });
  }

  const text = await res.text();

  return NextResponse.json({
    status: res.status,
    sample: text.slice(0, 300),
  });
}
