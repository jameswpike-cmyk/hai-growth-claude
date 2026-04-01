# lifecycle_communication_messages

**Location**: `hs-ai-production.handshake_derived.lifecycle_communication_messages`
**Type**: VIEW (no partitioning — the view itself is not partitioned)
**Scale**: ~13 billion rows, data from June 2020 onward
**Refresh**: Incremental every 2 hours (last 30 days); full refresh weekly

Consolidated table of all email and push communication messages from Iterable, Mailgun, and Firebase. Each row = one message sent to one recipient, with engagement flags (delivered, opened, clicked) rolled up.

---

## CRITICAL: Query Efficiency

**This is a ~13B row table. Every query MUST include a `sent_at` filter to avoid expensive full scans.**

```sql
-- ALWAYS do this:
WHERE sent_at >= TIMESTAMP('2026-01-01')

-- Or use an interval:
WHERE sent_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
```

**Additional filters to narrow scans** (apply as many as relevant):

| Filter | Use when... |
|--------|-------------|
| `channel = 'email'` or `channel = 'push'` | You only need one channel (~94% email, ~6% push) |
| `event_source = 'mailgun'` / `'iterable'` / `'firebase'` | You know the source platform |
| `product_bucket = '...'` | You care about a specific product area |
| `iterable_project_name = 'Student'` / `'Employer'` / `'Edu'` | Iterable events only — filter by user type |

**Never run an unfiltered `COUNT(*)` or `SELECT *` on this table.**

---

## Schema

### Identifiers

| Column | Type | Description |
|--------|------|-------------|
| message_id | STRING | PK — unique per message + recipient |
| email_address | STRING | Recipient email |
| user_id | INTEGER | Handshake user ID (from payload or email lookup) |
| internal_message_id | INTEGER | Handshake app message ID |
| push_notification_token_id | INTEGER | Firebase push token ID (push only) |

### Source & Channel

| Column | Type | Description |
|--------|------|-------------|
| channel | STRING | `email` or `push` |
| event_source | STRING | `mailgun`, `iterable`, or `firebase` |
| iterable_campaign_id | STRING | Iterable campaign ID (NOT Handshake campaign ID) |
| iterable_campaign_name | STRING | e.g. `monolith:job_posting:expiring_soon` |
| iterable_project_name | STRING | `Student`, `Employer`, `Edu`, or NULL (mailgun) |

### Classification

| Column | Type | Description |
|--------|------|-------------|
| product_bucket | STRING | Product area (see values below) |
| marketing_bucket | STRING | Marketing subcategory (Iterable only, see values below) |
| tag | STRING | Adhoc tags from monolith |
| transactional_data | STRING | JSON metadata |

**`product_bucket` values** (by volume, descending):
`Career center`, `Jobs`, `Employer campaigns & bulk messages`, `Events`, `Career fairs`, `Account`, `Profile`, `1-1 Messages`, `Marketing`, `HAI`, `Feed`, `Miscellaneous`, `Experiences`, `Virtual info chat`, `Employer insights`, `Onboarding Emails`

**`marketing_bucket` values** (Iterable only, most are NULL):
`Welcome Series`, `Activation Series`, `Miscellaneous`, `Engagement Series`, `Event Digest`, `HS Pre-Event Series`

### Handshake Campaign Context

| Column | Type | Description |
|--------|------|-------------|
| talent_engagement_campaign_id | INTEGER | Handshake app campaign ID |
| talent_engagement_campaign_date_id | INTEGER | Handshake app campaign date ID |
| premium_employer_id | INTEGER | Premium employer associated with message |
| monolith_notification_id | INTEGER | App monolith notifications table ID |
| nrs_notification_id | STRING | Notifications Relevance Service ID |
| nds_notification_id | STRING | Notifications Data Service ID |

### Engagement Metrics

| Column | Type | Description |
|--------|------|-------------|
| sent_at | TIMESTAMP | When the message was sent |
| delivered | BOOLEAN | Successfully delivered? |
| delivered_at | TIMESTAMP | Delivery timestamp |
| opened | BOOLEAN | User opened? (bot-filtered, safe to use directly) |
| first_opened_at | TIMESTAMP | First open timestamp |
| clicked | BOOLEAN | User clicked? (bot-filtered, safe to use directly) |
| first_clicked_at | TIMESTAMP | First click timestamp |
| clicked_notif_prefs_link | BOOLEAN | Clicked notification preferences link? |
| unsubscribed | BOOLEAN | Iterable unsubscribe event? |
| urls_clicked | REPEATED STRING | Array of URLs clicked |
| job_ids | REPEATED INTEGER | Array of job IDs from payload |

