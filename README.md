# Backtest

Test stock market investment strategies using plain English. Type a strategy like "Buy stocks with P/E under 15 and dividend yield over 3%" and see how it would have performed over the last 20 years compared to the S&P 500.

## Quick Start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment Variables

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | No | OpenAI API key for natural language parsing. Falls back to rule-based parsing if not set. |

The app works without any API keys using built-in rule-based strategy parsing and a representative stock dataset.

## How It Works

1. **Enter a strategy** in plain English (or click an example chip)
2. **Natural language parsing** converts your strategy to stock filters (via OpenAI GPT-4o-mini, or rule-based fallback)
3. **Backtest engine** filters a dataset of ~60 well-known stocks and calculates historical returns
4. **Results** show performance over 1yr, 5yr, 10yr, and 20yr vs S&P 500 benchmark
5. **Leaderboard** tracks top-performing strategies

## Tech Stack

- Next.js 14 (App Router) + TypeScript + Tailwind CSS
- OpenAI API (gpt-4o-mini) for natural language parsing
- Recharts for performance visualization
- JSON file storage for leaderboard

## Project Structure

```
app/
  page.tsx                    # Main page
  api/backtest/route.ts       # Backtest API endpoint
  api/leaderboard/route.ts    # Leaderboard CRUD
components/
  BacktestInput.tsx           # Strategy input + submit
  StrategyChips.tsx           # Example strategy buttons
  ResultsDisplay.tsx          # Results cards + stock list
  ResultsChart.tsx            # Performance line chart
  Leaderboard.tsx             # Top strategies table
lib/
  types.ts                    # TypeScript interfaces
  backtestEngine.ts           # Core backtest logic
  naturalLanguageParser.ts    # NLP → structured params
  stockData.ts                # Stock dataset + filtering
data/
  leaderboard.json            # Persisted leaderboard
```

## Deploy to Vercel

1. Push to GitHub
2. Import in Vercel
3. Add `OPENAI_API_KEY` environment variable (optional)
4. Deploy

Note: The leaderboard uses file-system storage which resets on each Vercel deployment. For persistent storage, swap to a database.

## Limitations

- Uses a representative dataset of ~60 major stocks (not full S&P 500)
- Historical returns are approximate annual figures
- Results may include survivorship bias
- For educational purposes only, not financial advice
