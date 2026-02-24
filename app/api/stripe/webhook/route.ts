import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { clerkClient } from "@clerk/nextjs/server";

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: "2026-01-28.clover",
  });
}

export async function POST(req: NextRequest) {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");

  if (!sig) {
    return NextResponse.json({ error: "No signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const clerkUserId = session.metadata?.clerkUserId;
        if (clerkUserId && session.subscription) {
          const subscription = await stripe.subscriptions.retrieve(
            session.subscription as string
          );
          await updateClerkMetadata(clerkUserId, {
            plan: "premium",
            stripeCustomerId: session.customer as string,
            stripeSubscriptionId: subscription.id,
            subscriptionStatus: subscription.status,
          });
        }
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const clerkUserId = subscription.metadata?.clerkUserId;
        if (clerkUserId) {
          const isActive = ["active", "trialing"].includes(subscription.status);
          await updateClerkMetadata(clerkUserId, {
            plan: isActive ? "premium" : "free",
            stripeSubscriptionId: subscription.id,
            subscriptionStatus: subscription.status,
          });
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const clerkUserId = subscription.metadata?.clerkUserId;
        if (clerkUserId) {
          await updateClerkMetadata(clerkUserId, {
            plan: "free",
            subscriptionStatus: "canceled",
          });
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const subRef = invoice.parent?.subscription_details?.subscription;
        const subId = typeof subRef === "string" ? subRef : subRef?.id;
        if (subId) {
          const subscription = await stripe.subscriptions.retrieve(subId);
          const clerkUserId = subscription.metadata?.clerkUserId;
          if (clerkUserId) {
            await updateClerkMetadata(clerkUserId, {
              plan: "free",
              subscriptionStatus: "past_due",
            });
          }
        }
        break;
      }
    }
  } catch (error) {
    console.error("Webhook handler error:", error);
    return NextResponse.json(
      { error: "Webhook handler failed" },
      { status: 500 }
    );
  }

  return NextResponse.json({ received: true });
}

async function updateClerkMetadata(
  userId: string,
  metadata: Record<string, unknown>
) {
  const client = await clerkClient();
  await client.users.updateUserMetadata(userId, {
    publicMetadata: metadata,
  });
}
