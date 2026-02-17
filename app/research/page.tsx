import ResearchSearch from "@/components/ResearchSearch";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Equity Research - Backtest",
  description: "AI-powered equity research reports for any stock",
};

export default function ResearchPage() {
  return <ResearchSearch />;
}
