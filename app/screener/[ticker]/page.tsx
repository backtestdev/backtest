import StockDetail from "@/components/StockDetail";

export const dynamic = "force-dynamic";

interface PageProps {
  params: { ticker: string };
}

export function generateMetadata({ params }: PageProps) {
  const symbol = params.ticker.toUpperCase();
  return {
    title: `${symbol} - AI Stock Screener`,
    description: `AI-powered research and analysis for ${symbol}`,
  };
}

export default function StockDetailPage({ params }: PageProps) {
  return <StockDetail ticker={params.ticker.toUpperCase()} />;
}
