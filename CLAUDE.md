# CLAUDE.md - AI Assistant Guide for `backtest`

## Project Overview

**Repository:** `backtestdev/backtest`
**Status:** Initial setup — this is a new repository being bootstrapped.

## Repository Structure

```
backtest/
├── CLAUDE.md          # This file — AI assistant guide
└── (project files to be added)
```

> **Note:** This file will be updated as the project evolves. When adding new modules, tests, or tooling, update the relevant sections below.

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

*(To be documented once the project tooling is established.)*

## Testing

*(To be documented once a test framework is chosen.)*

## Linting & Formatting

*(To be documented once linting/formatting tools are configured.)*

## Key Conventions

- Keep this CLAUDE.md up to date when adding new tools, frameworks, or workflows
- Prefer simple, direct implementations over abstractions until patterns emerge
- Document non-obvious design decisions in code comments or commit messages

### Core BASH Tools (NO EXCEPTIONS)

# Pattern Search - USE 'rg' ONLY
rg -n "pattern" --glob '!node_modules/*'
rg -l "pattern"              # List matching files
rg -t py "pattern"           # Search Python files only

# File Finding - USE 'fd' ONLY
fd filename                  # Find by name
fd -e py                     # Find Python files
fd -H .env                   # Include hidden

# Bulk Operations - ONE command > many edits
rg -l "old" | xargs sed -i '' 's/old/new/g'

# Preview - USE 'bat'
bat -n filepath              # With line numbers
bat -r 10:50 file            # Lines 10-50

# JSON - USE 'jq'
jq '.dependencies | keys[]' package.json

# Performance Rule 
If you can solve it in 1 CLI command, NEVER use multiple tool calls.

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
