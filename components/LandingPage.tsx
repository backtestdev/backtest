"use client";

import { useRef } from "react";
import Link from "next/link";
import { motion, useInView } from "framer-motion";

// ── Animation wrapper ──────────────────────────────────────────────────

function FadeIn({
  children,
  delay = 0,
  className = "",
  direction = "up",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
  direction?: "up" | "left" | "right" | "none";
}) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });

  const initialY = direction === "up" ? 32 : 0;
  const initialX = direction === "left" ? -32 : direction === "right" ? 32 : 0;

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: initialY, x: initialX }}
      animate={inView ? { opacity: 1, y: 0, x: 0 } : {}}
      transition={{ duration: 0.5, delay, ease: [0.25, 0.4, 0.25, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// ── Stat card ──────────────────────────────────────────────────────────

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center">
      <div className="text-3xl sm:text-4xl font-bold text-white tracking-tight">{value}</div>
      <div className="mt-1 text-sm text-slate-400">{label}</div>
    </div>
  );
}

// ── Feature card ───────────────────────────────────────────────────────

function FeatureCard({
  icon,
  title,
  description,
  delay = 0,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  delay?: number;
}) {
  return (
    <FadeIn delay={delay}>
      <div className="group relative rounded-2xl border border-slate-800 bg-slate-900/50 p-6 sm:p-8 hover:border-slate-700 hover:bg-slate-900/80 transition-all duration-300">
        <div className="mb-4 inline-flex items-center justify-center w-10 h-10 rounded-xl bg-blue-500/10 text-blue-400">
          {icon}
        </div>
        <h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
        <p className="text-sm leading-relaxed text-slate-400">{description}</p>
      </div>
    </FadeIn>
  );
}

// ── Step card ──────────────────────────────────────────────────────────

function StepCard({
  step,
  title,
  description,
  delay = 0,
}: {
  step: number;
  title: string;
  description: string;
  delay?: number;
}) {
  return (
    <FadeIn delay={delay} className="flex-1 min-w-[240px]">
      <div className="relative flex flex-col items-center text-center">
        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center text-lg font-bold text-white mb-4 shadow-lg shadow-blue-500/20">
          {step}
        </div>
        <h3 className="text-base font-semibold text-white mb-2">{title}</h3>
        <p className="text-sm text-slate-400 leading-relaxed max-w-[280px]">{description}</p>
      </div>
    </FadeIn>
  );
}

// ── Main landing page ──────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#0a0e1a] text-white overflow-hidden">
      {/* ── Sticky nav ────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 border-b border-white/5 bg-[#0a0e1a]/80 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-4 sm:px-6 h-16">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center">
              <svg className="w-4.5 h-4.5 text-white" viewBox="0 0 24 24" fill="none" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
              </svg>
            </div>
            <span className="text-lg font-bold tracking-tight">SoloQuant</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link
              href="/app"
              className="hidden sm:inline-flex px-4 py-2 text-sm font-medium text-slate-300 hover:text-white transition-colors"
            >
              Sign In
            </Link>
            <Link
              href="/app"
              className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors shadow-lg shadow-blue-600/20"
            >
              Open App
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ──────────────────────────────────────────── */}
      <section className="relative pt-20 sm:pt-28 pb-20 px-4 sm:px-6">
        {/* Background gradient */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-gradient-to-b from-blue-600/8 via-cyan-500/5 to-transparent rounded-full blur-3xl" />
        </div>

        <div className="relative max-w-4xl mx-auto text-center">
          <FadeIn>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-blue-500/20 bg-blue-500/5 text-xs font-medium text-blue-400 mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
              Now in public beta
            </div>
          </FadeIn>

          <FadeIn delay={0.1}>
            <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.08]">
              Your own quant desk.
              <br />
              <span className="bg-gradient-to-r from-blue-400 via-cyan-400 to-teal-400 bg-clip-text text-transparent">
                No quant degree.
              </span>
            </h1>
          </FadeIn>

          <FadeIn delay={0.2}>
            <p className="mt-6 text-base sm:text-lg text-slate-400 max-w-2xl mx-auto leading-relaxed">
              Describe any stock strategy in plain English. SoloQuant backtests it against
              20 years of market data and shows you exactly how it would have performed.
            </p>
          </FadeIn>

          <FadeIn delay={0.3}>
            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                href="/app/backtest"
                className="w-full sm:w-auto px-8 py-3.5 text-base font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-xl transition-colors shadow-lg shadow-blue-600/25"
              >
                Start Backtesting for Free
              </Link>
              <a
                href="#how-it-works"
                className="w-full sm:w-auto px-8 py-3.5 text-base font-medium text-slate-300 hover:text-white border border-slate-700 hover:border-slate-600 rounded-xl transition-colors"
              >
                See How It Works
              </a>
            </div>
          </FadeIn>

          {/* Product preview */}
          <FadeIn delay={0.5}>
            <div className="mt-16 relative">
              <div className="absolute -inset-4 bg-gradient-to-b from-blue-500/10 via-transparent to-transparent rounded-3xl blur-xl" />
              <div className="relative rounded-2xl border border-slate-800 bg-slate-900/80 p-4 sm:p-6 shadow-2xl">
                {/* Mock app interface */}
                <div className="space-y-4">
                  {/* Search bar mock */}
                  <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-slate-800/80 border border-slate-700/50">
                    <svg className="w-5 h-5 text-slate-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                    </svg>
                    <span className="text-sm text-slate-400">&quot;High ROE tech stocks with low PE ratios and strong revenue growth&quot;</span>
                  </div>
                  {/* Results mock */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { label: "5yr Return", value: "+187%", color: "text-emerald-400" },
                      { label: "vs S&P 500", value: "+91%", color: "text-emerald-400" },
                      { label: "Matched Stocks", value: "47", color: "text-blue-400" },
                      { label: "Quant Score", value: "84/100", color: "text-cyan-400" },
                    ].map((stat) => (
                      <div key={stat.label} className="rounded-lg bg-slate-800/60 p-3 text-center">
                        <div className={`text-lg sm:text-xl font-bold ${stat.color}`}>{stat.value}</div>
                        <div className="text-[11px] text-slate-500 mt-0.5">{stat.label}</div>
                      </div>
                    ))}
                  </div>
                  {/* Chart mock */}
                  <div className="h-32 sm:h-44 rounded-lg bg-slate-800/40 border border-slate-800 flex items-end px-4 pb-3 gap-[2px] sm:gap-1">
                    {[20, 25, 22, 30, 35, 28, 38, 42, 40, 48, 45, 55, 60, 58, 65, 70, 68, 75, 80, 85, 82, 90, 88, 95, 92, 98, 100].map((h, i) => (
                      <motion.div
                        key={i}
                        className="flex-1 rounded-t bg-gradient-to-t from-blue-600 to-cyan-400 opacity-80"
                        initial={{ height: 0 }}
                        animate={{ height: `${h}%` }}
                        transition={{ duration: 0.8, delay: 0.8 + i * 0.03, ease: "easeOut" }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ── Trust bar ─────────────────────────────────────── */}
      <section className="py-12 border-y border-slate-800/50 bg-slate-900/30">
        <FadeIn>
          <div className="max-w-4xl mx-auto px-4 sm:px-6 flex flex-wrap items-center justify-center gap-8 sm:gap-16">
            <StatCard value="20+" label="Years of market data" />
            <StatCard value="10,000+" label="Stocks analyzed" />
            <StatCard value="12" label="Scoring factors" />
            <StatCard value="4" label="AI-powered modules" />
          </div>
        </FadeIn>
      </section>

      {/* ── How it works ──────────────────────────────────── */}
      <section id="how-it-works" className="py-20 sm:py-28 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto">
          <FadeIn>
            <div className="text-center mb-16">
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
                Three steps. Zero complexity.
              </h2>
              <p className="mt-3 text-base text-slate-400 max-w-lg mx-auto">
                No formulas, no code, no spreadsheets. Just describe what you want and get institutional-quality analysis.
              </p>
            </div>
          </FadeIn>

          <div className="flex flex-col sm:flex-row items-start gap-8 sm:gap-4">
            <StepCard
              step={1}
              title="Describe your strategy"
              description="Type in plain English. &quot;Value stocks with high dividends&quot;, &quot;Tech companies with strong earnings growth&quot;, anything you want to test."
              delay={0.1}
            />
            <FadeIn delay={0.2} className="hidden sm:flex items-center pt-6">
              <div className="w-12 h-px bg-gradient-to-r from-blue-500/50 to-cyan-500/50" />
            </FadeIn>
            <StepCard
              step={2}
              title="SoloQuant runs the backtest"
              description="AI parses your strategy into precise filters and tests it against 20 years of real market data. Results in seconds."
              delay={0.2}
            />
            <FadeIn delay={0.3} className="hidden sm:flex items-center pt-6">
              <div className="w-12 h-px bg-gradient-to-r from-cyan-500/50 to-teal-500/50" />
            </FadeIn>
            <StepCard
              step={3}
              title="See the proof"
              description="Get historical returns, $10K growth charts, matched stocks, and head-to-head comparison against the S&P 500."
              delay={0.3}
            />
          </div>
        </div>
      </section>

      {/* ── Features (4 matching nav) ─────────────────────── */}
      <section className="py-20 sm:py-28 px-4 sm:px-6 bg-gradient-to-b from-transparent via-slate-900/50 to-transparent">
        <div className="max-w-5xl mx-auto">
          <FadeIn>
            <div className="text-center mb-16">
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
                Four tools. One platform.
              </h2>
              <p className="mt-3 text-base text-slate-400 max-w-lg mx-auto">
                Everything you need to research, validate, and execute smarter investment strategies.
              </p>
            </div>
          </FadeIn>

          <div className="grid sm:grid-cols-2 gap-4 sm:gap-5">
            <FeatureCard
              icon={
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18 9 11.25l4.306 4.306a11.95 11.95 0 0 1 5.814-5.518l2.74-1.22m0 0-5.94-2.281m5.94 2.28-2.28 5.941" />
                </svg>
              }
              title="Quant Fund"
              description="AI-generated stock picks powered by the Quant Score. Track live performance vs the S&P 500 with fully transparent monthly returns since inception."
              delay={0}
            />
            <FeatureCard
              icon={
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
                </svg>
              }
              title="AI Backtest Engine"
              description="Describe any strategy in plain English. Our AI translates it into precise filters and backtests it against decades of real market data."
              delay={0.1}
            />
            <FeatureCard
              icon={
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                </svg>
              }
              title="AI Stock Analyzer"
              description="Every stock scored 1-100 with our proprietary Quant Score. Filter, sort, and discover high-conviction opportunities with AI-powered research."
              delay={0.2}
            />
            <FeatureCard
              icon={
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6a7.5 7.5 0 1 0 7.5 7.5h-7.5V6Z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5H21A7.5 7.5 0 0 0 13.5 3v7.5Z" />
                </svg>
              }
              title="AI Portfolio Analyzer"
              description="Import your portfolio and get AI-powered analysis with diversification scores, risk metrics, and optimization recommendations."
              delay={0.3}
            />
          </div>
        </div>
      </section>

      {/* ── Who it's for ──────────────────────────────────── */}
      <section className="py-20 sm:py-28 px-4 sm:px-6">
        <div className="max-w-4xl mx-auto">
          <FadeIn>
            <div className="text-center mb-12">
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
                Built for investors who do their homework.
              </h2>
              <p className="mt-3 text-base text-slate-400 max-w-xl mx-auto">
                You&apos;re not looking for hot tips. You want data, proof, and an edge.
                SoloQuant is the tool you&apos;ve been missing.
              </p>
            </div>
          </FadeIn>

          <div className="grid sm:grid-cols-3 gap-6">
            <FadeIn delay={0.1}>
              <div className="rounded-2xl border border-slate-800 bg-slate-900/30 p-6 text-center">
                <div className="text-2xl mb-3">🔍</div>
                <h3 className="text-sm font-semibold text-white mb-1.5">Self-directed investors</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  You manage your own portfolio and want institutional-quality research tools to validate your thesis.
                </p>
              </div>
            </FadeIn>
            <FadeIn delay={0.2}>
              <div className="rounded-2xl border border-slate-800 bg-slate-900/30 p-6 text-center">
                <div className="text-2xl mb-3">📊</div>
                <h3 className="text-sm font-semibold text-white mb-1.5">Data-driven traders</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  You believe in testing strategies before deploying capital. No more &quot;I think this works.&quot; Now you&apos;ll know.
                </p>
              </div>
            </FadeIn>
            <FadeIn delay={0.3}>
              <div className="rounded-2xl border border-slate-800 bg-slate-900/30 p-6 text-center">
                <div className="text-2xl mb-3">🎯</div>
                <h3 className="text-sm font-semibold text-white mb-1.5">Serious hobbyists</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  You follow markets closely and want the same analytical tools the professionals use, without the $50K price tag.
                </p>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ── Positioning statement ─────────────────────────── */}
      <section className="py-20 sm:py-28 px-4 sm:px-6 relative">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-gradient-to-r from-blue-600/6 to-cyan-500/6 rounded-full blur-3xl" />
        </div>
        <FadeIn>
          <div className="relative max-w-3xl mx-auto text-center">
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight leading-tight">
              Hedge funds spend{" "}
              <span className="text-slate-500 line-through decoration-slate-600">$50,000/year</span>{" "}
              on this.
              <br />
              <span className="bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">
                You spend $0 to start.
              </span>
            </h2>
            <p className="mt-6 text-base text-slate-400 max-w-xl mx-auto leading-relaxed">
              Bloomberg terminals, FactSet, and institutional quant platforms cost tens of thousands per year.
              SoloQuant brings the same backtesting and analysis capabilities to individual investors at a fraction of the cost.
            </p>
            <div className="mt-8">
              <Link
                href="/app/backtest"
                className="inline-flex px-8 py-3.5 text-base font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-xl transition-colors shadow-lg shadow-blue-600/25"
              >
                Try It Free
              </Link>
            </div>
          </div>
        </FadeIn>
      </section>

      {/* ── Trust / methodology ───────────────────────────── */}
      <section className="py-20 sm:py-28 px-4 sm:px-6 bg-gradient-to-b from-transparent via-slate-900/50 to-transparent">
        <div className="max-w-4xl mx-auto">
          <FadeIn>
            <div className="text-center mb-12">
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
                Real data. Real methodology.
              </h2>
              <p className="mt-3 text-base text-slate-400 max-w-lg mx-auto">
                No black boxes. Every score and backtest is built on transparent, verifiable data.
              </p>
            </div>
          </FadeIn>

          <div className="grid sm:grid-cols-2 gap-4">
            <FadeIn delay={0.1}>
              <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
                <h3 className="text-sm font-semibold text-blue-400 uppercase tracking-wider mb-3">Quant Score</h3>
                <p className="text-sm text-slate-400 leading-relaxed">
                  Multi-factor scoring model that evaluates every stock on a 1-100 scale across earnings, growth, value, quality, and risk factors. Higher scores surface stronger opportunities.
                </p>
              </div>
            </FadeIn>
            <FadeIn delay={0.2}>
              <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
                <h3 className="text-sm font-semibold text-cyan-400 uppercase tracking-wider mb-3">Quant Fund</h3>
                <p className="text-sm text-slate-400 leading-relaxed">
                  Stocks that score high enough are automatically added as picks. When scores drop, positions exit. Performance is tracked live vs the S&P 500, with full monthly return history.
                </p>
              </div>
            </FadeIn>
            <FadeIn delay={0.3}>
              <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
                <h3 className="text-sm font-semibold text-emerald-400 uppercase tracking-wider mb-3">AI-Powered NLP</h3>
                <p className="text-sm text-slate-400 leading-relaxed">
                  Advanced language model translates plain English strategy descriptions into precise quantitative filters, or selects specific tickers for qualitative queries.
                </p>
              </div>
            </FadeIn>
            <FadeIn delay={0.4}>
              <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
                <h3 className="text-sm font-semibold text-purple-400 uppercase tracking-wider mb-3">Data Sources</h3>
                <p className="text-sm text-slate-400 leading-relaxed">
                  Market data from Financial Modeling Prep and Yahoo Finance covering 10,000+ securities with 20 years of historical prices for accurate backtesting.
                </p>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ── Pricing teaser ────────────────────────────────── */}
      <section className="py-20 sm:py-28 px-4 sm:px-6">
        <div className="max-w-2xl mx-auto text-center">
          <FadeIn>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
              Free to start. Pro when you&apos;re ready.
            </h2>
            <p className="mt-3 text-base text-slate-400 max-w-lg mx-auto">
              Get started with 3 free backtests per month. Upgrade for unlimited access, live signals, and premium analysis.
            </p>
          </FadeIn>

          <FadeIn delay={0.15}>
            <div className="mt-10 grid sm:grid-cols-2 gap-4 max-w-xl mx-auto">
              {/* Free */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 text-left">
                <div className="text-sm font-semibold text-slate-300">Free</div>
                <div className="mt-2 text-3xl font-bold">$0</div>
                <ul className="mt-4 space-y-2">
                  {["3 backtests/month", "Fund preview", "Portfolio summary", "Research reports"].map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm text-slate-400">
                      <svg className="w-4 h-4 text-slate-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
              {/* Premium */}
              <div className="rounded-2xl border border-blue-500/30 bg-blue-500/5 p-6 text-left relative">
                <div className="absolute -top-2.5 right-4">
                  <span className="text-[10px] font-bold text-white bg-blue-600 px-2 py-0.5 rounded-full">POPULAR</span>
                </div>
                <div className="text-sm font-semibold text-blue-400">Premium</div>
                <div className="mt-2 text-3xl font-bold">$15<span className="text-base font-normal text-slate-400">/mo</span></div>
                <ul className="mt-4 space-y-2">
                  {["Unlimited backtests", "Full Quant Fund access", "Full AI Analyzer", "Priority support"].map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm text-slate-300">
                      <svg className="w-4 h-4 text-blue-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </FadeIn>

          <FadeIn delay={0.25}>
            <div className="mt-6">
              <Link
                href="/app/pricing"
                className="text-sm font-medium text-blue-400 hover:text-blue-300 transition-colors"
              >
                See full pricing details
              </Link>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ── Final CTA ─────────────────────────────────────── */}
      <section className="py-20 sm:py-28 px-4 sm:px-6 relative">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-gradient-to-t from-blue-600/8 to-transparent rounded-full blur-3xl" />
        </div>
        <FadeIn>
          <div className="relative max-w-2xl mx-auto text-center">
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight">
              Ready to be your own quant?
            </h2>
            <p className="mt-4 text-base text-slate-400">
              Test before you invest. Start backtesting in seconds.
            </p>
            <div className="mt-8">
              <Link
                href="/app"
                className="inline-flex px-8 py-3.5 text-base font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-xl transition-colors shadow-lg shadow-blue-600/25"
              >
                Open SoloQuant for Free
              </Link>
            </div>
          </div>
        </FadeIn>
      </section>

      {/* ── Footer ────────────────────────────────────────── */}
      <footer className="border-t border-slate-800/50 py-12 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="none" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
              </svg>
            </div>
            <span className="text-sm font-semibold text-slate-300">SoloQuant</span>
          </div>
          <div className="flex items-center gap-6 text-xs text-slate-500">
            <Link href="/app" className="hover:text-slate-300 transition-colors">App</Link>
            <Link href="/app/pricing" className="hover:text-slate-300 transition-colors">Pricing</Link>
          </div>
          <p className="text-[11px] text-slate-600">
            For educational purposes only. Not financial advice.
          </p>
        </div>
      </footer>
    </div>
  );
}
