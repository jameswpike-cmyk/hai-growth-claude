# Reddit Ads Table Schemas

**Dataset:** `hs-ai-production.reddit_ads`
**Source:** Fivetran sync from Reddit Ads API
**All tables are VIEWs**

## Important Notes

- **Spend is in microcurrency** (millionths of a dollar). Always divide by 1,000,000: `spend / 1000000.0 AS spend_dollars`
- **CPC, eCPM are also in microcurrency**: `cpc / 1000000.0 AS cpc_dollars`, `ecpm / 1000000.0 AS ecpm_dollars`
- **Default to campaign-level reports** unless the user asks for ad group or ad detail
- Report tables have a `date` column (DATE type) — no timestamp conversion needed
- Join report tables to entity tables for names: `campaign_report.campaign_id = campaign.id`

---

## Entity Tables

### campaign

**Fully-qualified name:** `hs-ai-production.reddit_ads.campaign`
**Grain:** One row per campaign

| Column | Type | Description |
|--------|------|-------------|
| id | STRING | Campaign ID — joins to report tables |
| account_id | STRING | Account ID |
| name | STRING | Campaign name (e.g., `20260305_Mstone_QGIS_General`) |
| objective | STRING | Campaign objective (`CONVERSIONS`, etc.) |
| configured_status | STRING | User-set status (`ACTIVE`, `PAUSED`) |
| effective_status | STRING | Actual running status |
| funding_instrument_id | STRING | Funding instrument ID |
| is_processing | BOOLEAN | Whether campaign is processing |
| _fivetran_synced | TIMESTAMP | Last sync timestamp |

### ad_group

**Fully-qualified name:** `hs-ai-production.reddit_ads.ad_group`
**Grain:** One row per ad group

| Column | Type | Description |
|--------|------|-------------|
| id | STRING | Ad group ID — joins to report tables |
| account_id | STRING | Account ID |
| campaign_id | STRING | Parent campaign ID |
| name | STRING | Ad group name |
| configured_status | STRING | User-set status |
| effective_status | STRING | Actual running status |
| bid_strategy | STRING | Bidding strategy |
| bid_value | INTEGER | Bid value (microcurrency) |
| goal_type | STRING | Goal type |
| goal_value | INTEGER | Goal value |
| optimization_strategy_type | STRING | Optimization strategy |
| start_time | TIMESTAMP | Start time |
| end_time | TIMESTAMP | End time |
| expand_targeting | BOOLEAN | Whether targeting expansion is on |
| is_processing | BOOLEAN | Whether ad group is processing |
| _fivetran_synced | TIMESTAMP | Last sync timestamp |

### ad

**Fully-qualified name:** `hs-ai-production.reddit_ads.ad`
**Grain:** One row per ad

| Column | Type | Description |
|--------|------|-------------|
| id | STRING | Ad ID — joins to report tables |
| account_id | STRING | Account ID |
| ad_group_id | STRING | Parent ad group ID |
| campaign_id | STRING | Parent campaign ID |
| name | STRING | Ad name |
| click_url | STRING | Destination URL |
| configured_status | STRING | User-set status |
| effective_status | STRING | Actual running status |
| post_id | STRING | Reddit post ID |
| post_url | STRING | Reddit post URL |
| preview_url | STRING | Ad preview URL |
| preview_expiry | STRING | Preview expiry |
| rejection_reason | STRING | Why ad was rejected (if applicable) |
| search_term | STRING | Search term targeting |
| is_processing | BOOLEAN | Whether ad is processing |
| _fivetran_synced | TIMESTAMP | Last sync timestamp |

---

## Performance Report Tables

All report tables share the same metrics columns. They differ only in grain (account / campaign / ad group / ad) and the ID column used.

### Shared Metrics Columns

| Column | Type | Description |
|--------|------|-------------|
| date | DATE | Report date |
| account_id | STRING | Account ID |
| spend | INTEGER | Spend in **microcurrency** — divide by 1,000,000 for dollars |
| impressions | INTEGER | Total impressions |
| clicks | INTEGER | Total clicks |
| cpc | FLOAT | Cost per click in **microcurrency** |
| ctr | FLOAT | Click-through rate (0.0–1.0) |
| ecpm | FLOAT | Effective CPM in **microcurrency** |
| conversion_roas | FLOAT | Return on ad spend |
| priority | STRING | Priority level |
| gallery_item_caption | STRING | Gallery item caption |

#### Video Metrics

