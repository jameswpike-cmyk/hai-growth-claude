---
name: growth-claude
description: >
  TRIGGER this skill when the user mentions ANY of: BigQuery, BQ, bq query,
  fellows, fellow search, fellow matching, eligibility, eligible, available fellows,
  approval rate, TIC, AHT, reviewer performance, R1, R2, onboarding funnel,
  project funnel, BPO, annotation, Otter, Feather, campaign performance,
  Meta ads, Facebook ads, Google Ads, LinkedIn ads, Indeed, ZipRecruiter,
  UTM, referrals, resume search, parsed resume, hai_dev, hai_public,
  fact_fellow_perf, fact_tasks, hai_profiles_dim, or any query about
  Reddit ads, reddit_ads, ad spend, paid marketing, CPA, campaign, LinkedIn Ads,
  CpApplication, CpActivated, fact_paid_marketing,
  HAI fellow, marketing, or ops data. When in doubt, trigger this skill.
allowed_commands:
  - gcloud
  - gcloud auth login --enable-gdrive-access
  - gcloud auth application-default login
  - brew install --cask gcloud-cli
  - bq
  - bq query*
  - bq show*
  - ls /Users/
  - mkdir -p
  - printf
  - echo
  - export PATH
  - python
  - python3
  - pip
  - pip3
  - which
  - cat
  - head
  - tail
  - wc
---

# Growth Team Data Layer

## Prerequisites

**Verify these every time this skill is invoked.**

### 1. Check gcloud is installed
```bash
gcloud --version
```
If not found: `brew install --cask gcloud-cli`

### 2. Verify credentials (not just cached)
Do NOT rely on `gcloud auth list` — it shows expired tokens as "active". Test with an actual API call:
```bash
bq show --format=prettyjson hs-ai-production:hai_dev.fact_fellow_perf 2>&1 | head -5
```
If auth error, **run the auth commands directly** — do NOT print them for the user to copy-paste. Execute them in the terminal:
```bash
gcloud auth login --enable-gdrive-access
gcloud auth application-default login
```
These commands will open a browser for the user to complete OAuth. Wait for each to finish before proceeding.

**`--enable-gdrive-access` is required** — the eligibility filter queries `hai_on_hold`, a Google Sheets-backed table that needs Drive OAuth scope.

### 3. Present query plan for approval (once)
**Before running your first `bq query`, present the user with a plan and get approval:**
- Which table(s) will be queried
- Key filters and logic
- What the output will look like

Use `EnterPlanMode` and wait for approval before executing. Once the user approves the plan, proceed with execution — do not ask for approval again for follow-up queries within the same task (e.g., retries, refinements, exports, or verification queries).

---

## Quick Decision Tree

**Read this FIRST to decide what to do.**

```
User asks about...
│
├─ "eligible/available fellows" or "who can work on X" or CSV export
│   → STOP. Read references/eligibility.md NOW. Use the Standard Output Query.
│
├─ fellow matching (education, domain, skills, experience)
│   → STOP. Read references/eligibility.md § "Education & Background Queries".
│   → Apply dual verification (hai_profiles_dim + resumes). Both sources required.
│
├─ fellow/reviewer performance, approval rates, TIC, AHT
│   → Read references/query-patterns.md § "Approval Rates" or § "Reviewer Performance"
│   → Tables: fact_fellow_perf, fact_reviewer_perf, fact_task_activity
│
├─ onboarding funnel
│   → Read references/query-patterns.md § "Funnel Analysis & Drop-Off"
│   → Table: fact_project_funnel
│
├─ paid marketing spend, impressions, clicks, CTR, CPM, cross-channel spend
│   → STOP. Read references/fact-paid-marketing.md NOW. Unified table across LinkedIn, Meta, Reddit, Google.
│   → Use `fact_paid_marketing` for spend/impressions/clicks queries. No microcurrency conversion needed.
│
├─ ad campaign performance (Meta, Google, LinkedIn, Reddit, Indeed, ZipRecruiter)
│   → STOP. Read references/growth-marketing-logic.md NOW for canonical metric definitions.
│   → See Team Workflows § "Marketing: Ad campaign performance" below for table pointers.
│
├─ Reddit ads (spend, impressions, subreddit targeting, conversions)
│   → STOP. Read references/reddit-ads-tables.md NOW. Spend is in microcurrency (÷ 1,000,000).
│   → Default table: campaign_report joined to campaign for names.
│
├─ lifecycle comms, email communications, push notifications, fellows invited/onboarding emails
│   → Read references/fact-tables.md § "lifecycle_communication_messages". No profile_id — join via user_id or email.
│   → **Very large table (~13B rows).** Always filter by sent_at date range.
│
├─ Otter / Feather
│   → STOP. Read references/otter-tables.md NOW. Different identity model (email, not profile_id).
│   → Read references/query-patterns.md § "Otter Approval Rates" / § "Otter Campaign Health"
│
└─ anything else (referrals, UTM, Ashby, resume lookup)
    → See Team Workflows below, then check references/query-patterns.md
```