### Push Token Context

| Column | Type | Description |
|--------|------|-------------|
| push_token_last_active_at | TIMESTAMP | Most recent push token activity before send |
| push_token_authorized | BOOLEAN | Push authorized on device? (incomplete coverage) |

---

## Joins

- **No `profile_id` column.** To join to HAI fellows:
  - `user_id` → `fact_fellow_profile.handshake_user_id`
  - `email_address` → `fact_fellow_profile.email`
- `iterable_campaign_id` → Iterable campaign metadata
- `iterable_campaign_id` is NOT `talent_engagement_campaign_id` — don't confuse them

---

## Common Patterns

**Engagement rates by product (last 30 days):**
```sql
SELECT
  product_bucket,
  COUNT(*) AS sent,
  COUNTIF(delivered) AS delivered,
  COUNTIF(opened) AS opened,
  COUNTIF(clicked) AS clicked,
  ROUND(COUNTIF(delivered) / COUNT(*) * 100, 2) AS delivery_pct,
  ROUND(COUNTIF(opened) / NULLIF(COUNTIF(delivered), 0) * 100, 2) AS open_pct,
  ROUND(COUNTIF(clicked) / NULLIF(COUNTIF(opened), 0) * 100, 2) AS cto_pct
FROM `hs-ai-production.handshake_derived.lifecycle_communication_messages`
WHERE channel = 'email'
  AND sent_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
GROUP BY product_bucket
ORDER BY sent DESC
```

**HAI communications over time:**
```sql
SELECT
  DATE(sent_at) AS send_date,
  iterable_campaign_name,
  COUNT(*) AS sent,
  COUNTIF(delivered) AS delivered,
  COUNTIF(opened) AS opened,
  COUNTIF(clicked) AS clicked
FROM `hs-ai-production.handshake_derived.lifecycle_communication_messages`
WHERE product_bucket = 'HAI'
  AND sent_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY)
GROUP BY 1, 2
ORDER BY send_date DESC
```

**Onboarding email volume by week:**
```sql
SELECT
  DATE_TRUNC(DATE(sent_at), WEEK(MONDAY)) AS week,
  COUNT(*) AS sent,
  COUNTIF(opened) AS opened,
  COUNTIF(clicked) AS clicked
FROM `hs-ai-production.handshake_derived.lifecycle_communication_messages`
WHERE product_bucket = 'Onboarding Emails'
  AND channel = 'email'
  AND sent_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 180 DAY)
GROUP BY 1
ORDER BY week DESC
```

**Join to HAI fellow profiles:**
```sql
SELECT
  fp.full_name, fp.email, fp.profile_status,
  COUNT(*) AS messages_received,
  COUNTIF(lcm.opened) AS opened_count,
  COUNTIF(lcm.clicked) AS clicked_count
FROM `hs-ai-production.handshake_derived.lifecycle_communication_messages` lcm
INNER JOIN `handshake-production.hai_dev.fact_fellow_profile` fp
  ON lcm.user_id = fp.handshake_user_id
WHERE lcm.sent_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
GROUP BY 1, 2, 3
ORDER BY messages_received DESC
LIMIT 20
```

**Push notification engagement (last 7 days):**
```sql
SELECT
  product_bucket,
  COUNT(*) AS sent,
  COUNTIF(delivered) AS delivered,
  COUNTIF(opened) AS opened,
  COUNTIF(clicked) AS clicked
FROM `hs-ai-production.handshake_derived.lifecycle_communication_messages`
WHERE channel = 'push'
  AND sent_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
GROUP BY product_bucket
ORDER BY sent DESC
```

---

## Avoid These Mistakes

- **No `sent_at` filter** — will scan ~13B rows. Always filter.
- **Confusing `iterable_campaign_id` with `talent_engagement_campaign_id`** — they are different systems.
- **Using `marketing_bucket` for non-Iterable events** — it's only populated for Iterable sources. Most rows are NULL.
- **Assuming `iterable_project_name` is always populated** — only set for Iterable events. Mailgun/Firebase rows are NULL.
- **Joining on `profile_id`** — this column doesn't exist. Use `user_id` or `email_address`.
