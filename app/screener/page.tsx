import StockScreener from "@/components/StockScreener";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "AI Stock Screener - Backtest",
  description: "Search, screen, and analyze stocks with AI-powered research and multi-factor scoring",
};

export default function ScreenerPage() {
  return <StockScreener />;
}
