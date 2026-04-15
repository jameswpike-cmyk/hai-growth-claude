# hai-growth-claude

AI-powered workflow layer for the Handshake AI Growth team. Instead of being the middleware between tools yourself — jumping between BigQuery, Slack, Google Sheets, and Iterable — you describe what you need in plain English and Claude does the heavy lifting.

Whether you're qualifying 500 Biology PhDs for a project, diagnosing a funnel drop-off, setting up drip campaigns, or comparing ad spend across channels, Growth Claude should be your starting point for every use case.

This is a [Claude Code plugin](https://docs.anthropic.com/en/docs/claude-code) that gives Claude deep knowledge of HAI's data, schemas, query patterns, and operational workflows.

## What It Does

- **Fellow sourcing & eligibility** — find available fellows matching project criteria, apply eligibility + availability logic, export CSVs for SPL handoff
- **Project funnels** — onboarding conversion, engagement scoring, drop-off diagnosis, drip campaign setup for Iterable
- **Marketing & campaigns** — Meta/Google/LinkedIn/Reddit/Indeed ads, UTM attribution, CPA, lifecycle comms performance
- **Fellow & reviewer performance** — approval rates, TIC, AHT, R1/R2 reviewer metrics, outlier detection

## Setup

### 1. Clone the repo

```bash
gh repo clone jameswpike-cmyk/hai-growth-claude ~/hai-growth-claude
```

### 2. Add the command file

Create `~/.claude/commands/growth.md`:

```markdown
---
name: growth-claude
description: >
  BigQuery semantic data layer for Handshake AI (HAI). Provides schema knowledge,
  SQL patterns, and data quality rules.
allowed_commands:
  - gcloud --version
  - brew install --cask gcloud-cli
  - gcloud auth login
  - gcloud auth login --enable-gdrive-access
  - gcloud auth application-default login
  - gcloud auth print-access-token
  - bq query
  - bq show
---

$ARGUMENTS

Read and follow the instructions in the skill file at:
~/hai-growth-claude/SKILL.md

Also read any relevant reference files from:
~/hai-growth-claude/references/
```

> **Note:** Replace `~` with your full home directory path (e.g., `/Users/yourname/hai-growth-claude/`).

### 3. Authenticate

```bash
gcloud auth login --enable-gdrive-access
gcloud auth application-default login
```

## Key Concepts

### Eligibility vs Availability

These are two distinct concepts used in fellow queries:

**Eligibility** — can this fellow ever work on HAI projects? A one-time gate based on:
- Profile status is `verified` and onboarding stage is `fully-onboarded`
- KYC completed (required — `verified` alone is insufficient due to a legacy silent KYC workflow)
- Not on the on-hold list, US-based, no OPT/CPT sponsorship requirement

**Availability** — is this fellow free to be placed on a project *right now*? A dynamic check on top of eligibility:
- `Available - Idle` → no activity in 20+ days, or current project is offboarded
- `Available - Project Paused` → on a project but it's currently paused
- `Unavailable - Active` → activity in the last 20 days on an active project
- `otter_ringfenced` → Otter activity in the last 30 days (treated as committed even if otherwise idle)

Every ops query asking "who can work on X" needs both — eligibility filters the base population, availability tells you which of those are free right now.

---

## Usage

In Claude Code, run:

```
/growth <your question>
```

Examples:
- `/growth what's the approval rate for project X this week?`
- `/growth show me fellow onboarding funnel for the last 30 days`
- `/growth compare Reddit vs Meta ad spend and CPA this month`

## Repo Structure

```
├── .claude-plugin/
│   └── plugin.json          # Plugin metadata
├── SKILL.md                 # Main skill instructions & prerequisites
├── references/
│   ├── dimension-tables.md                       # Dimension table schemas
│   ├── eligibility.md                            # Fellow eligibility logic
│   ├── engagement-score.md                       # Fellow engagement tier definitions & queries
│   ├── fact-hai-attribution.md                   # Best attribution table — enriched UTM, Indeed backfill, funnel/cost metrics
│   ├── fact-paid-marketing.md                    # Cross-channel ad spend (LinkedIn/Meta/Reddit/Google + Indeed)
│   ├── fact-tables.md                            # Fact table schemas
│   ├── lifecycle-comms.md                        # Lifecycle email/push communications (~13B rows)
│   ├── onboarding-funnel-drip-campaign-setup.md  # BQ + Fivetran funnel flag queries for Census/Iterable
│   ├── otter-tables.md                           # Otter/Feather campaign tables
│   ├── query-patterns.md                         # Common query patterns & examples
│   └── reddit-ads-tables.md                      # Reddit ads schema
└── README.md
```

## Updating

Pull the latest changes:

```bash
cd ~/hai-growth-claude && git pull
```

## Contributing

1. Create a branch
2. Update skill/reference files
3. Open a PR
