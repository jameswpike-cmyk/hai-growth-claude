# fact_hai_attribution

**Location**: `hs-ai-production.hai_dev.fact_hai_attribution`
**Grain**: One row per `profile_id`
**Refresh**: Hourly

The best table for attributing fellows to paid marketing campaigns. Enriched attribution — raw UTM data is resolved against the spend hierarchy to clean up malformed IDs and backfill campaign/ad/adset names. Also includes **Indeed attribution backfill** (fellows attributed to Indeed campaigns where UTM data was missing).

**Use this table instead of `hai_user_growth_dim` for any attribution question.**

---

## Schema

| Column | Type | Description |
|--------|------|-------------|
| `profile_id` | STRING | HAI profile identifier. One row per profile. |
| `applied_at` | TIMESTAMP | When the profile was created (`hai_public.profiles.created_at`). Use as application date. |
| `attribution_timestamp` | TIMESTAMP | Timestamp of the attributed touch event. |
| `attribution_source` | STRING | Attribution tier: `'utm'`, `'survey'`, or `'unattributed'` |
| `last_touch_utm_source` | STRING | UTM source (e.g. `linkedin_ads`, `meta`, `reddit`, `google`, `indeed`) |
| `last_touch_utm_campaign` | STRING | UTM campaign string |
| `last_touch_utm_medium` | STRING | UTM medium |
| `last_touch_utm_content` | STRING | UTM content |
| `last_touch_utm_term` | STRING | UTM term |
| `last_touch_campaign_id` | STRING | Enriched campaign ID — overwritten from spend hierarchy when ad/adset match. `'n/a'` when unknown. Never NULL. |
| `last_touch_campaign_name` | STRING | Campaign name from spend hierarchy lookup. NULL when no match. |
| `last_touch_ad_group_id` | STRING | Enriched adset/ad group ID. `'n/a'` when unknown. Never NULL. |
| `last_touch_ad_group_name` | STRING | Adset/ad group name from spend hierarchy lookup. NULL when no match. |
| `last_touch_ad_id` | STRING | Enriched ad/creative ID. Invalid IDs set to `'n/a'`. Never NULL. |
| `last_touch_ad_name` | STRING | Ad/creative name from spend hierarchy lookup. NULL when no match. |
| `last_touch_click_id` | STRING | Platform click ID (gclid, fbclid, etc.) |
| `last_touch_referral_code` | STRING | Referral code if attribution came via referral |
| `last_touch_event_source` | STRING | Source of the attribution event |
| `last_touch_is_mobile_web` | BOOLEAN | TRUE if the attribution touch was on mobile web |
| `survey_how_did_you_hear` | STRING | Self-reported source from signup survey |
| `count_anonymous_ids` | INTEGER | Number of anonymous IDs associated with this profile |

---

## Attribution Source Tiers

| `attribution_source` | Meaning |
|---------------------|---------|
| `utm` | UTM parameters were present and resolved to a known campaign |
| `survey` | No UTM — attributed based on `survey_how_did_you_hear` |
| `unattributed` | Neither UTM nor survey data available |

---

## Key Joins

```sql
-- Attribution + onboarding stage
FROM `hs-ai-production.hai_dev.fact_hai_attribution` a
LEFT JOIN `hs-ai-production.hai_dev.hai_profiles_dim` p
  ON a.profile_id = p.profile_id

-- Attribution + first allocation
LEFT JOIN (
  SELECT profile_id, MIN(pso_allocated_pst) AS allocated_at
  FROM `hs-ai-production.hai_dev.fact_project_funnel`
  GROUP BY profile_id
) alloc ON a.profile_id = alloc.profile_id
```

---

## Marketing Funnel Stages

All stage definitions used across channels and dashboards:

