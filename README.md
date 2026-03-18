# hai-growth-claude

BigQuery semantic data layer for the Handshake AI Growth team. This is a [Claude Code plugin](https://docs.anthropic.com/en/docs/claude-code) that gives Claude knowledge of our schema, query patterns, and data quality rules.

## What It Does

Provides Claude with context to query and analyze:
- **Fellow performance** — approval rates, TIC, AHT, reviewer metrics (R1/R2)
- **Project funnels** — onboarding, pipeline state, project lifecycle
- **Marketing & campaigns** — Meta/Google/LinkedIn/Reddit ads, UTM tracking, CPA
- **Fellow profiles** — eligibility, resume data, fellow search/matching
- **Annotation ops** — task workflows, review comments, block values

## Setup

### 1. Clone the repo

```bash
gh repo clone jameswpike-cmyk/hai-growth-claude ~/hai-growth-claude
```

### 2. Add the command file

Create `~/.claude/commands/growth.md`:

```markdown
---
name: hai-growth-bigquery
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
│   ├── dimension-tables.md  # Dimension table schemas
│   ├── eligibility.md       # Fellow eligibility logic
│   ├── fact-tables.md       # Fact table schemas
│   ├── growth-marketing-logic.md  # Marketing metric definitions
│   ├── otter-tables.md      # Otter/Feather campaign tables
│   ├── query-patterns.md    # Common query patterns & examples
│   └── reddit-ads-tables.md # Reddit ads schema
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
