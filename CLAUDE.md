# CLAUDE.md - AI Assistant Guide for `backtest`

## Project Overview

**Repository:** `backtestdev/backtest`
**Status:** Active development — Next.js app with multiple AI-powered stock analysis modules.

## Repository Structure

```
backtest/
├── app/
│   ├── api/
│   │   ├── backtest/route.ts              # POST: parse strategy + run backtest
│   │   ├── leaderboard/route.ts           # GET/POST: leaderboard CRUD
│   │   ├── screener/route.ts              # GET: screener data for AI Stock Analyzer
│   │   ├── signals/route.ts               # GET: quintile signal analysis
│   │   ├── signal-tracker/route.ts        # GET/POST: signal picks & performance
│   │   ├── research/route.ts              # GET/POST: per-ticker research reports
│   │   ├── portfolio/
│   │   │   ├── analyze/route.ts           # POST: AI portfolio analysis
│   │   │   ├── import/route.ts            # POST: portfolio import
│   │   │   ├── parse-image/route.ts       # POST: parse screenshot of holdings
│   │   │   └── saved/route.ts             # GET/POST: saved portfolios
│   │   ├── db/init/route.ts               # POST: initialize all DB tables
│   │   ├── admin/
│   │   │   ├── refresh-data/route.ts      # POST: bulk refresh (3 API calls total)
│   │   │   ├── refresh-prices/route.ts    # POST: Yahoo Finance historical prices
│   │   │   ├── refresh-stocks/route.ts    # GET/POST: rotating per-stock enrichment
│   │   │   ├── refresh-signals/route.ts   # GET/POST: daily signal pick generation
│   │   │   └── cleanup/route.ts           # POST: purge non-company entries
│   │   └── ...
│   ├── backtest/page.tsx                  # AI Stock Screener page
│   ├── screener/page.tsx                  # AI Stock Analyzer page
│   ├── signals/page.tsx                   # Signal Explorer page
│   ├── portfolio/page.tsx                 # AI Portfolio Analyzer page
│   ├── research/[ticker]/page.tsx         # Per-ticker research report
│   ├── admin/stocks/page.tsx              # Admin stock management
│   └── page.tsx                           # Home → Signal Tracker
├── lib/
│   ├── fmpService.ts                      # Stock universe (reads from unified stocks table)
│   ├── yahooFinance.ts                    # Yahoo Finance historical price data
│   ├── stockData.ts                       # Filtering, returns calculation, fallback data
│   ├── backtestEngine.ts                  # Core backtest logic
│   ├── backtestScore.ts                   # Multi-factor scoring model (1-100 scale)
│   ├── stockFilters.ts                    # Non-company entity filtering (ETFs, SPACs, etc.)
│   ├── naturalLanguageParser.ts           # NLP → structured strategy params
│   ├── csvParser.ts                       # CSV parsing for portfolio import
│   ├── moderation.ts                      # Content moderation (bad-words)
│   ├── db.ts                              # Neon PostgreSQL connection + schema
│   └── types.ts                           # Shared TypeScript interfaces
├── scripts/
│   ├── populate-stocks.ts                 # One-time FMP → PostgreSQL population
│   └── cleanup-non-companies.ts           # Purge non-company entries
├── components/
│   ├── Navigation.tsx                     # Top nav with module links
│   ├── SignalTracker.tsx                   # Signal Tracker dashboard (home page)
│   ├── SignalExplorer.tsx                  # Quintile signal analysis dashboard
│   ├── ResearchReport.tsx                 # AI-generated per-ticker research
│   ├── ResearchSearch.tsx                 # Stock search for research
│   ├── AdminStocks.tsx                    # Admin stock management UI
│   ├── StockDetail.tsx                    # Detailed stock info display
│   ├── StockLogo.tsx                      # Stock logo component
│   ├── StrategyChips.tsx                  # Strategy parameter chips
│   ├── StrategyInspector.tsx              # Strategy parameter inspection
│   ├── AutoRefresh.tsx                    # Auto-refresh utility
│   └── ...                                # Additional UI components
├── data/                                  # Fallback JSON data
├── vercel.json                            # Cron jobs + Vercel config
└── CLAUDE.md
```

