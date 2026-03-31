# fact_paid_marketing

**Location**: `hs-ai-production.hai_dev.fact_paid_marketing`
**Refresh**: hourly

Unified daily ad-level spend, impressions, and clicks across all four paid marketing channels: LinkedIn, Meta (Facebook), Reddit, and Google Ads. Use this table to answer questions about how much we're spending, where, and on which campaigns/ads.

---

## Schema

| Column | Type | Description |
|---|---|---|
| `date` | DATE | Date of the ad activity |
| `channel` | STRING | One of: `linkedin`, `meta`, `reddit`, `google` |
| `campaign_id` | STRING | Platform campaign ID |
| `campaign_name` | STRING | Platform campaign name |
| `ad_group_id` | STRING | Platform adset/ad_group ID. NULL for LinkedIn (no adset tier). |
| `ad_group_name` | STRING | Platform adset/ad_group name. NULL for LinkedIn. |
| `ad_id` | STRING | Platform ad/creative ID. NULL for Google fallback rows (see Grain section). |
| `ad_name` | STRING | Platform ad/creative name. Always blank for Google (RSA limitation). NULL for Google fallback rows. |
| `spend` | FLOAT64 | Spend in USD. Never NULL (defaults to 0). |
| `impressions` | INTEGER | Ad impressions. Never NULL (defaults to 0). |
| `clicks` | INTEGER | Ad clicks. Never NULL (defaults to 0). |

---

## Grain

Most rows are at **ad × date** level. Google has two fallback tiers for campaigns where granular data isn't available:

| Scenario | `ad_id` | `ad_group_id` | Channels |
|---|---|---|---|
| Normal (ad-level) | populated | populated | LinkedIn, Meta, Reddit, Google |
| Ad group fallback | NULL | populated | Google only |
| Campaign fallback | NULL | NULL | Google only |

When aggregating spend, always `SUM(spend)` — the tiered structure ensures no double-counting.

---

## Channel notes

**LinkedIn**
- No adset/ad_group tier — `ad_group_id` and `ad_group_name` are always NULL
- `ad_id` is the creative ID; `ad_name` is the creative name (e.g. `HAI 20260317_CAD_General_Broad_Message_VJMobile1Lucy`)
- Campaign names follow the pattern `HAI <date>_<role>_<audience>_<type>`

**Meta**
- `ad_group_id` / `ad_group_name` = the adset
- Hierarchy: Campaign → Adset → Ad

**Reddit**
- Hierarchy: Campaign → Ad Group → Ad
- Spend was stored as microcurrency in the source; already converted to USD in this model

**Google**
- `ad_name` is always blank — Google Responsive Search Ads don't expose ad names via the API; use `ad_id` to identify ads
- Some rows are at ad_group or campaign level only (see Grain section above)
- Hierarchy: Campaign → Ad Group → Ad

---

## Common queries

**Total spend by channel**
```sql
SELECT channel, ROUND(SUM(spend), 2) AS total_spend
FROM `hs-ai-production.hai_dev.fact_paid_marketing`
GROUP BY channel
ORDER BY total_spend DESC
```

**Daily spend across all channels**
```sql
SELECT date, ROUND(SUM(spend), 2) AS daily_spend
FROM `hs-ai-production.hai_dev.fact_paid_marketing`
GROUP BY date
ORDER BY date DESC
```

**Spend by campaign (single channel)**
```sql
SELECT campaign_name, ROUND(SUM(spend), 2) AS spend, SUM(impressions) AS impressions, SUM(clicks) AS clicks
FROM `hs-ai-production.hai_dev.fact_paid_marketing`
WHERE channel = 'linkedin'
GROUP BY campaign_name
ORDER BY spend DESC
```

**Ad-level breakdown for a specific campaign**
```sql
SELECT date, ad_group_name, ad_name, spend, impressions, clicks
FROM `hs-ai-production.hai_dev.fact_paid_marketing`
WHERE campaign_name = '<your campaign name>'
ORDER BY date DESC, spend DESC
```

**MTD spend by channel**
```sql
SELECT channel, ROUND(SUM(spend), 2) AS mtd_spend
FROM `hs-ai-production.hai_dev.fact_paid_marketing`
WHERE DATE_TRUNC(date, MONTH) = DATE_TRUNC(CURRENT_DATE(), MONTH)
GROUP BY channel
ORDER BY mtd_spend DESC
```

**CTR (click-through rate) by campaign**
```sql
SELECT
    channel,
    campaign_name,
    SUM(clicks) AS clicks,
    SUM(impressions) AS impressions,
    ROUND(SAFE_DIVIDE(SUM(clicks), SUM(impressions)) * 100, 2) AS ctr_pct
FROM `hs-ai-production.hai_dev.fact_paid_marketing`
GROUP BY channel, campaign_name
HAVING SUM(impressions) > 0
ORDER BY ctr_pct DESC
```

**CPM (cost per 1,000 impressions)**
```sql
SELECT
    channel,
    campaign_name,
    ROUND(SAFE_DIVIDE(SUM(spend), SUM(impressions)) * 1000, 2) AS cpm
FROM `hs-ai-production.hai_dev.fact_paid_marketing`
GROUP BY channel, campaign_name
HAVING SUM(impressions) > 0
ORDER BY cpm
```

