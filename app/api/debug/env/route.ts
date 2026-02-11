import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    openai_key_present: !!process.env.OPENAI_API_KEY,
    openai_key_len: process.env.OPENAI_API_KEY?.length ?? 0,
    fmp_key_present: !!process.env.FMP_API_KEY,
    fmp_key_len: process.env.FMP_API_KEY?.length ?? 0,
  });
}
