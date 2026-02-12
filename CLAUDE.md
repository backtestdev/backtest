# CLAUDE.md - AI Assistant Guide for `backtest`

## Project Overview

**Repository:** `backtestdev/backtest`
**Status:** Initial setup — this is a new repository being bootstrapped.

## Repository Structure

```
backtest/
├── app/api/
│   ├── backtest/route.ts              # POST: parse strategy + run backtest
│   ├── leaderboard/route.ts           # GET/POST: leaderboard CRUD
│   ├── db/init/route.ts               # POST: initialize all DB tables
│   ├── admin/refresh-data/route.ts    # POST: bulk refresh (3 API calls total)
│   ├── admin/refresh-stocks/route.ts  # GET/POST: rotating per-stock enrichment
│   └── admin/cleanup/route.ts         # POST: purge non-company entries
├── lib/
│   ├── fmpService.ts                  # Stock universe (reads from unified stocks table)
│   ├── stockData.ts                   # Filtering, returns calculation, fallback data
│   ├── backtestEngine.ts              # Core backtest logic
│   ├── naturalLanguageParser.ts       # NLP → structured strategy params
│   ├── db.ts                          # Neon PostgreSQL connection + schema
│   └── types.ts                       # Shared TypeScript interfaces
├── scripts/
│   ├── populate-stocks.ts             # One-time FMP → PostgreSQL population
│   └── cleanup-non-companies.ts       # Purge non-company entries
├── components/                        # React UI components
├── data/                              # Fallback JSON data
└── CLAUDE.md
```

## Development Workflow

### Git Conventions

- **Default branch:** `main` (to be established with first push)
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

### Stock Database Initialization

The app reads stock data from PostgreSQL (Neon) using a single unified `stocks` table.
One-time setup to populate the database:

```bash
# 1. Initialize tables (run once, or after schema changes)
curl -X POST http://localhost:3000/api/db/init

# 2a. RECOMMENDED: Bulk refresh via 3 API calls (screener + ratios-ttm-bulk + key-metrics-ttm-bulk)
curl -X POST http://localhost:3000/api/admin/refresh-data

# 2b. ALTERNATIVE: Per-stock enrichment via CLI script (slower but more granular)
npx tsx scripts/populate-stocks.ts
```

**Required env vars:**
- `DATABASE_URL` — Neon PostgreSQL connection string
- `FINANCIAL_MODELING_PREP_API_KEY` — FMP API key (alias: `FMP_API_KEY`)

### Refreshing Stock Data

Three options to update the stock database:

1. **Bulk refresh endpoint** (3 API calls total — fastest):
   ```bash
   curl -X POST http://localhost:3000/api/admin/refresh-data \
     -H "x-admin-secret: $ADMIN_SECRET"
   ```

2. **Per-stock enrichment** (rotating batches, good for cron):
   ```bash
   curl -X POST http://localhost:3000/api/admin/refresh-stocks \
     -H "x-admin-secret: $ADMIN_SECRET"
   ```

3. **CLI script** (no rate limit, enriches all stocks):
   ```bash
   npx tsx scripts/populate-stocks.ts
   ```

### Database Schema

All stock data lives in ONE unified table. No JOINs needed.

| Table | Purpose | Primary Key |
|-------|---------|-------------|
| `stocks` | **Unified** — all identity, valuation, profitability, leverage, per-share, efficiency, EV, cash flow metrics in one row per stock | `id` (SERIAL), `symbol` (UNIQUE) |
| `stock_prices` | Historical daily close prices (for charts) | `id`, UNIQUE(`symbol`, `date`) |
| `stock_meta` | Metadata (last refresh timestamp, enrich offset) | `key` |
| `leaderboard` | Saved strategy results | `id` |

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