---

## Important: avoid these mistakes

- **Don't filter on `ad_name` for Google** — it is always blank. Use `ad_id` instead.
- **Don't filter out NULL `ad_group_id` rows for Google** — those fallback rows carry real spend. Always aggregate at the level you need (campaign, ad_group, or ad) rather than filtering on NULL fields.
- **LinkedIn has no ad_group tier** — if you need a cross-channel breakdown by adset/ad_group, LinkedIn will show NULL for those columns. That's expected.
- **All IDs are STRING** — when filtering on `campaign_id`, `ad_group_id`, or `ad_id`, always quote the value (e.g. `WHERE campaign_id = '22967191596'`).

---

## Indeed Spend — diamond_growth_indeed

**Location**: `hs-ai-sandbox.hai_dev.diamond_growth_indeed`
**Source**: Google Sheets-backed (manual export from Indeed dashboard)
**Refresh**: Manual

Indeed spend is NOT in `fact_paid_marketing` — query this table separately and UNION ALL when doing cross-channel comparisons.

### Schema

| Column | Type | Description |
|--------|------|-------------|
| `Date` | DATE | Date of activity |
| `Job` | STRING | Raw job title — includes ` - AI Trainer...` suffix, must be trimmed |
| `Campaigns` | STRING | Campaign name |
| `Campaign_id` | STRING | Indeed campaign ID |
| `Impressions` | INTEGER | Ad impressions |
| `Clicks` | INTEGER | Ad clicks |
| `Apply_starts` | INTEGER | Apply button clicks |
| `Applies` | INTEGER | Completed applications |
| `Spend` | FLOAT | Spend in USD |
| `Cost_per_click__CPC_` | FLOAT | Pre-computed CPC |
| `Cost_per_apply_start__CPAS_` | FLOAT | Pre-computed cost per apply start |
| `Cost_per_apply__CPA_` | FLOAT | Pre-computed cost per apply |
| `Daily_budget` | FLOAT | Daily budget set for the job |
| `Clickthrough_rate__CTR_` | FLOAT | Pre-computed CTR |
| `Apply_start_rate__ASR_` | FLOAT | Pre-computed apply start rate |
| `Apply_completion_rate__ACR_` | FLOAT | Pre-computed apply completion rate |
| `Apply_rate__AR_` | FLOAT | Pre-computed apply rate |
| `Country` | STRING | Country |
| `State_Region` | STRING | State/region |
| `City` | STRING | City |
| `Company_name` | STRING | Company name |
| `Source_website` | STRING | Source website |
| `Job_URL` | STRING | Indeed job URL |
| `Category` | STRING | Job category |
| `Job_status` | STRING | Job status |
| `Project` | STRING | Internal project label |

### Job Title Trimming

The `Job` column contains suffixes like ` - AI Trainer | Part-Time | Remote`. Always trim to get the clean job title:

```sql
REGEXP_REPLACE(Job, r' - AI Trainer.*', '') AS job_title
```

### Cross-Channel UNION with fact_paid_marketing

```sql
SELECT
    date AS date,
    'indeed' AS channel,
    Campaign_id AS campaign_id,
    Campaigns AS campaign_name,
    NULL AS ad_group_id,
    NULL AS ad_group_name,
    NULL AS ad_id,
    REGEXP_REPLACE(Job, r' - AI Trainer.*', '') AS ad_name,
    COALESCE(Spend, 0) AS spend,
    COALESCE(Impressions, 0) AS impressions,
    COALESCE(Clicks, 0) AS clicks
FROM `hs-ai-sandbox.hai_dev.diamond_growth_indeed`

UNION ALL

SELECT
    date,
    channel,
    campaign_id,
    campaign_name,
    ad_group_id,
    ad_group_name,
    ad_id,
    ad_name,
    spend,
    impressions,
    clicks
FROM `hs-ai-production.hai_dev.fact_paid_marketing`
```

### Indeed-only spend query

```sql
SELECT
    Date AS date,
    REGEXP_REPLACE(Job, r' - AI Trainer.*', '') AS job_title,
    Campaigns AS campaign,
    ROUND(SUM(Spend), 2) AS spend,
    SUM(Impressions) AS impressions,
    SUM(Clicks) AS clicks,
    SUM(Applies) AS applies,
    ROUND(SAFE_DIVIDE(SUM(Spend), SUM(Applies)), 2) AS cost_per_apply
FROM `hs-ai-sandbox.hai_dev.diamond_growth_indeed`
WHERE Date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
GROUP BY date, job_title, campaign
ORDER BY spend DESC
```

---

## Indeed Effectiveness — Spend × Conversions

Indeed spend lives in `diamond_growth_indeed` (above), but **conversion data** (actual applicants) lives in a separate table:

**Location**: `hs-ai-production.hai_dev.diamond_growth_ashby`
**Source**: View over `handshake-production.hai_dev.diamond_growth_ashby` (Ashby ATS export)

