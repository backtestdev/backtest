# CLAUDE.md - AI Assistant Guide for `backtest`

## Project Overview

**Repository:** `backtestdev/backtest`
**Status:** Initial setup — this is a new repository being bootstrapped.

## Repository Structure

```
backtest/
├── app/api/
│   ├── backtest/route.ts            # POST: parse strategy + run backtest
│   ├── leaderboard/route.ts         # GET/POST: leaderboard CRUD
│   ├── db/init/route.ts             # POST: initialize all DB tables
│   └── admin/refresh-stocks/route.ts # POST: refresh stock DB from FMP API
├── lib/
│   ├── fmpService.ts                # Stock universe (reads from PostgreSQL)
│   ├── stockData.ts                 # Filtering, returns calculation, fallback data
│   ├── backtestEngine.ts            # Core backtest logic
│   ├── naturalLanguageParser.ts     # NLP → structured strategy params
│   ├── db.ts                        # Neon PostgreSQL connection
│   └── types.ts                     # Shared TypeScript interfaces
├── scripts/
│   └── populate-stocks.ts           # One-time FMP → PostgreSQL population
├── components/                      # React UI components
├── data/                            # Fallback JSON data
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

The app reads stock data from PostgreSQL (Neon) instead of making live FMP API calls.
One-time setup to populate the database:

```bash
# 1. Initialize tables (run once, or after schema changes)
curl -X POST http://localhost:3000/api/db/init

# 2. Populate stock data from FMP API (~5 min, requires both env vars)
npx tsx scripts/populate-stocks.ts
```

**Required env vars:**
- `DATABASE_URL` — Neon PostgreSQL connection string
- `FINANCIAL_MODELING_PREP_API_KEY` — FMP API key (alias: `FMP_API_KEY`)

### Refreshing Stock Data

Two options to update the pre-built database:

1. **Admin endpoint** (rate-limited to 1/hour):
   ```bash
   curl -X POST http://localhost:3000/api/admin/refresh-stocks \
     -H "x-admin-secret: $ADMIN_SECRET"
   ```

2. **CLI script** (no rate limit):
   ```bash
   npx tsx scripts/populate-stocks.ts
   ```

### Database Schema (stock tables)

| Table | Purpose | Primary Key |
|-------|---------|-------------|
| `stocks` | Identity & screener data (symbol, sector, market cap) | `symbol` |
| `quotes` | Price, P/E, volume, 52-week range | `symbol` |
| `ratios` | Fundamental metrics (P/B, ROE, D/E, etc.) | `symbol` |
| `profiles` | Growth rates, profit margin, historical returns | `symbol` |
| `stock_meta` | Metadata (last refresh timestamp) | `key` |
| `leaderboard` | Saved strategy results | `id` |

## Testing

*(To be documented once a test framework is chosen.)*

## Linting & Formatting

*(To be documented once linting/formatting tools are configured.)*

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
