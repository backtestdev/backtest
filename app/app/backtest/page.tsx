import HomePage from "@/components/HomePage";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "AI Stock Screener - SoloQuant",
  description: "Screen stocks using natural language and see how your criteria performed with backtested results",
};

export default function BacktestPage() {
  return <HomePage />;
}