## Development Workflow

### Git Conventions

- **Default branch:** `main`
- Write clear, concise commit messages describing the *why* of changes
- Keep commits focused — one logical change per commit

### Branch Naming

- Feature branches: `feature/<short-description>`
- Bug fixes: `fix/<short-description>`
- AI-assisted branches: `claude/<descriptor>`

## Build & Run

```bash
npm install
npm run dev          # Start Next.js dev server
npm run build        # Production build
```

### Required Environment Variables

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Neon PostgreSQL connection string |
| `FINANCIAL_MODELING_PREP_API_KEY` | FMP API key (alias: `FMP_API_KEY`) |
| `OPENAI_API_KEY` | GPT model for NLP parsing (optional — falls back to rule-based) |
| `ADMIN_SECRET` | Auth header for admin endpoints (`x-admin-secret`) |
| `CRON_SECRET` | Vercel cron auth (`Authorization: Bearer <CRON_SECRET>`) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk auth (public) |
| `CLERK_SECRET_KEY` | Clerk auth (server) |

### Stock Database Initialization

The app reads stock data from PostgreSQL (Neon) using a single unified `stocks` table.
One-time setup to populate the database:

```bash
# 1. Initialize tables (run once, or after schema changes)
curl -X POST http://localhost:3000/api/db/init

# 2a. RECOMMENDED: Full refresh (screener + per-stock ratios & key-metrics enrichment)
curl -X POST http://localhost:3000/api/admin/refresh-data

# 2b. ALTERNATIVE: Per-stock enrichment via CLI script (slower but more granular)
npx tsx scripts/populate-stocks.ts

# 3. Populate historical prices (Yahoo Finance, 20 years, needed for backtesting charts)
curl -X POST http://localhost:3000/api/admin/refresh-prices
```

### Refreshing Stock Data

Four options to update the stock database:

1. **Full refresh endpoint** (screener + per-stock enrichment):
   ```bash
   curl -X POST http://localhost:3000/api/admin/refresh-data \
     -H "x-admin-secret: $ADMIN_SECRET"
   ```

2. **Historical prices refresh** (Yahoo Finance, 20yr history for backtesting):
   ```bash
   curl -X POST http://localhost:3000/api/admin/refresh-prices \
     -H "x-admin-secret: $ADMIN_SECRET"
   ```

3. **Per-stock enrichment** (rotating batches, good for cron):
   ```bash
   curl -X POST http://localhost:3000/api/admin/refresh-stocks \
     -H "x-admin-secret: $ADMIN_SECRET"
   ```

4. **CLI script** (no rate limit, enriches all stocks):
   ```bash
   npx tsx scripts/populate-stocks.ts
   ```

### Database Schema

All stock data lives in ONE unified table. No JOINs needed.

| Table | Purpose | Primary Key |
|-------|---------|-------------|
| `stocks` | **Unified** — all identity, valuation, profitability, leverage, per-share, efficiency, EV, cash flow metrics in one row per stock | `id` (SERIAL), `symbol` (UNIQUE) |
| `stock_annual_returns` | Annual returns from Yahoo Finance (20yr history) for backtesting | (`symbol`, `year`) |
| `stock_prices` | Historical daily close prices (for charts & signal entry/exit prices) | `id`, UNIQUE(`symbol`, `date`) |
| `stock_meta` | Metadata (last refresh timestamp, enrich offset) | `key` |
| `leaderboard` | Saved strategy results | `id` |
| `signal_picks` | Signal Tracker picks with status (active/sold), entry/exit prices, thesis | `id` |
| `signal_score_history` | Weekly score snapshots for trend analysis | (`symbol`, `date`) |
| `saved_portfolios` | User-saved portfolio configurations | `id` |

The `stocks` table has ~100 metric columns (PE, PB, ROE, dividend yield, etc.).
NULLs are fine — a stock missing PE still appears in queries that don't filter on PE.

## Testing

*(To be documented once a test framework is chosen.)*

## Linting & Formatting

*(To be documented once linting/formatting tools are configured.)*

