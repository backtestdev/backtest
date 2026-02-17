import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

interface PageProps {
  params: { ticker: string };
}

export default function ResearchTickerPage({ params }: PageProps) {
  redirect(`/screener/${params.ticker.toUpperCase()}`);
}