| # | Stage | Definition |
|---|-------|------------|
| 1 | **Impressions** | Ad platform-reported impressions |
| 2 | **Clicks** | Ad platform-reported clicks |
| 3 | **Framer Lands** | First-touch Framer page loads attributed to a campaign, pre-conversion only |
| 4 | **Sign-ups** | Distinct `profile_id`s created via signup, attributed by `campaign_id` |
| 5 | **App Complete** | Sign-ups who completed the application (`current_onboarding_stage != 'assessment-application'`) |
| 6 | **Fully-Onboarded** | Sign-ups who reached `current_onboarding_stage = 'fully-onboarded'` |
| 7 | **Allocated** | Fully-onboarded fellows with a PSO allocation (`pso_allocated_pst IS NOT NULL`) |
| 8 | **Activated** | Allocated fellows who submitted their first task |

---

## Cost Metrics

All cost metrics use `SUM(spend) / NULLIF(SUM(metric), 0)`:

| Metric | Formula |
|--------|---------|
| CPM | `SUM(spend) / SUM(impressions) * 1000` — **CPM channels only (Reddit, Meta)** |
| CPC | `SUM(spend) / SUM(clicks)` |
| CPSU | `SUM(spend) / SUM(sign_ups)` — Cost per Sign-up |
| CPA | `SUM(spend) / SUM(app_complete)` — Cost per App Complete |
| CPFO | `SUM(spend) / SUM(fully_onboarded)` — Cost per Fully-Onboarded |
| CPAlloc | `SUM(spend) / SUM(allocated)` — Cost per Allocated |
| CPAct | `SUM(spend) / SUM(activated)` — Cost per Activated |

**CPM vs CPI:** Reddit and Meta are CPM channels. LinkedIn and Google are CPI channels (`spend / impressions`, no × 1000). When aggregating across channels, split the impression cost calculation by channel.

---

## Common Queries

**Sign-ups by channel with funnel conversion**
```sql
SELECT
    a.last_touch_utm_source AS channel,
    COUNT(DISTINCT a.profile_id) AS sign_ups,
    COUNTIF(p.current_onboarding_stage = 'fully-onboarded') AS fully_onboarded,
    COUNTIF(alloc.allocated_at IS NOT NULL) AS allocated,
    ROUND(COUNTIF(p.current_onboarding_stage = 'fully-onboarded') * 100.0
        / NULLIF(COUNT(DISTINCT a.profile_id), 0), 1) AS pct_fully_onboarded
FROM `hs-ai-production.hai_dev.fact_hai_attribution` a
LEFT JOIN `hs-ai-production.hai_dev.hai_profiles_dim` p ON a.profile_id = p.profile_id
LEFT JOIN (
    SELECT profile_id, MIN(pso_allocated_pst) AS allocated_at
    FROM `hs-ai-production.hai_dev.fact_project_funnel`
    GROUP BY profile_id
) alloc ON a.profile_id = alloc.profile_id
WHERE a.attribution_source = 'utm'
  AND DATE(a.applied_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
GROUP BY channel
ORDER BY sign_ups DESC
```

**Sign-ups by campaign**
```sql
SELECT
    a.last_touch_utm_source AS channel,
    a.last_touch_campaign_name AS campaign,
    COUNT(DISTINCT a.profile_id) AS sign_ups
FROM `hs-ai-production.hai_dev.fact_hai_attribution` a
WHERE a.attribution_source = 'utm'
  AND a.last_touch_utm_source IS NOT NULL
GROUP BY channel, campaign
ORDER BY sign_ups DESC
```

**Unattributed rate**
```sql
SELECT
    attribution_source,
    COUNT(DISTINCT profile_id) AS fellows,
    ROUND(COUNT(DISTINCT profile_id) * 100.0
        / NULLIF(SUM(COUNT(DISTINCT profile_id)) OVER (), 0), 1) AS pct
FROM `hs-ai-production.hai_dev.fact_hai_attribution`
GROUP BY attribution_source
```

---

## Notes

- `last_touch_campaign_id` is **never NULL** — returns `'n/a'` when unknown. Filter with `!= 'n/a'` rather than `IS NOT NULL`.
- `last_touch_ad_id` is also never NULL — same `'n/a'` pattern.
- Indeed attribution is backfilled in this table — fellows who came via Indeed but had missing UTMs are resolved here.
- For cross-channel spend queries, use `fact_paid_marketing` + `diamond_growth_indeed` (see `references/fact-paid-marketing.md`). This table handles the **who** (fellow attribution); the spend tables handle the **cost**.