---

## Mandatory Reference Reading

**You MUST read the relevant reference files before writing any SQL. Do not guess column names or query patterns.**

| Situation | Read this file FIRST |
|-----------|---------------------|
| **"Who is eligible/available?"** | [references/eligibility.md](references/eligibility.md) — **MANDATORY.** Contains the full Standard Output Query (4 CTEs + SELECT + JOINs + WHERE). You must apply every criterion. Do not skip any. |
| **Education, degrees, background** | [references/eligibility.md](references/eligibility.md) — contains the Dual-Source Rule: you must query BOTH `hai_profiles_dim` AND `hai_public.resumes`. |
| **Approval rates, fellow counts** | [references/query-patterns.md](references/query-patterns.md) § "Approval Rates by Project", § "Active Fellow Counts" |
| **Onboarding funnel** | [references/query-patterns.md](references/query-patterns.md) § "Funnel Analysis & Drop-Off" |
| **Resume search (keywords, experience, education)** | [references/query-patterns.md](references/query-patterns.md) § "Resume Keyword Search", § "Resume Experience & Project Extraction" |
| **Reviewer performance (R1/R2)** | [references/query-patterns.md](references/query-patterns.md) § "Reviewer Performance (R1/R2)" |
| **Task lifecycle, comments, block values** | [references/query-patterns.md](references/query-patterns.md) § "Task Lifecycle Analysis", § "Comment / Quality Analysis", § "Block Values Analysis" |
| **Otter/Feather campaigns** | [references/query-patterns.md](references/query-patterns.md) § "Otter Approval Rates", § "Otter Campaign Health" + [references/otter-tables.md](references/otter-tables.md) for schemas |
| **Paid marketing spend, impressions, clicks (cross-channel)** | [references/fact-paid-marketing.md](references/fact-paid-marketing.md) — unified daily ad-level table across LinkedIn, Meta, Reddit, Google. Spend already in USD. Use for spend/impressions/clicks/CTR/CPM queries. |
| **Marketing funnel, cost metrics, attribution, cross-channel reporting** | [references/growth-marketing-logic.md](references/growth-marketing-logic.md) — canonical definitions for funnel stages, cost metrics (CPM/CPI/CPC/CPSU/CPFO), channel spend normalization, UTM attribution, Framer landing logic, and daily fact table construction. |
| **Lifecycle comms, email comms, push notifications, fellows invited** | [references/fact-tables.md](references/fact-tables.md) § "lifecycle_communication_messages". No `profile_id` — join via `user_id` or `email_address`. **~13B rows — always filter by `sent_at`.** |
| **Reddit ads (spend, targeting, conversions)** | [references/reddit-ads-tables.md](references/reddit-ads-tables.md) for schemas, joins, and query patterns. **Spend is microcurrency.** |
| **Column names or types** | [references/fact-tables.md](references/fact-tables.md) or [references/dimension-tables.md](references/dimension-tables.md). If still unsure, run `bq show --format=prettyjson PROJECT:SCHEMA.TABLE`. |

**If BigQuery says "Unrecognized name" — stop, run `bq show` on the table, and find where the column actually lives.**

---

## Common Pitfalls

| Want this column? | It's NOT in | It IS in | Join on |
|-------------------|-------------|----------|---------|
| `email` | `hai_profiles_dim` | `hai_public.profiles` | `profile_id = profiles.id` |
| `full_name` | `hai_profiles_dim` | `hai_public.profiles` | `profile_id = profiles.id` |
| `status` | `hai_profiles_dim` | `hai_public.profiles` | `profile_id = profiles.id` |