## OpenAI / NLP Parser Constraints

The NLP parser (`lib/naturalLanguageParser.ts`) uses **gpt-5-mini**, which is a
**reasoning model**. Reasoning models have different API constraints from classic
chat models:

| Parameter | Supported? | Notes |
|-----------|-----------|-------|
| `temperature` | **No** | Only default (1) accepted. Use `reasoning_effort` instead |
| `top_p` | **No** | Not supported on reasoning models |
| `max_tokens` | **No** | Replaced by `max_completion_tokens` |
| `max_completion_tokens` | Yes | Upper bound including reasoning tokens |
| `reasoning_effort` | Yes | `"low"`, `"medium"`, `"high"` (we use `"low"` for speed/cost) |

If switching to a different model in the future, verify which parameters it
supports before changing the API call.

## Architecture Notes

### App Modules

The app has five modules accessible from the top nav (`components/Navigation.tsx`):

1. **Signal Tracker** (`/`) — Home page. Shows AI-generated stock picks with live scoring, performance tracking vs SPY benchmark, and monthly returns since July 2025 inception.
2. **AI Stock Screener** (`/backtest`) — Core tool: screen stocks using natural language, with backtested performance over long time periods.
3. **AI Stock Analyzer** (`/screener`) — Filterable table with Backtest Score (1-100), per-stock AI analysis. Links to per-ticker research reports.
4. **Signal Explorer** (`/signals`) — Quintile analysis showing which metrics (PE, ROE, revenue growth, etc.) predict returns across 5/10/20 year periods.
5. **AI Portfolio Analyzer** (`/portfolio`) — Beta. Manual entry + screenshot upload, AI analysis.

All beta modules use static analysis (current metrics, not point-in-time). This limitation is clearly disclosed in each module's UI.

### Signal Tracker System

The Signal Tracker (`/`) is a fully automated stock-picking system:

- **Inception:** July 1, 2025 with $10k simulated capital
- **Pick generation:** Daily cron (`/api/admin/refresh-signals`) scores all stocks; those with score ≥90-95 (with market cap thresholds) become picks
- **Sell logic:** Picks are sold when score drops below 78
- **Performance:** Tracks monthly returns vs SPY benchmark, weighted by score
- **Deduplication:** GOOG/GOOGL — GOOGL is kept, GOOG is discarded
- **Data flow:** `refresh-signals` cron → `signal_picks` table → `signal-tracker` API → `SignalTracker.tsx` component

### Backtest Score (`lib/backtestScore.ts`)

Multi-factor scoring model producing a 1-100 score per stock:

- 12 weighted factors: earnings yield (20), consecutive earnings growth (15), PE ratio (-10), ROE (10), profit margin (10), beta (8), etc.
- Size confidence dampener based on market cap
- Min-max normalization to 1-100 scale
- Used by Signal Tracker for pick/sell thresholds and by AI Stock Analyzer for stock rankings

### Non-Company Filtering (`lib/stockFilters.ts`)

- `NON_COMPANY_PATTERN` — regex excluding ETFs, SPACs, bonds, trusts, preferred shares, LPs, finance subsidiaries
- `SYMBOL_EXCLUSIONS` — hardcoded blocklist (e.g., `KKRS`)
- Used by screener, signals, and signal tracker to keep results clean

### NLP Ticker Selection Mode

The GPT parser (`lib/naturalLanguageParser.ts`) supports two modes:
1. **Filter mode** (default) — maps user queries to metric-based filters (PE, ROE, etc.)
2. **Ticker selection mode** — for subjective/qualitative queries (e.g., "meme stocks", "stocks with funny names"), GPT returns specific ticker symbols instead of filters

When tickers are returned, `backtestEngine.ts` bypasses metric filtering and selects stocks directly by ticker. It also backfills historical returns from the `stock_annual_returns` DB table via `fmpService.loadReturnsForTickers()` since the in-memory cache may not have returns loaded.

### Backtest Return Calculation

- Uses equal-weight annual rebalancing: each year, the average return of all stocks with data for that year
- Returns are sourced from `stock_annual_returns` table (Yahoo Finance data)
- Current year YTD data is included in chart data but not in period return calculations
- $10k growth chart is normalized dynamically based on the selected time period