### Ashby Schema (Indeed-relevant columns)

| Column | Type | Description |
|--------|------|-------------|
| `Job_Consideration_s_Candidate` | STRING | Candidate name |
| `Job_Consideration_s_Candidate_s_Email_Address__Primary__Personal_` | STRING | Candidate email |
| `Job_Consideration_s_Job` | STRING | Job title (e.g. `3D Slicer Specialist - AI Trainer`) |
| `Job_Consideration_s_Applied_via_Job_Posting` | STRING | Job posting source (e.g. `Project Touchstone`) |
| `Job_Consideration_s_Source` | STRING | Source channel — filter to `'Inbound: Indeed Listings'` for Indeed conversions |
| `Job_Consideration_s_Application_Form_s_Submitted_At` | STRING | Application submission timestamp (ISO 8601 string, not TIMESTAMP) |

### Filtering to Indeed applicants

```sql
WHERE Job_Consideration_s_Source = 'Inbound: Indeed Listings'
```

Other Indeed-adjacent sources exist (e.g. `'Inbound: Applied'` may include Indeed organic) but `'Inbound: Indeed Listings'` is the cleanest signal for paid Indeed conversions.

### Join pattern: Indeed spend × Ashby conversions

The join key is **job title**, but the formats differ:
- Indeed `Job`: `MEDICINE EXPERT (MD)` (uppercase, no suffix in some rows) or `FINANCE EXPERT - AI Trainer | Part-Time | Remote`
- Ashby `Job_Consideration_s_Job`: `3D Slicer Specialist - AI Trainer ` (mixed case, trailing space)

Use `UPPER` + `TRIM` + the `REGEXP_REPLACE` pattern to normalize both sides:

```sql
WITH indeed_spend AS (
    SELECT
        UPPER(TRIM(REGEXP_REPLACE(Job, r' - AI Trainer.*', ''))) AS job_title,
        ROUND(SUM(Spend), 2) AS total_spend,
        SUM(Impressions) AS impressions,
        SUM(Clicks) AS clicks,
        SUM(Applies) AS indeed_applies
    FROM `hs-ai-sandbox.hai_dev.diamond_growth_indeed`
    GROUP BY job_title
),

ashby_conversions AS (
    SELECT
        UPPER(TRIM(REGEXP_REPLACE(Job_Consideration_s_Job, r' - AI Trainer.*', ''))) AS job_title,
        COUNT(*) AS ashby_applicants
    FROM `hs-ai-production.hai_dev.diamond_growth_ashby`
    WHERE Job_Consideration_s_Source = 'Inbound: Indeed Listings'
    GROUP BY job_title
)

SELECT
    i.job_title,
    i.total_spend,
    i.impressions,
    i.clicks,
    i.indeed_applies,
    COALESCE(a.ashby_applicants, 0) AS ashby_applicants,
    ROUND(SAFE_DIVIDE(i.total_spend, a.ashby_applicants), 2) AS cost_per_applicant
FROM indeed_spend i
LEFT JOIN ashby_conversions a ON i.job_title = a.job_title
ORDER BY total_spend DESC
```

### Job title effectiveness (best/worst ROI)

```sql
WITH indeed_spend AS (
    SELECT
        UPPER(TRIM(REGEXP_REPLACE(Job, r' - AI Trainer.*', ''))) AS job_title,
        ROUND(SUM(Spend), 2) AS total_spend,
        SUM(Clicks) AS clicks
    FROM `hs-ai-sandbox.hai_dev.diamond_growth_indeed`
    GROUP BY job_title
),

ashby_conversions AS (
    SELECT
        UPPER(TRIM(REGEXP_REPLACE(Job_Consideration_s_Job, r' - AI Trainer.*', ''))) AS job_title,
        COUNT(*) AS ashby_applicants
    FROM `hs-ai-production.hai_dev.diamond_growth_ashby`
    WHERE Job_Consideration_s_Source = 'Inbound: Indeed Listings'
    GROUP BY job_title
)

SELECT
    i.job_title,
    i.total_spend,
    i.clicks,
    COALESCE(a.ashby_applicants, 0) AS applicants,
    ROUND(SAFE_DIVIDE(i.total_spend, a.ashby_applicants), 2) AS cost_per_applicant,
    ROUND(SAFE_DIVIDE(a.ashby_applicants, i.clicks) * 100, 1) AS click_to_applicant_pct
FROM indeed_spend i
LEFT JOIN ashby_conversions a ON i.job_title = a.job_title
WHERE i.total_spend > 0
ORDER BY cost_per_applicant ASC
```

### Time-bounded effectiveness (e.g. last 30 days)

Add date filters to both CTEs when analyzing a specific period:

```sql
-- In indeed_spend CTE:
WHERE Date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)

-- In ashby_conversions CTE:
WHERE Job_Consideration_s_Source = 'Inbound: Indeed Listings'
  AND SAFE.PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*SZ', Job_Consideration_s_Application_Form_s_Submitted_At)
      >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
```

Note: Ashby `Submitted_At` is a STRING — use `SAFE.PARSE_TIMESTAMP` to cast it.
