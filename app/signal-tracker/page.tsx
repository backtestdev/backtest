import SignalTracker from "@/components/SignalTracker";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Signal Tracker - Backtest",
  description: "AI-scored stock picks tracked with portfolio performance vs S&P 500",
};

export default function SignalTrackerPage() {
  return <SignalTracker />;
}
