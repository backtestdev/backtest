import HomePage from "@/components/HomePage";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "AI Stock Screener - Screen Stocks with Natural Language",
  description: "Screen stocks using natural language and see how your criteria performed with backtested results",
};

export default function BacktestPage() {
  return <HomePage />;
}