| Column | Type | Description |
|--------|------|-------------|
| video_started | INTEGER | Video plays started |
| video_watched_3_seconds | INTEGER | Watched 3+ seconds |
| video_watched_5_seconds | INTEGER | Watched 5+ seconds |
| video_watched_10_seconds | INTEGER | Watched 10+ seconds |
| video_watched_25_percent | INTEGER | Watched 25%+ |
| video_watched_50_percent | INTEGER | Watched 50%+ |
| video_watched_75_percent | INTEGER | Watched 75%+ |
| video_watched_95_percent | INTEGER | Watched 95%+ |
| video_watched_100_percent | INTEGER | Watched 100% |
| video_viewable_impressions | INTEGER | Viewable video impressions |
| video_fully_viewable_impressions | INTEGER | Fully viewable video impressions |
| video_plays_expanded | INTEGER | Video plays expanded |
| video_plays_with_sound | INTEGER | Video plays with sound |

#### App Install Metrics

| Column | Type | Description |
|--------|------|-------------|
| app_install_install_count | INTEGER | App installs |
| app_install_sign_up_count | INTEGER | Sign-ups from app install |
| app_install_purchase_count | INTEGER | Purchases from app install |
| app_install_add_to_cart_count | INTEGER | Add-to-cart from app install |
| app_install_search_count | INTEGER | Searches from app install |
| app_install_view_content_count | INTEGER | Content views from app install |
| app_install_add_payment_info_count | INTEGER | Payment info added from app install |
| app_install_completed_tutorial_count | INTEGER | Tutorials completed from app install |
| app_install_app_launch_count | INTEGER | App launches |
| app_install_level_achieved_count | INTEGER | Levels achieved |
| app_install_spend_credits_count | INTEGER | Credits spent |

> The `app_install_metrics_*` columns (without `_count` suffix) appear to be duplicates or alternate representations of the same metrics.

### Report Table Variants

| Table | Grain | ID Column |
|-------|-------|-----------|
| `account_report` | account + date | `account_id` |
| `campaign_report` | campaign + date | `campaign_id` |
| `campaign_country_report` | campaign + country + date | `campaign_id`, `country` |
| `ad_group_report` | ad group + date | `ad_group_id` |
| `ad_report` | ad + date | `ad_id` |

---

## Conversion Report Tables

Conversion reports have a separate schema from performance reports. They track attributed conversions by event type and attribution window.

### Shared Conversion Columns

| Column | Type | Description |
|--------|------|-------------|
| date | DATE | Report date |
| account_id | STRING | Account ID |
| event_name | STRING | Conversion event name |
| clicks | INTEGER | Click-through conversions |
| views | INTEGER | View-through conversions |
| click_through_conversion_attribution_window_day | INTEGER | 1-day click attribution |
| click_through_conversion_attribution_window_week | INTEGER | 7-day click attribution |
| click_through_conversion_attribution_window_month | INTEGER | 28-day click attribution |
| view_through_conversion_attribution_window_day | INTEGER | 1-day view attribution |
| view_through_conversion_attribution_window_week | INTEGER | 7-day view attribution |
| view_through_conversion_attribution_window_month | INTEGER | 28-day view attribution |
| avg_value | FLOAT | Average conversion value |
| total_items | INTEGER | Total conversion items |
| total_value | INTEGER | Total conversion value |

### Conversion Report Variants

| Table | Grain | ID Column |
|-------|-------|-----------|
| `account_conversions_report` | account + date + event | `account_id` |
| `campaign_conversions_report` | campaign + date + event | `campaign_id` |
| `campaign_country_conversions_report` | campaign + country + date + event | `campaign_id`, `country` |
| `ad_group_conversions_report` | ad group + date + event | `ad_group_id` |
| `ad_conversions_report` | ad + date + event | `ad_id` |

---

## Reference & Targeting Tables

### business_account

**Fully-qualified name:** `hs-ai-production.reddit_ads.business_account`

| Column | Type | Description |
|--------|------|-------------|
| id | STRING | Account ID |
| name | STRING | Business account name |
| attribution_type | STRING | Attribution model type |
| click_attribution_window | STRING | Click attribution window |
| view_attribution_window | STRING | View attribution window |
| currency | STRING | Account currency |
| time_zone_id | STRING | Time zone ID |
| business_id | STRING | Business ID |
| type | STRING | Account type |
| admin_approval | STRING | Admin approval status |
| suspension_reason | STRING | Suspension reason (if any) |
| created_at | TIMESTAMP | Account creation date |
| modified_at | TIMESTAMP | Last modification date |

