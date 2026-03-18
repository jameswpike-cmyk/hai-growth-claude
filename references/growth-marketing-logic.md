# Growth Marketing Logic & Metric Definitions

**Source of truth:** [HAI Marketing] Marketing & ToFu Dashboard (Hex)
**Purpose:** Canonical definitions for marketing funnel metrics, attribution logic, channel spend normalization, and cross-channel reporting. Use this file to ensure consistency when answering marketing questions.

---

## Marketing Funnel Stages

The marketing funnel tracks users from ad impression through to productive work. All stage definitions below are the canonical ones used across channels.

| # | Stage | Column Name | Definition |
|---|-------|-------------|------------|
| 1 | **Impressions** | `impressions` | Ad platform-reported impressions |
| 2 | **Clicks** | `clicks` | Ad platform-reported clicks (see channel-specific notes below) |
| 3 | **Framer Lands** | `framer_lands` | First-touch Framer page loads attributed to a campaign, pre-conversion only |
| 4 | **Sign-ups** | `sign_ups` / `applicants` | Distinct `profile_id`s created via the signup flow, attributed by `campaign_id` |
| 5 | **App Complete** | `app_complete` | Sign-ups who completed the application (`current_onboarding_stage != 'assessment-application'`) |
| 6 | **Fully-Onboarded** | `fully_onboarded` | Sign-ups who reached `current_onboarding_stage = 'fully-onboarded'` |
| 7 | **Allocated** | `allocated` | Fully-onboarded fellows with a PSO allocation (`allocated_at IS NOT NULL` from `fact_project_funnel`) |
| 8 | **Activated** | `activated` | Allocated fellows who submitted their first task (`activated_at IS NOT NULL` from `fact_task_activity_incl_otter`) |

### Stage Attribution Rules

- **Stages 1-2** (Impressions, Clicks): come directly from ad platform data, keyed on `campaign_id + date`
- **Stage 3** (Framer Lands): from `handshake_ai_segment_events` where `event.name = 'Framer page load'`, first-touch attribution, pre-conversion only
- **Stages 4-8** (Sign-ups through Activated): from the `applied` CTE which joins `hai_user_growth_dim` (attribution) → `hai_profiles_dim` (onboarding stage) → `fact_project_funnel` (allocation) → `fact_task_activity_incl_otter` (activation)

---

## Cost Metrics

All cost metrics use the formula: `SUM(spend) / NULLIF(SUM(volume_metric), 0)`

| Metric | Display Name | Formula |
|--------|-------------|---------|
| CPM | Cost per 1,000 Impressions | `SUM(spend) / SUM(impressions) * 1000` — **only for CPM channels (Reddit, Meta)** |
| CPI | Cost per Impression | `SUM(spend) / SUM(impressions)` — **only for non-CPM channels (LinkedIn, Google)** |
| CPC | Cost per Click | `SUM(spend) / SUM(clicks)` |
| CPFL | Cost per Framer Land | `SUM(spend) / SUM(framer_lands)` |
| CPSU | Cost per Sign-up | `SUM(spend) / SUM(sign_ups)` |
| CPA (App) | Cost per App Complete | `SUM(spend) / SUM(app_complete)` |
| CPFO | Cost per Fully-Onboarded | `SUM(spend) / SUM(fully_onboarded)` |
| CPAlloc | Cost per Allocated | `SUM(spend) / SUM(allocated)` |
| CPAct | Cost per Activated | `SUM(spend) / SUM(activated)` |

### CPM vs CPI Rule

- **Reddit and Meta** are CPM channels → use `spend / impressions * 1000`
- **LinkedIn and Google** are CPI channels → use `spend / impressions` (no * 1000)
- When aggregating across channels, split the impression cost calculation:
```sql
SUM(CASE WHEN source IN ('reddit', 'meta') THEN spend ELSE 0 END)
  / NULLIF(SUM(CASE WHEN source IN ('reddit', 'meta') THEN impressions ELSE 0 END), 0) * 1000 AS cpm_reddit_meta,
SUM(CASE WHEN source NOT IN ('reddit', 'meta') THEN spend ELSE 0 END)
  / NULLIF(SUM(CASE WHEN source NOT IN ('reddit', 'meta') THEN impressions ELSE 0 END), 0) AS cpi_linkedin_google
```

---

## Channel Spend Normalization

Each ad platform stores spend differently. The dashboard normalizes all spend to **USD dollars** before any calculations.

