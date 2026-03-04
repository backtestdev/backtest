import StockScreener from "@/components/StockScreener";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "AI Stock Analyzer - SoloQuant",
  description: "Search, analyze, and score stocks with AI-powered research and multi-factor scoring",
};

export default function ScreenerPage() {
  return <StockScreener />;
}
