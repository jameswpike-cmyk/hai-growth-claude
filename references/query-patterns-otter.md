# Otter / Feather Query Patterns

**Before writing any Otter SQL, read [references/otter-tables.md](references/otter-tables.md) for schemas. The Otter identity model and status values are different from HAI — do not guess.**

---

## Otter Approval Rates

```sql
-- Otter approval rate by campaign (from task activity)
SELECT
  campaign,
  COUNT(DISTINCT CASE WHEN activity_type = 'signed_off' THEN id END) AS approvals,
  COUNT(DISTINCT CASE WHEN activity_type = 'needs_work' THEN id END) AS rejections,
  ROUND(
    COUNT(DISTINCT CASE WHEN activity_type = 'signed_off' THEN id END) * 100.0 /
    NULLIF(COUNT(DISTINCT CASE WHEN activity_type IN ('signed_off', 'needs_work') THEN id END), 0),
  2) AS approval_rate_pct
FROM `hs-ai-production.hai_dev.fact_otter_task_activity`
WHERE completed_at IS NOT NULL
GROUP BY campaign
ORDER BY approval_rate_pct DESC
```

```sql
-- Otter approval rate from fellow perf (pre-computed)
SELECT
  campaign,
  COUNT(DISTINCT email) AS fellow_count,
  SUM(total_approvals) AS total_approvals,
  SUM(total_rejections) AS total_rejections,
  ROUND(AVG(approval_rate) * 100, 2) AS avg_approval_rate_pct
FROM `hs-ai-production.hai_dev.fact_otter_fellow_perf`
WHERE total_reviews > 0
GROUP BY campaign
ORDER BY avg_approval_rate_pct DESC
```

---

## Otter Campaign Health

```sql
-- Otter campaign health dashboard (fellow perspective)
SELECT
  campaign,
  COUNT(DISTINCT email) AS total_fellows,
  COUNTIF(active = TRUE) AS active_fellows,
  SUM(tasks_completed) AS total_tasks_completed,
  SUM(submissions_awaiting_review) AS review_backlog,
  ROUND(AVG(approval_rate) * 100, 2) AS avg_approval_rate_pct,
  ROUND(AVG(avg_tic_per_task), 2) AS avg_tic
FROM `hs-ai-production.hai_dev.fact_otter_fellow_perf`
GROUP BY campaign
ORDER BY active_fellows DESC
```

```sql
-- Otter campaign health dashboard (reviewer perspective)
SELECT
  campaign,
  COUNT(DISTINCT email) AS total_reviewers,
  COUNTIF(active = TRUE) AS active_reviewers,
  SUM(num_reviews) AS total_reviews,
  ROUND(AVG(approval_rate) * 100, 2) AS avg_reviewer_approval_rate_pct,
  ROUND(AVG(avg_tic_issued_per_review), 2) AS avg_tic_issued
FROM `hs-ai-production.hai_dev.fact_otter_reviewer_perf`
GROUP BY campaign
ORDER BY active_reviewers DESC
```

```sql
-- Combined Otter campaign overview (fellows + reviewers)
SELECT
  f.campaign,
  f.active_fellows,
  f.total_tasks_completed,
  f.review_backlog,
  f.avg_approval_rate_pct AS fellow_approval_rate_pct,
  r.active_reviewers,
  r.total_reviews,
  r.avg_reviewer_approval_rate_pct
FROM (
  SELECT campaign,
    COUNTIF(active = TRUE) AS active_fellows,
    SUM(tasks_completed) AS total_tasks_completed,
    SUM(submissions_awaiting_review) AS review_backlog,
    ROUND(AVG(approval_rate) * 100, 2) AS avg_approval_rate_pct
  FROM `hs-ai-production.hai_dev.fact_otter_fellow_perf`
  GROUP BY campaign
) f
LEFT JOIN (
  SELECT campaign,
    COUNTIF(active = TRUE) AS active_reviewers,
    SUM(num_reviews) AS total_reviews,
    ROUND(AVG(approval_rate) * 100, 2) AS avg_reviewer_approval_rate_pct
  FROM `hs-ai-production.hai_dev.fact_otter_reviewer_perf`
  GROUP BY campaign
) r ON f.campaign = r.campaign
ORDER BY f.active_fellows DESC
```

---

## Otter Cross-Table Joins

### fact_otter_comments → fact_otter_tasks
```sql
-- Comments joined to task context
SELECT
  t.task_id, t.task_batch, t.campaign,
  t.fellow_email, t.reviewer_email,
  t.status, t.major_issues, t.minor_issues,
  c.severity, c.category, c.issue_created_at
FROM `hs-ai-production.hai_dev.fact_otter_tasks` t
INNER JOIN `hs-ai-production.hai_dev.fact_otter_comments` c
  ON t.task_id = c.task_id AND t.task_batch = c.task_batch AND t.campaign = c.campaign
WHERE t.campaign = @campaign
ORDER BY c.issue_created_at DESC
```

### Fellow feedback analysis (comments per fellow)
```sql
-- Issue frequency per fellow across campaigns
SELECT
  t.fellow_email, t.campaign,
  COUNT(DISTINCT t.task_id) AS tasks,
  COUNT(c.issue_created_at) AS total_comments,
  COUNTIF(c.severity = 'major') AS major_issues,
  COUNTIF(c.severity = 'minor') AS minor_issues,
  COUNTIF(c.severity = 'praise') AS praises,
  ROUND(COUNTIF(c.severity = 'major') * 1.0 / NULLIF(COUNT(DISTINCT t.task_id), 0), 2) AS majors_per_task
FROM `hs-ai-production.hai_dev.fact_otter_tasks` t
LEFT JOIN `hs-ai-production.hai_dev.fact_otter_comments` c
  ON t.task_id = c.task_id AND t.task_batch = c.task_batch AND t.campaign = c.campaign
GROUP BY t.fellow_email, t.campaign
HAVING COUNT(DISTINCT t.task_id) >= 5
ORDER BY majors_per_task DESC
```

### Otter task activity → fellow perf (enriched activity log)
```sql
-- Task activity with fellow performance context
SELECT
  a.task_id, a.campaign, a.activity_type, a.created_at,
  a.email, a.major_issues, a.minor_issues,
  fp.approval_rate, fp.tasks_completed, fp.avg_tic_per_task
FROM `hs-ai-production.hai_dev.fact_otter_task_activity` a
INNER JOIN `hs-ai-production.hai_dev.fact_otter_fellow_perf` fp
  ON a.email = fp.email AND a.campaign = fp.campaign
WHERE a.grouped_activity_type = 'first_submit'
  AND a.campaign = @campaign
ORDER BY a.created_at DESC
```