### community

**Fully-qualified name:** `hs-ai-production.reddit_ads.community`

| Column | Type | Description |
|--------|------|-------------|
| id | STRING | Community (subreddit) ID |
| name | STRING | Community name (subreddit) |
| description | STRING | Community description |
| subscriber_count | INTEGER | Number of subscribers |
| daily_impressions | INTEGER | Daily impression count |
| icon_url | STRING | Community icon URL |

### targeting_community

**Fully-qualified name:** `hs-ai-production.reddit_ads.targeting_community`

| Column | Type | Description |
|--------|------|-------------|
| ad_group_id | STRING | Ad group ID |
| community_id | STRING | Targeted community ID |
| excluded | BOOLEAN | Whether community is excluded |

### targeting_geolocation

**Fully-qualified name:** `hs-ai-production.reddit_ads.targeting_geolocation`

| Column | Type | Description |
|--------|------|-------------|
| ad_group_id | STRING | Ad group ID |
| geolocation_id | STRING | Geolocation ID |
| excluded | BOOLEAN | Whether location is excluded |

### targeting_custom_audience

**Fully-qualified name:** `hs-ai-production.reddit_ads.targeting_custom_audience`

| Column | Type | Description |
|--------|------|-------------|
| ad_group_id | STRING | Ad group ID |
| custom_audience_id | STRING | Custom audience ID |
| excluded | BOOLEAN | Whether audience is excluded |

### geolocation

**Fully-qualified name:** `hs-ai-production.reddit_ads.geolocation`

| Column | Type | Description |
|--------|------|-------------|
| id | STRING | Geolocation ID |
| name | STRING | Location name |
| country | STRING | Country |
| region | STRING | Region/state |
| dma | INTEGER | DMA (Designated Market Area) code |
| postal_code | STRING | Postal code |

### interest

**Fully-qualified name:** `hs-ai-production.reddit_ads.interest`

| Column | Type | Description |
|--------|------|-------------|
| id | STRING | Interest ID |
| name | STRING | Interest name |
| category | STRING | Interest category |

### custom_audience_history

**Fully-qualified name:** `hs-ai-production.reddit_ads.custom_audience_history`

| Column | Type | Description |
|--------|------|-------------|
| id | STRING | Custom audience ID |
| account_id | STRING | Account ID |
| name | STRING | Audience name |
| type | STRING | Audience type |
| status | STRING | Audience status |
| size_range_lower | INTEGER | Lower bound of audience size |
| size_range_upper | INTEGER | Upper bound of audience size |
| customer_list_config_external_id | STRING | External customer list ID |
| customer_list_config_origin | STRING | Customer list origin |
| lookalike_configsource_audience_id | STRING | Source audience for lookalike |
| engagement_audience_configlookback_window_days | INTEGER | Engagement lookback window |
| pixel_audience_configlookback_window_days | STRING | Pixel lookback window |
| created_at | TIMESTAMP | Creation timestamp |
| updated_at | TIMESTAMP | Last update timestamp |

### engagement_audience_campaign

**Fully-qualified name:** `hs-ai-production.reddit_ads.engagement_audience_campaign`

| Column | Type | Description |
|--------|------|-------------|
| campaign_id | STRING | Campaign ID |
| custom_audience_id | STRING | Custom audience ID |

### engagement_audience_tracking_type

**Fully-qualified name:** `hs-ai-production.reddit_ads.engagement_audience_tracking_type`

| Column | Type | Description |
|--------|------|-------------|
| custom_audience_id | STRING | Custom audience ID |
| index | INTEGER | Tracking type index |
| value | STRING | Tracking type value |

### time_zone

**Fully-qualified name:** `hs-ai-production.reddit_ads.time_zone`

| Column | Type | Description |
|--------|------|-------------|
| id | STRING | Time zone ID |
| code | STRING | Time zone code |
| name | STRING | Time zone name |
| offset | INTEGER | UTC offset |
| dst_offset | INTEGER | DST offset |
| is_dst_active | BOOLEAN | Whether DST is active |

---

## Key Joins