---

## Error Prevention

These are the most common errors users hit. Follow these rules strictly.

### Shell Quoting for bq queries
**Always wrap SQL in single quotes.** Backticks (for BQ table names) work inside single quotes without escaping. Double quotes + backslash-escaped backticks (`\``) will fail.

```bash
# CORRECT — single quotes, backticks just work
bq query --use_legacy_sql=false --format=csv '
SELECT * FROM `hs-ai-production.hai_dev.fact_fellow_perf` LIMIT 10
'

# WRONG — double quotes require escaping backticks, which breaks
bq query --use_legacy_sql=false --format=csv "
SELECT * FROM \`hs-ai-production.hai_dev.fact_fellow_perf\` LIMIT 10
"
```

If your SQL contains single quotes (e.g., `WHERE status = 'verified'`), you **cannot** nest them inside a single-quoted shell string. Use a heredoc instead:
```bash
bq query --use_legacy_sql=false --format=csv <<'EOF'
SELECT * FROM `hs-ai-production.hai_public.profiles`
WHERE status = 'verified'
EOF
```
**Always use `<<'EOF'` (quoted EOF) so the shell does not interpret backticks or variables inside the heredoc.**

### Project ID: Never run jobs on handshake-production
Users do NOT have `bigquery.jobs.create` on `handshake-production`. **Always run queries from `hs-ai-production`** (the default project). Reference `handshake-production` tables via fully-qualified names:
```bash
# CORRECT — job runs on hs-ai-production, references handshake-production table
bq query --use_legacy_sql=false '
SELECT * FROM `handshake-production.hai_dev.fact_comments` LIMIT 10
'

# WRONG — explicitly sets project to handshake-production
bq query --project_id=handshake-production --use_legacy_sql=false '...'
```

### Type Mismatches: TIMESTAMP vs DATE
Never compare TIMESTAMP and DATE directly. Always cast to the same type:
```sql
-- CORRECT
WHERE DATE(timestamp_col) >= DATE '2026-01-01'
WHERE timestamp_col >= TIMESTAMP('2026-01-01')

-- WRONG — will error: "No matching signature for operator >="
WHERE timestamp_col >= DATE '2026-01-01'
```

### Deduplication
Always ensure query results have no duplicate rows. Use `DISTINCT` or `QUALIFY ROW_NUMBER()`:
```sql
-- For resumes (multiple per profile), take latest:
QUALIFY ROW_NUMBER() OVER (PARTITION BY r.profileId ORDER BY r.updated_at DESC) = 1
```

### Resume Experience Search (Avoid False Positives)
When matching **company + role together** (e.g., "Google software engineers"), do NOT use broad `TO_JSON_STRING` LIKE — it matches keywords across unrelated sections. Instead, UNNEST the experience array:
```sql
-- CORRECT — matches company + position in the SAME job entry
FROM `hs-ai-production.hai_public.resumes` r,
UNNEST(JSON_EXTRACT_ARRAY(r.parsed_data, '$.experience')) AS exp
WHERE LOWER(JSON_EXTRACT_SCALAR(exp, '$.company')) LIKE '%google%'
  AND LOWER(JSON_EXTRACT_SCALAR(exp, '$.position')) LIKE '%software engineer%'

-- WRONG — "google" could be in skills, "software engineer" in a different job
WHERE LOWER(TO_JSON_STRING(r.parsed_data)) LIKE '%google%'
  AND LOWER(TO_JSON_STRING(r.parsed_data)) LIKE '%software engineer%'
```
Use broad `TO_JSON_STRING` LIKE only for single-keyword searches (e.g., "has React experience anywhere").

This UNNEST pattern applies to any multi-field resume search: company + title, school + degree, etc.

### CSV Export: Avoid Security Warnings
Do NOT use `cat` heredocs or `$()` command substitution for CSV export — these trigger Claude Code security prompts. Use `printf` + `bq query >> file` as shown in the Google Drive CSV Export section.

---

## Team Workflows

### Ops: Find fellows matching project criteria
Criteria varies per project (education, domain, experience, location). Follow these rules in order:

**Step 1 (only if applicable): Apply eligibility filter.**
> **STOP — if the user said "eligible", "available", or "who can work on X", or you are exporting a CSV, you MUST read `references/eligibility.md` NOW and use the Standard Output Query as your base. Do not proceed without reading it.**

