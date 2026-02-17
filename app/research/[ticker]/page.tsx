import ResearchReport from "@/components/ResearchReport";

export const dynamic = "force-dynamic";

interface PageProps {
  params: { ticker: string };
}

export function generateMetadata({ params }: PageProps) {
  const symbol = params.ticker.toUpperCase();
  return {
    title: `${symbol} Research Report - Backtest`,
    description: `AI-powered equity research report for ${symbol}`,
  };
}

export default function ResearchPage({ params }: PageProps) {
  return <ResearchReport ticker={params.ticker.toUpperCase()} />;
}