### Neon Serverless Driver Gotchas

- **Tagged templates only**: Use `sql\`SELECT ...\`` for simple queries. The driver does NOT support `sql("SELECT $1", [val])` syntax.
- **Parameterized bulk inserts**: Use `sql.query(queryString, paramsArray)` for dynamically-built SQL (e.g., batched INSERT statements with variable placeholders).
- **Batch size**: Bulk inserts should use batches of ~500 rows to avoid serverless function timeouts.

### Column Types

- Use `NUMERIC` (not `BIGINT`) for columns that may receive decimal values from FMP API (market_cap, volume, avg_volume, enterprise_value, working_capital, invested_capital, tangible_asset_value).

### Leaderboard Duplicate Detection

- Uses SHA-256 hash (truncated to 16 hex chars) of sorted strategy parameters for collision-resistant duplicate detection.
- `parameters_hash`: hash of parsed StructuredParameters (catches identical filter sets).
- `query_hash`: hash of normalized user query text (catches ticker-mode dupes where AI returns different ticker lists for the same prompt, e.g., "meme stocks").
- For ticker-mode, `query_hash` is checked first; `parameters_hash` is checked second.
- `created_by` column stores display name for future user attribution.

### Cron Jobs (Vercel)

Configured in `vercel.json`:

| Schedule | Route | Purpose |
|----------|-------|---------|
| 06:00 UTC daily | `GET /api/admin/refresh-stocks` | Per-stock enrichment (rotating batches) |
| 05:00 UTC Sundays | `GET /api/admin/refresh-prices` | Yahoo Finance 20yr price history |
| 07:00 UTC daily | `GET /api/admin/refresh-signals` | Signal Tracker pick generation & sell logic |

Auth: cron routes check `Authorization: Bearer <CRON_SECRET>` header.

### Authentication

Uses **Clerk** (`@clerk/nextjs`) for user authentication. Sign-in/sign-up URLs configured via `NEXT_PUBLIC_CLERK_SIGN_IN_URL` and `NEXT_PUBLIC_CLERK_SIGN_UP_URL` env vars.

### Key Dependencies

- `next` — React framework
- `@neondatabase/serverless` — PostgreSQL driver
- `@clerk/nextjs` — Authentication
- `openai` — GPT model for NLP parsing
- `recharts` — Charting library
- `bad-words` — Content moderation

### TypeScript / Build Gotchas

- **No spread on iterables**: The project targets ES5 (`--downlevelIteration` is off). Do NOT use `[...set]`, `[...map.values()]`, or `[...map.entries()]`. Use `Array.from(set)`, `Array.from(map.entries())`, etc. instead.
- **No `for...of` on Map/Set**: Same reason — use `.forEach()` or convert to array first with `Array.from()`. `for...of` on plain arrays is fine.
- **No unused variables**: ESLint `@typescript-eslint/no-unused-vars` is enforced. Remove any unused const/let before committing.
- Always verify new API routes compile before pushing: check for unused imports, unused variables, and iterable spread patterns.

## Key Conventions

- Keep this CLAUDE.md up to date when adding new tools, frameworks, or workflows
- Prefer simple, direct implementations over abstractions until patterns emerge
- Document non-obvious design decisions in code comments or commit messages


# CRITICAL EFFICIENCY RULES:
  1. Before reading any file: Check if already read in last 10
  messages. If yes, use buffer memory.
  2. Before executing any plan item: Evaluate if actually needed. If
  code already satisfies goal, propose skip.
  3. Choose most direct implementation: MultiEdit batch operations, no
  temp scripts for simple tasks.
  4. Concise by default: No preambles, no postambles, minimal
  explanation unless asked.

  ## File Read Optimization Protocol

  ### Before ANY Read Tool Call:
  1. Check conversation buffer: "Have I read this file in last 10
  messages?"
  2. If YES and no user edits mentioned: Use cached memory, do NOT
  re-read
  3. If uncertain about file state: Check git status or ask user
  4. Exception: User explicitly says "check file again"