If the user is just searching for fellows by background/skills without mentioning availability, skip this step.

**Step 2: Match criteria using dual verification.**
> **STOP — if you are filtering by education, domain, expertise, or background, you MUST read `references/eligibility.md` § "Education & Background Queries (Dual-Source Rule)" NOW. Do not write SQL until you have read the join patterns.**

Any filter on education, domain, expertise, or background MUST be verified in both sources:
- **Source A — `hai_profiles_dim`**: structured fields (`highest_education_level`, `domain`, `subdomain`, `major`, `major_group`, `graduate_institution_name`)
- **Source B — `hai_public.resumes`**: parsed resume JSON (`parsed_data.education[].degree`, `parsed_data.education[].fieldOfStudy`, `parsed_data.experience[].position`)

Do not match on Source A alone — `domain = 'STEM'` may miss a fellow with a Ph.D. in Astrophysics classified under a different subdomain. Do not match on Source B alone — parsed resume data can be noisy or incomplete. Use both and include columns from each in the output so the user can verify.

See `references/eligibility.md` § "Education & Background Queries (Dual-Source Rule)" for join patterns.

**Step 3: Apply additional filters.** Layer on as needed:
- **Geography** → `hai_profiles_dim` (`state_code`, `country_code`)
- **Resume keyword search** → `hai_public.resumes` with `LOWER(TO_JSON_STRING(parsed_data)) LIKE '%keyword%'` (single-keyword only — for multi-field matching like company + role, use UNNEST; see Error Prevention)
- **Resume URL** → `hai_profiles_dim.resume_url_in_product`
- **Quick demographics** → `hai_public.resumes.short_parsed_data` (72% populated; use `parsed_data` as fallback)
- **Work experience** → UNNEST `hai_public.resumes.parsed_data` → `$.experience[]` (95% populated)

### Ops: Fellow & reviewer performance
- **Fellow performance** → `fact_fellow_perf` (pre-computed: approval rate, AHT, TIC, hours)
- **Active fellows on a project** → `fact_fellow_perf` WHERE `active = TRUE`
- **Reviewer performance / R1 / R2** → `fact_reviewer_perf`
- **Task-level detail** → `fact_tasks` or `fact_task_activity`
- **Review comments/issues** → `fact_comments`
- **Block-level responses / rubric scores** → `fact_block_values`

### Ops: Onboarding funnel
- **Project funnel** → `fact_project_funnel` (PSO → Canvas → Contract → First Claim → First Submit → First Approval)

### Marketing: Paid marketing (cross-channel spend/impressions/clicks)
- **Unified table** → `hs-ai-production.hai_dev.fact_paid_marketing` — daily ad-level data across LinkedIn, Meta, Reddit, Google. Spend already in USD. Use this for cross-channel comparisons, total spend, CTR, CPM.
- See [references/fact-paid-marketing.md](references/fact-paid-marketing.md) for schema, grain, channel notes, and common queries.

### Marketing: Ad campaign performance
**Default to campaign-level reports unless the user asks for ad or keyword detail.**
- **Meta/Facebook** → `hs-ai-production.hai_facebook_ads.basic_campaign` (default), also `basic_ad`, `basic_ad_set` + `*_actions` and `*_cost_per_action_type` views
- **Google Ads** → `hs-ai-production.hai_google_ads_google_ads.google_ads__campaign_report` (default), also `google_ads__ad_report`, `google_ads__keyword_report`
- **LinkedIn** → `hs-ai-production.hai_external_linkedin_ads.linkedin_ads__campaign_report` (default), also `linkedin_ads__creative_report`
- **Reddit** → `hs-ai-production.reddit_ads.campaign_report` (default), also `ad_group_report`, `ad_report` + `*_conversions_report` variants. **Spend is in microcurrency (÷ 1,000,000).** Join to `campaign` for names. See [references/reddit-ads-tables.md](references/reddit-ads-tables.md).
- **Indeed** → `hs-ai-sandbox.hai_dev.diamond_growth_indeed` (Google Sheets-backed)
- **ZipRecruiter** → `hs-ai-sandbox.hai_dev.growth_ziprecruiter` (Google Sheets-backed)