| Channel | `utm_source` value | Spend Source | Normalization |
|---------|-------------------|-------------|---------------|
| **LinkedIn** | `linkedin_ads` | `linkedin_ads__campaign_report.cost` | Already in USD dollars |
| **Meta** | `meta` | `basic_ad.spend` | Already in USD dollars |
| **Reddit** | `reddit` | `reddit_ads.ad_report.spend` | **Microcurrency — divide by 1,000,000** |
| **Google** | `google` | `google_ads__campaign_report.spend` | Already in USD dollars |

### Channel-Specific Spend Queries

**LinkedIn** — uses corrected impressions from `ad_analytics_by_creative` (not the campaign report's native impressions):
```sql
WITH creative_to_campaign AS (
    SELECT DISTINCT creative_id, campaign_id
    FROM `hs-ai-production.hai_external_linkedin_ads.linkedin_ads__creative_report`
),
corrected_metrics AS (
    SELECT ctc.campaign_id, DATE(a.day) AS date,
        SUM(a.opens) AS impressions,
        SUM(a.landing_page_clicks) AS clicks
    FROM `hs-ai-production.hai_external.ad_analytics_by_creative` a
    JOIN creative_to_campaign ctc ON a.creative_id = ctc.creative_id
    GROUP BY 1, 2
)
SELECT r.campaign_name, 'linkedin_ads' AS channel,
    CAST(r.campaign_id AS STRING) AS campaign_id,
    DATE(r.date_day) AS date,
    COALESCE(c.impressions, 0) AS impressions,
    COALESCE(c.clicks, 0) AS clicks,
    COALESCE(r.cost, 0) AS spend
FROM `hs-ai-production.hai_external_linkedin_ads.linkedin_ads__campaign_report` r
LEFT JOIN corrected_metrics c ON r.campaign_id = c.campaign_id AND DATE(r.date_day) = c.date
```

**Meta** — aggregates from ad-level, joins through ad_set to get campaign_name:
```sql
SELECT c.campaign_name, 'meta' AS channel, c.campaign_id, ad.date,
    SUM(ad.impressions) AS impressions,
    SUM(ad.inline_link_clicks) AS clicks,
    SUM(ad.spend) AS spend
FROM `hs-ai-production.hai_facebook_ads.basic_ad` ad
LEFT JOIN (SELECT DISTINCT adset_name, campaign_name FROM `hs-ai-production.hai_facebook_ads.basic_ad_set`) adset
    ON ad.adset_name = adset.adset_name
LEFT JOIN (SELECT DISTINCT campaign_name, campaign_id FROM `hs-ai-production.hai_facebook_ads.basic_campaign`) c
    ON adset.campaign_name = c.campaign_name
GROUP BY campaign_name, campaign_id, date
```

**Reddit** — aggregates from ad-level, divides spend by 1M:
```sql
SELECT c.name AS campaign_name, 'reddit' AS channel, a.campaign_id, ar.date,
    SUM(ar.impressions) AS impressions,
    SUM(ar.clicks) AS clicks,
    SUM(ar.spend / 1000000) AS spend
FROM `hs-ai-production.reddit_ads.ad_report` ar
LEFT JOIN `hs-ai-production.reddit_ads.ad` a ON ar.ad_id = a.id
LEFT JOIN `hs-ai-production.reddit_ads.campaign` c ON a.campaign_id = c.id
GROUP BY campaign_name, campaign_id, date
```

**Google** — already normalized at campaign level:
```sql
SELECT campaign_name, 'google' AS channel,
    CAST(campaign_id AS STRING) AS campaign_id,
    date_day AS date, impressions, clicks, spend
FROM `hs-ai-production.hai_google_ads_google_ads.google_ads__campaign_report`
```

### Cross-Channel Union Pattern

To get all channels in one table with consistent schema `(campaign_name, channel, campaign_id, date, impressions, clicks, spend)`:
```sql
SELECT * FROM linkedin_campaign_details
UNION ALL
SELECT * FROM meta_campaign_details
UNION ALL
SELECT * FROM reddit_campaign_details
UNION ALL
SELECT * FROM google_campaign_details
```

---

## Attribution Model

### UTM-Based First-Touch Attribution

Attribution uses `hai_user_growth_dim.last_touch_utm_source` and `last_touch_campaign_id` to link sign-ups to campaigns.

```sql
SELECT
    g.user_id AS profile_id,
    g.last_touch_utm_source AS utm_source,
    g.last_touch_campaign_id AS campaign_id,
    g.last_touch_adset_id AS adset_id,
    g.last_touch_ad_id AS ad_id
FROM hai_dev.hai_user_growth_dim g
WHERE g.last_touch_utm_source IN ('linkedin_ads', 'google', 'meta', 'reddit')
```

### Applied (Sign-up) CTE

The `applied` CTE joins attribution → profile → allocation → activation:

```sql
SELECT
    ac.*,
    p.applied_at,
    p.current_onboarding_stage,
    p.current_onboarding_stage != 'assessment-application' AS application_complete,
    p.current_onboarding_stage = 'fully-onboarded' AS fully_onboarded,
    a.first_allocation_project,
    a.allocated_at,
    DATE_DIFF(DATE(a.allocated_at), DATE(p.applied_at, 'America/Los_Angeles'), DAY) AS days_until_allocation,
    act.first_activation_project,
    act.activated_at,
    DATE_DIFF(DATE(act.activated_at), DATE(p.applied_at), DAY) AS days_until_activation
FROM attribution_candidates ac
LEFT JOIN hai_dev.hai_profiles_dim p ON ac.profile_id = p.profile_id
LEFT JOIN allocation a ON ac.profile_id = a.profile_id
LEFT JOIN activation act ON ac.profile_id = act.profile_id
WHERE campaign_id IS NOT NULL AND campaign_id != ''
```

Where:
- **allocation** = first PSO allocation from `fact_project_funnel` (earliest `pso_allocated_pst`)
- **activation** = first task activity from `fact_task_activity_incl_otter` (earliest `created_at`)

### Timezone Rules

- `applied_at` → convert to PST: `CAST(applied_at AT TIME ZONE 'America/Los_Angeles' AS DATE)`
- `allocated_at` → already stored in PST (from `pso_allocated_pst`)
- Framer events → `created_at` is UTC; convert for daily aggregation: `DATE(created_at AT TIME ZONE 'America/Los_Angeles')`

---

## Framer Landing Attribution

Framer page loads are the first website touchpoint tracked after an ad click. Attribution logic differs between the cross-channel summary and the Reddit deep-dive.

### Cross-Channel Framer Lands (all channels)

**Source:** `hs-ai-production.hai_public.handshake_ai_segment_events` where `event.name = 'Framer page load'`

**UTM extraction priority:**
1. URL query param: `utm_source=([^&]+)` from `context.page.search`
2. Event property: `properties.utm_source`
3. LinkedIn fallback: if `li_fat_id=` present in URL → `'linkedin_ads'`

**Campaign ID extraction (channel-dependent):**
- For `google` and `meta`: `campaign_id=([^&]+)` from URL
- For all others (LinkedIn, Reddit): `campaignid=([^&]+)` from URL
- Fallbacks: `properties.campaign_id`, `properties.campaignId`, `properties.campaignid`

**First-touch dedup:**
1. Per `anonymous_id`: keep only lands **before** conversion (first `profileId` association)
2. Take earliest qualifying land per `anonymous_id`
3. Deduplicate across `anonymous_id`s sharing the same `profile_id` — keep the one with the earlier first touch

**Conversion definition:** user's `anonymous_id` subsequently appeared with a non-empty `profileId` in segment events.

### Reddit Framer Lands (deep-dive)

Reddit-specific Framer attribution adds ad group and ad-level granularity:

```sql
WHERE event.name = 'Framer page load'
  AND REGEXP_CONTAINS(JSON_VALUE(context, '$.page.search'), r'utm_source=reddit')
```

**Additional ID extraction:**
- `adset_id=([^&]+)` → maps to `ad_group_id` in Reddit
- `ad_id=([^&]+)` → maps to `ad.id` in Reddit

**Prioritization within QUALIFY:**
1. Events with **both** `adset_id` AND `ad_id` present (most specific attribution)
2. Earliest timestamp (true first touch)

**Known issue:** ~7 profiles have unresolvable Reddit macro UTM values (`%%7B%7B...%%7D%7D`) and will not join to spend data. This is a Reddit tracking platform issue.

---

## Daily Fact Table (Cross-Channel Pivot)

The core reporting table joins spend, landings, and applicant funnel data into a single daily fact:

```sql
SELECT
    COALESCE(adf.applied_date, cds.date, ld.date) AS date,
    COALESCE(adf.utm_source, <channel detection from campaign_id>) AS source,
    COALESCE(adf.campaign, lc.campaign_name, rc.campaign_name, mc.campaign_name, gc.campaign_name) AS campaign,
    COALESCE(adf.campaign_id, cds.campaign_id, ld.campaign_id) AS campaign_id,
    COALESCE(cds.impressions, 0) AS impressions,
    COALESCE(cds.clicks, 0) AS clicks,
    COALESCE(ld.count_of_landings, 0) AS framer_lands,
    COALESCE(adf.applicants, 0) AS count_of_applicants,
    COALESCE(adf.app_complete, 0) AS count_of_app_complete,
    COALESCE(adf.fully_onboarded, 0) AS count_of_fully_onboarded,
    COALESCE(adf.allocated, 0) AS count_of_allocated,
    COALESCE(adf.activated, 0) AS count_of_activated,
    COALESCE(cds.spend, 0) AS daily_spend
FROM applied_daily_fact adf
FULL OUTER JOIN campaign_spend cds ON adf.applied_date = cds.date AND adf.campaign_id = cds.campaign_id
FULL OUTER JOIN landings_daily ld ON ... AND ... = ld.campaign_id
LEFT JOIN linkedin_campaigns lc ON ... = lc.campaign_id
LEFT JOIN reddit_campaigns rc ON ... = rc.campaign_id
LEFT JOIN meta_campaigns mc ON ... = mc.campaign_id
LEFT JOIN google_campaigns gc ON ... = gc.campaign_id
WHERE campaign_name IS NOT NULL  -- exclude unmatched campaign_ids
```

**Key design decisions:**
- `FULL OUTER JOIN` between spend, landings, and applicants — so days with spend but no sign-ups (and vice versa) still appear
- Channel detection: if the applicant CTE didn't provide `utm_source`, infer from which campaign lookup table matched the `campaign_id`
- `campaign_name IS NOT NULL` filter excludes orphan `campaign_id`s that don't match any channel

---

## Framer Page Lands Metrics (WoW)

Four distinct landing metrics are tracked weekly:

| Metric | Definition |
|--------|-----------|
| **Total Lands** | Raw count of all `Framer page load` events (no dedup, includes repeat + post-conversion visits). Excludes homepage (`https://joinhandshake.com/`). |
| **Unique User Lands** | One count per unique user (`profile_id` if converted, else `anonymous_id`), assigned to the week of their **earliest** Framer land. |
| **Unique Preconversion Lands** | Same dedup as Unique User Lands, but only users whose earliest Framer land was **before** their conversion (or who never converted). |
| **Conversions** | Of users in Unique Preconversion Lands, how many eventually got a `profile_id`. Assigned to the week of their **pre-conversion land**, not the week of conversion. |

**Preconversion conversion rate:** `conversions / unique_preconv_lands * 100`

---

## Sign-up Page Conversion (L14D)

Measures the signup page land → account creation conversion rate by channel over the last 14 days.

**Signal:** `signup_started` event from `segment.all_segment_events_last_90_days`
- Web events only (`context.library LIKE '%analytics.js%'`) — mobile events excluded (no UTM data, misaligned anonymous_ids)
- First pre-conversion `signup_started` per `anonymous_id`

**UTM source resolution (priority order):**
1. Direct from signup event: `context.campaign.source` or `utm_source` URL param
2. Fallback from HAI segment events: most recent pre-signup `Framer page load` with UTM, on the same `anonymous_id`
3. LinkedIn detection: `li_fat_id=` in URL → `'linkedin_ads'`

**Conversion:** the `anonymous_id` subsequently appeared with a `current_user_id` in segment events (validated: covers 96.7% of conversions).

---

## Date & Grouping Conventions

| Convention | Rule |
|-----------|------|
| **Week truncation** | `DATE_TRUNC(date, WEEK(MONDAY))` — always Monday start |
| **Date grain** | Configurable: `day`, `week`, `month` — applied via `DATE_TRUNC(date_grain, date)` |
| **Timezone for dates** | `America/Los_Angeles` (PST) for applied_at and Framer events |
| **Date range** | Configurable start/end; data starts `2025-01-01` |

---

## Reddit-Specific Deep Dive

The Reddit tab provides granularity beyond campaign level, drilling into ad group and individual ads.

### Reddit Ad Hierarchy

Full hierarchy: `campaign → ad_group → ad` with daily spend/impressions/clicks:
```sql
SELECT c.name AS campaign_name, c.id AS campaign_id,
    ag.name AS ad_group_name, ag.id AS ad_group_id,
    a.name AS ad_name, a.id AS ad_id,
    ar.date,
    SUM(ar.spend) / 1000000 AS spend,
    SUM(ar.impressions) AS impressions,
    SUM(ar.clicks) AS clicks
FROM `hs-ai-production.reddit_ads.ad_report` ar
JOIN `hs-ai-production.reddit_ads.ad` a ON ar.ad_id = a.id
JOIN `hs-ai-production.reddit_ads.ad_group` ag ON a.ad_group_id = ag.id
JOIN `hs-ai-production.reddit_ads.campaign` c ON a.campaign_id = c.id
GROUP BY 1, 2, 3, 4, 5, 6, 7
```

### Reddit Daily Fact

Joins Reddit spend with applicant funnel at the (ad_group_id, ad_id, date) grain:
- **Spend side:** `reddit_ad_hierarchy` grouped by `(ad_group_id, ad_id, date)`
- **Applicant side:** `applied` CTE filtered to `utm_source = 'reddit'`, keyed on `(adset_id AS ad_group_id, ad_id, applied_date)`
- **Framer side:** `reddit_framer_lands` grouped by `(ad_group_id, ad_id, date)`
- Joined via `FULL OUTER JOIN` to capture spend-only and applicant-only days

### Reddit Framer Conversion

Page-level conversion analysis: `(campaign, ad_group, ad, page_path)` → `(total_lands, total_converted, conversion_rate_pct)`

### Reddit Cost Metrics

Reddit uses **CPM** (cost per 1,000 impressions): `SUM(spend) / SUM(impressions) * 1000`

---

## Display Name Mapping

When presenting results, use these canonical display names:

| Internal Column | Display Name |
|----------------|-------------|
| `total_spend` | Spend |
| `total_impressions` | Impressions |
| `total_clicks` | Clicks |
| `total_framer_lands` | Framer Lands |
| `total_applicants` / `total_sign_ups` | Sign Ups |
| `total_app_completed` / `total_app_complete` | Apps |
| `total_fully_onboarded` | Fully-Onboarded |
| `total_allocated` | Allocated |
| `total_activated` | Activated |
| `cost_per_impression` | Cost per Impression |
| `cost_per_click` | Cost per Click |
| `cost_per_framer_land` | Cost per Framer Land |
| `cost_per_applicant` / `cost_per_sign_up` | Cost per Sign-up |
| `cost_per_app_completed` / `cost_per_app_complete` | Cost per App |
| `cost_per_fully_onboarded` | Cost per Fully-Onboarded |
| `cost_per_allocated` | Cost per Allocated |
| `cost_per_activated` | Cost per Activated |

### Spend formatting
- Dollar amounts: `$X,XXX.XX` (2 decimal places, comma-separated thousands)
- Volume actuals: `X,XXX` (integer, comma-separated thousands)
- Percentages: `XX.X%` (1 decimal place)

---

## Tables Referenced

| Table | Used For |
|-------|---------|
| `hai_dev.hai_user_growth_dim` | UTM attribution (`last_touch_utm_source`, `last_touch_campaign_id`, `last_touch_adset_id`, `last_touch_ad_id`) |
| `hai_dev.hai_profiles_dim` | Onboarding stage, `applied_at` |
| `hai_dev.fact_project_funnel` | First allocation (`pso_allocated_pst`) |
| `hai_dev.fact_task_activity_incl_otter` | First activation (first task submission) |
| `hai_public.handshake_ai_segment_events` | Framer page loads, signup events, anonymous_id ↔ profile_id mapping |
| `segment.all_segment_events_last_90_days` | Signup page conversion tracking |
| `hai_external_linkedin_ads.linkedin_ads__campaign_report` | LinkedIn spend |
| `hai_external.ad_analytics_by_creative` | LinkedIn corrected impressions/clicks |
| `hai_facebook_ads.basic_ad` | Meta ad-level spend |
| `hai_facebook_ads.basic_ad_set` | Meta ad set → campaign mapping |
| `hai_facebook_ads.basic_campaign` | Meta campaign names/IDs |
| `reddit_ads.ad_report` | Reddit ad-level spend |
| `reddit_ads.ad` | Reddit ad → campaign mapping |
| `reddit_ads.ad_group` | Reddit ad group names |
| `reddit_ads.campaign` | Reddit campaign names |
| `hai_google_ads_google_ads.google_ads__campaign_report` | Google campaign spend |