```
campaign.id ──────────────── campaign_report.campaign_id
campaign.id ──────────────── campaign_conversions_report.campaign_id
campaign.id ──────────────── campaign_country_report.campaign_id
ad_group.id ──────────────── ad_group_report.ad_group_id
ad_group.campaign_id ─────── campaign.id
ad.id ────────────────────── ad_report.ad_id
ad.ad_group_id ───────────── ad_group.id
ad.campaign_id ───────────── campaign.id
ad_group.id ──────────────── targeting_community.ad_group_id
ad_group.id ──────────────── targeting_geolocation.ad_group_id
ad_group.id ──────────────── targeting_custom_audience.ad_group_id
targeting_community.community_id ── community.id
targeting_geolocation.geolocation_id ── geolocation.id
targeting_custom_audience.custom_audience_id ── custom_audience_history.id
```

---

## Common Patterns

**Campaign Performance Summary (default query):**
```sql
SELECT
  c.name AS campaign_name,
  c.objective,
  c.effective_status,
  SUM(r.spend) / 1000000.0 AS spend_dollars,
  SUM(r.impressions) AS impressions,
  SUM(r.clicks) AS clicks,
  ROUND(SUM(r.clicks) * 1.0 / NULLIF(SUM(r.impressions), 0) * 100, 2) AS ctr_pct,
  ROUND(SUM(r.spend) / 1000000.0 / NULLIF(SUM(r.clicks), 0), 2) AS cpc_dollars,
  ROUND(SUM(r.spend) / 1000000.0 / NULLIF(SUM(r.impressions), 0) * 1000, 2) AS cpm_dollars
FROM `hs-ai-production.reddit_ads.campaign_report` r
JOIN `hs-ai-production.reddit_ads.campaign` c ON r.campaign_id = c.id
WHERE r.date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
GROUP BY c.name, c.objective, c.effective_status
ORDER BY spend_dollars DESC
```

**Daily Spend Trend:**
```sql
SELECT
  r.date,
  c.name AS campaign_name,
  r.spend / 1000000.0 AS spend_dollars,
  r.impressions,
  r.clicks,
  ROUND(r.clicks * 1.0 / NULLIF(r.impressions, 0) * 100, 2) AS ctr_pct
FROM `hs-ai-production.reddit_ads.campaign_report` r
JOIN `hs-ai-production.reddit_ads.campaign` c ON r.campaign_id = c.id
WHERE r.date >= DATE_SUB(CURRENT_DATE(), INTERVAL 14 DAY)
ORDER BY r.date DESC, spend_dollars DESC
```

**Conversions by Event:**
```sql
SELECT
  c.name AS campaign_name,
  cv.event_name,
  SUM(cv.click_through_conversion_attribution_window_day) AS click_conversions_1d,
  SUM(cv.click_through_conversion_attribution_window_week) AS click_conversions_7d,
  SUM(cv.view_through_conversion_attribution_window_day) AS view_conversions_1d,
  SUM(cv.view_through_conversion_attribution_window_week) AS view_conversions_7d
FROM `hs-ai-production.reddit_ads.campaign_conversions_report` cv
JOIN `hs-ai-production.reddit_ads.campaign` c ON cv.campaign_id = c.id
WHERE cv.date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
GROUP BY c.name, cv.event_name
ORDER BY click_conversions_7d DESC
```

**Subreddit Targeting Analysis:**
```sql
SELECT
  c.name AS campaign_name,
  ag.name AS ad_group_name,
  com.name AS subreddit,
  com.subscriber_count,
  tc.excluded
FROM `hs-ai-production.reddit_ads.targeting_community` tc
JOIN `hs-ai-production.reddit_ads.community` com ON tc.community_id = com.id
JOIN `hs-ai-production.reddit_ads.ad_group` ag ON tc.ad_group_id = ag.id
JOIN `hs-ai-production.reddit_ads.campaign` c ON ag.campaign_id = c.id
WHERE tc.excluded = FALSE
ORDER BY com.subscriber_count DESC
```

**Video Completion Funnel:**
```sql
SELECT
  c.name AS campaign_name,
  SUM(r.video_started) AS started,
  SUM(r.video_watched_25_percent) AS watched_25pct,
  SUM(r.video_watched_50_percent) AS watched_50pct,
  SUM(r.video_watched_75_percent) AS watched_75pct,
  SUM(r.video_watched_100_percent) AS watched_100pct,
  ROUND(SUM(r.video_watched_100_percent) * 100.0 / NULLIF(SUM(r.video_started), 0), 2) AS completion_rate_pct
FROM `hs-ai-production.reddit_ads.campaign_report` r
JOIN `hs-ai-production.reddit_ads.campaign` c ON r.campaign_id = c.id
WHERE r.video_started > 0
GROUP BY c.name
ORDER BY started DESC
```
