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