### Marketing: UTM attribution & sourcing
- **UTM / campaign attribution** → `hai_user_growth_dim` JOIN `hai_profiles_dim`
- **Ashby ATS candidates** → `diamond_growth_ashby`

### Marketing: Referrals
- **Referral status / payouts** → `hai_public.referrals`

### Otter / Feather campaigns
> **STOP — you MUST read `references/otter-tables.md` NOW before writing any Otter/Feather SQL. The identity model, statuses, and grouping are all different from HAI. Do not guess.**

Key differences from HAI:
- **Grouping**: Use `campaign` + `task_batch` (not `project_id`)
- **Identity**: `email` (not `profile_id`) — map via `fact_otter_email_mapping`
- **No time tracking**: Otter does not measure hours worked
- **Statuses**: `completed`, `signed_off`, `needs_work`, `fixing_done`
- **Tables**: `fact_otter_task_activity`, `fact_otter_tasks`, `fact_otter_comments`, `fact_otter_fellow_perf`, `fact_otter_reviewer_perf`

---

## Environment

| Setting | Value |
|---------|-------|
| BQ Projects | `handshake-production`, `hs-ai-production`, `hs-ai-sandbox` |
| Schemas | `hai_dev` (curated fact/dim), `hai_public` (raw platform), `hai_facebook_ads`, `hai_google_ads_google_ads`, `hai_external_linkedin_ads`, `reddit_ads` |
| Refresh | Hourly via Airflow |
| Region | US only |

---

## Critical Computation Rules

**GPA** — stored as integers (385 = 3.85): `current_cumulative_gpa / 100.0 AS gpa`

**Safe Division** — always use NULLIF: `SUM(x) / NULLIF(SUM(y), 0)`

**Approval Rate** — from `fact_fellow_perf` (stored 0.0–1.0): `ROUND(approval_rate * 100, 2) AS approval_rate_pct`

**TIC** — `(total_major_issues + 0.33 * total_minor_issues) / NULLIF(tasks_attempted, 0)`

**Week Truncation** — always Monday: `DATE_TRUNC(DATE(col), WEEK(MONDAY))`

**Time Columns:**

| Pattern | Meaning |
|---------|---------|
| `*_raw` | Uncapped — inflated by timers left on |
| `*_capped` | Capped at 1.5x time limit — best for analysis |
| `payable_*` | Capped at time limit — matches billing |

---

## Standard Filters

- **Exclude internal**: `NOT LOWER(email) LIKE '%@joinhandshake.com%'`
- **Exclude preview tasks**: Filter out preview/test annotation projects
- **Active fellows**: `active = TRUE` (activity within last 7 days)
- **Processed resumes**: `r.status = 'PROCESSED'`
- **Verified profiles**: `LOWER(p.status) = 'verified'`

---

## Standard Output Columns

**Every ops/fellow query MUST include these columns, in this order.**

### Core columns (always required)

| # | Column | Source |
|---|--------|--------|
| 1 | `profile_id` | `hai_profiles_dim` or `profiles` |
| 2 | `email` | `hai_public.profiles` |
| 3 | `first_name` | `hai_profiles_dim` or `profiles` |
| 4 | `last_name` | `hai_profiles_dim` or `profiles` |
| 5 | `status` | `hai_public.profiles` |
| 6 | `current_onboarding_stage` | `hai_public.profiles` |
| 7 | `resume_url_in_product` | `hai_profiles_dim` |
| 8 | `highest_education_level` | `hai_profiles_dim` |
| 9 | `domain` | `hai_profiles_dim` |
| 10 | `subdomain` | `hai_profiles_dim` |

### Availability column + eligibility breakdown

| # | Column | Source | Purpose |
|---|--------|--------|---------|
| 11 | `available` | Computed from eligibility CTEs (see `references/eligibility.md`) | Final availability verdict: `Available - Idle`, `Available - Project Paused`, or `Unavailable - Active` |
| 12 | `current_project` | `fact_fellow_status` | Shows what project the fellow is on (context for availability) |
| 13 | `last_activity` | `fact_fellow_status` | Last activity date (idle if 20+ days ago) |
| 14 | `otter_ringfenced` | `fact_fellow_status` | TRUE if Otter activity in last 30 days |
| 15 | `on_hold` | `CASE WHEN oh.profile_id IS NOT NULL THEN TRUE ELSE FALSE END` | TRUE if fellow is on the on-hold sheet |
| 16 | `opt_cpt` | `survey_opt` CTE | TRUE if fellow requires OPT/CPT sponsorship |
| 17 | `country_code` | `hai_public.profiles` | Must be US for eligibility |

