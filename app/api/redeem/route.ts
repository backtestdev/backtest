import { NextRequest, NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { clerkClient } from "@clerk/nextjs/server";

// Valid premium pass codes → duration in days
const PASS_CODES: Record<string, number> = {
  freepass: 30,
};

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  }

  const { code } = await req.json();
  if (!code || typeof code !== "string") {
    return NextResponse.json({ error: "Code is required." }, { status: 400 });
  }

  const normalizedCode = code.trim().toLowerCase();
  const days = PASS_CODES[normalizedCode];

  if (!days) {
    return NextResponse.json({ error: "Invalid code." }, { status: 400 });
  }

  // Check if user already has an active premium subscription (Stripe)
  const user = await currentUser();
  const meta = user?.publicMetadata as Record<string, unknown> | undefined;
  if (meta?.stripeSubscriptionId && meta?.subscriptionStatus === "active") {
    return NextResponse.json(
      { error: "You already have an active Premium subscription." },
      { status: 400 }
    );
  }

  // Set premium pass with expiry
  const expiresAt = Math.floor(Date.now() / 1000) + days * 24 * 60 * 60;
  const client = await clerkClient();
  await client.users.updateUserMetadata(userId, {
    publicMetadata: {
      ...meta,
      plan: "premium",
      premiumPassExpiresAt: expiresAt,
      premiumPassCode: normalizedCode,
    },
  });

  return NextResponse.json({
    success: true,
    message: `Premium access activated for ${days} days!`,
    expiresAt,
  });
}