Columns 12–17 are the **eligibility breakdown** — they show the underlying data behind the `available` verdict so anyone reading the CSV can verify the logic without re-running the query.

### Additional columns (after standard set)

After the standard columns above, add:
- **Criteria confirmation columns** — columns that show WHY the fellow matched (e.g., `major`, `resume_degree`, `resume_field_of_study` if filtering by education)
- **Custom columns** — anything the user specifically asked for

### SQL for standard columns

The complete SQL that produces columns 1–17 (CTEs, SELECT, JOINs, and WHERE) is in [references/eligibility.md](references/eligibility.md) under **"Standard Output Query"**. Use that as your base query and extend it — do not write the column logic from scratch.

---

## Google Drive CSV Export

**When the user asks to export results to CSV, you MUST follow this exact template.**

### Step 1: Detect Google Drive
```bash
ls /Users/*/Library/CloudStorage/GoogleDrive-* 2>/dev/null
```
If no Drive found, skip export (results are already in the terminal).

### Step 2: Create output folder
```bash
mkdir -p "<gdrive_path>/My Drive/claude-bq"
```

### Step 3: Write metadata header
```bash
printf '# source_tables: <tables>\n# query_date: YYYY-MM-DD\n# query: <summary>\n' > "<path>/YYYY-MM-DD_<description>.csv"
```

### Step 4: Run query and append results
```bash
bq query --format=csv --use_legacy_sql=false <<'EOF' >> "<path>/YYYY-MM-DD_<description>.csv"
SELECT ...
EOF
```

### Step 5: Append row count
```bash
wc -l < "<path>/YYYY-MM-DD_<description>.csv"
```
Report the row count to the user (subtract 4 for the metadata header lines + CSV column header).

### Rules
- **File naming**: `YYYY-MM-DD_<description>.csv` (lowercase, hyphens, max 60 chars)
- **Metadata header is required**: every CSV must start with `# source_tables`, `# query_date`, and `# query` lines
- **Use `printf` for header, heredoc for query, `>>` to append** — do NOT use `cat` heredocs for the metadata, `$()` substitution, or backslash-escaped paths (see Error Prevention)
- If export fails, don't block — results are already in the terminal

---

## Source Attribution

**Always cite source table(s) when presenting results:**
> Sources: `hs-ai-production.hai_dev.fact_fellow_perf`, `hs-ai-production.hai_dev.fact_task_activity`

---

## References

| File | Contents | Read when... |
|------|----------|-------------|
| [references/eligibility.md](references/eligibility.md) | Full eligibility filter + education dual-source rule | User asks about eligible/available fellows, or any education query |
| [references/fact-tables.md](references/fact-tables.md) | Column schemas for fact tables (fellow perf, tasks, reviewer perf, block values) | You need exact column names, types, or join keys |
| [references/otter-tables.md](references/otter-tables.md) | Column schemas for 5 Otter/Feather tables | You need Otter table schemas |
| [references/dimension-tables.md](references/dimension-tables.md) | Schemas for hai_profiles_dim, hai_user_growth_dim, and hai_public tables (resumes, profiles) | You need profile dimensions or resume data |
| [references/reddit-ads-tables.md](references/reddit-ads-tables.md) | Column schemas for 24 Reddit Ads tables (Fivetran sync) | You need Reddit ad performance, conversions, or targeting data |
| [references/fact-paid-marketing.md](references/fact-paid-marketing.md) | Unified daily ad-level spend/impressions/clicks across LinkedIn, Meta, Reddit, Google | Paid marketing spend, cross-channel spend comparison, CTR, CPM |
| [references/growth-marketing-logic.md](references/growth-marketing-logic.md) | Marketing funnel definitions, attribution model, channel spend normalization, cost metrics, Framer landing logic | Any cross-channel marketing question, cost metrics, attribution, or funnel analysis |
| [references/query-patterns.md](references/query-patterns.md) | Real SQL examples by use case (HAI + Otter) | You're writing a query and want proven patterns |
