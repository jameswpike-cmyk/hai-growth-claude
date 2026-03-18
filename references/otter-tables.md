# Otter Table Schemas

## Key Differences: Otter vs HAI Platform

Otter (also known as Feather) is a separate annotation platform with different data modeling conventions:

| Concept | HAI Platform | Otter / Feather |
|---------|-------------|-----------------|
| Grouping | `project_id` / `project_name` | `campaign` + `task_batch` |
| Identity | `profile_id` (integer) | `email` (string) — optionally map via `fact_otter_email_mapping` |
| Time tracking | Yes (`time_worked_in_hours_*`) | No — Otter does not track time |
| Review layers | R1 + R2 pipeline stages | Single review layer |
| Statuses | `task_submitted`, `task_reviewed_approved`, `task_reviewed_rejected` | `completed`, `signed_off`, `needs_work`, `fixing_done` |
| Source schema | `hai_dev` (curated) | `hai_dev` (derived from `otter_exports`) |
| Timestamps | UTC | PST — always use PST for date logic |

**Important rules:**
- For completed-task metrics in `fact_otter_task_activity`, always filter on `completed_at IS NOT NULL` — do NOT use `created_at` as a proxy for completion
- Otter `approval_rate` fields are stored as decimals (0.0–1.0); multiply by 100 for percentages
- Use `campaign` (not `project_name`) for grouping Otter data

---

## 1. fact_otter_task_activity

**Fully-qualified name:** `hs-ai-production.hai_dev.fact_otter_task_activity`
**Grain:** One row per activity event on an Otter task
**Updates:** Hourly

### Columns — Identifiers

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Row ID |
| task_id | STRING | Task identifier |
| task_batch | STRING | Task batch |
| campaign | STRING | Campaign name |
| email | STRING | Who performed the action |
| profile_id | INTEGER | Optional mapped profile ID |

### Columns — Activity

| Column | Type | Description |
|--------|------|-------------|
| activity_type | STRING | `completed`, `fixing_done`, `needs_work`, `signed_off` |
| grouped_activity_type | STRING | Simplified: `first_submit`, `subsequent_submit`, `first_review`, `subsequent_review` |
| created_at | TIMESTAMP | When the activity occurred |
| completed_at | TIMESTAMP | When the task reached final completion — **use this for completed metrics** |
| submitted_by | STRING | Email of the submitter |
| cancelled | BOOLEAN | Whether the task was cancelled |
| escalated | BOOLEAN | Whether the task was escalated |

### Columns — Issues

| Column | Type | Description |
|--------|------|-------------|
| major_issues | INTEGER | Count of major issues |
| minor_issues | INTEGER | Count of minor issues |
| praises | INTEGER | Count of praises |
| general_comments | INTEGER | Count of general comments |

### Columns — Navigation

| Column | Type | Description |
|--------|------|-------------|
| next_activity_id | INTEGER | Next activity row ID |
| next_activity_type | STRING | Next activity type |
| next_activity_email | STRING | Who did the next action |
| next_activity_created_at | TIMESTAMP | Timestamp of next activity |
| prev_activity_id | INTEGER | Previous activity row ID |
| prev_activity_type | STRING | Previous activity type |
| prev_activity_email | STRING | Who did the previous action |
| prev_activity_created_at | TIMESTAMP | Timestamp of previous activity |

### Key Joins
- `task_id` + `task_batch` + `campaign` → `fact_otter_tasks`
- `email` → `fact_otter_fellow_perf.email` or `fact_otter_reviewer_perf.email`

### Common Patterns

**Otter Approval Rate by Campaign:**
```sql
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

**Otter Task Throughput Over Time:**
```sql
SELECT
  campaign,
  DATE_TRUNC(DATE(completed_at, 'America/Los_Angeles'), WEEK(MONDAY)) AS week,
  COUNT(DISTINCT task_id) AS tasks_completed
FROM `hs-ai-production.hai_dev.fact_otter_task_activity`
WHERE completed_at IS NOT NULL
  AND grouped_activity_type = 'first_submit'
GROUP BY campaign, week
ORDER BY campaign, week
```

**Otter Response Time (Submission → Review):**
```sql
SELECT
  campaign,
  AVG(TIMESTAMP_DIFF(next_activity_created_at, created_at, MINUTE)) AS avg_response_minutes,
  APPROX_QUANTILES(TIMESTAMP_DIFF(next_activity_created_at, created_at, MINUTE), 2)[OFFSET(1)] AS median_response_minutes
FROM `hs-ai-production.hai_dev.fact_otter_task_activity`
WHERE grouped_activity_type = 'first_submit'
  AND next_activity_type IN ('signed_off', 'needs_work')
GROUP BY campaign
```

---

## 2. fact_otter_tasks

**Fully-qualified name:** `hs-ai-production.hai_dev.fact_otter_tasks`
**Grain:** One row per Otter task (`task_id` + `task_batch`)
**Updates:** Hourly

### Columns — Identifiers

| Column | Type | Description |
|--------|------|-------------|
| task_id | STRING | Primary Key (Part 1) |
| task_batch | STRING | Primary Key (Part 2) |
| campaign | STRING | Campaign name |

### Columns — People

| Column | Type | Description |
|--------|------|-------------|
| fellow_email | STRING | Fellow's email |
| fellow_profile_id | INTEGER | Optional mapped profile ID |
| fellow_latest_activity | TIMESTAMP | Fellow's latest activity |
| reviewer_email | STRING | Reviewer's email |
| reviewer_profile_id | INTEGER | Optional mapped profile ID |
| reviewer_latest_activity | TIMESTAMP | Reviewer's latest activity |

### Columns — Lifecycle Timestamps

| Column | Type | Description |
|--------|------|-------------|
| first_submitted_at | TIMESTAMP | First submission |
| last_edited_at | TIMESTAMP | Most recent edit |
| first_reviewed_at | TIMESTAMP | First review |
| last_reviewed_at | TIMESTAMP | Most recent review |
| last_touch_at | TIMESTAMP | max(last_edited_at, last_reviewed_at) |

### Columns — Metrics

| Column | Type | Description |
|--------|------|-------------|
| revisions | INTEGER | Count of task revisions |
| touches | INTEGER | Count of activity events |
| major_issues | INTEGER | Total major issues |
| minor_issues | INTEGER | Total minor issues |
| praises | INTEGER | Total praises |
| general_comments | INTEGER | Total general comments |

### Columns — Status

| Column | Type | Description |
|--------|------|-------------|
| status | STRING | Current task status |
| cancelled | BOOLEAN | Is cancelled |
| escalated | BOOLEAN | Is escalated |

### Key Joins
- `task_id` + `task_batch` + `campaign` → `fact_otter_task_activity`
- `task_id` + `task_batch` + `campaign` → `fact_otter_comments`
- `fellow_email` + `campaign` → `fact_otter_fellow_perf`
- `reviewer_email` + `campaign` → `fact_otter_reviewer_perf`

### Common Patterns

**Task Status Distribution by Campaign:**
```sql
SELECT
  campaign, status,
  COUNT(*) AS task_count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (PARTITION BY campaign), 2) AS pct
FROM `hs-ai-production.hai_dev.fact_otter_tasks`
WHERE cancelled = FALSE
GROUP BY campaign, status
ORDER BY campaign, task_count DESC
```

**Task Turnaround Times:**
```sql
SELECT
  campaign,
  COUNT(*) AS total_tasks,
  ROUND(AVG(TIMESTAMP_DIFF(first_reviewed_at, first_submitted_at, HOUR)), 1) AS avg_hours_to_review,
  AVG(revisions) AS avg_revisions,
  AVG(touches) AS avg_touches
FROM `hs-ai-production.hai_dev.fact_otter_tasks`
WHERE first_submitted_at IS NOT NULL
GROUP BY campaign
ORDER BY total_tasks DESC
```

**Escalated Otter Tasks:**
```sql
SELECT
  task_id, task_batch, campaign,
  fellow_email, reviewer_email,
  status, major_issues, minor_issues
FROM `hs-ai-production.hai_dev.fact_otter_tasks`
WHERE escalated = TRUE
ORDER BY major_issues DESC
```

---

## 3. fact_otter_comments

**Fully-qualified name:** `hs-ai-production.hai_dev.fact_otter_comments`
**Grain:** One row per comment per activity
**Updates:** Hourly

### Columns — Activity Context

| Column | Type | Description |
|--------|------|-------------|
| activity_id | INTEGER | Activity ID (links to fact_otter_task_activity.id) |
| task_id | STRING | Task ID |
| task_batch | STRING | Task batch |
| campaign | STRING | Campaign name |
| activity_type | STRING | Activity type at time of comment |
| created_at | TIMESTAMP | Activity timestamp |
| email | STRING | Commenter's email |
| profile_id | INTEGER | Optional mapped profile ID |

### Columns — Activity Window

| Column | Type | Description |
|--------|------|-------------|
| prev_activity_id | INTEGER | Previous activity ID |
| prev_activity_type | STRING | Previous activity type |
| prev_activity_email | STRING | Previous activity performer |
| prev_activity_created_at | TIMESTAMP | Previous activity timestamp |
| next_activity_id | INTEGER | Next activity ID |
| next_activity_type | STRING | Next activity type |
| next_activity_email | STRING | Next activity performer |
| next_activity_created_at | TIMESTAMP | Next activity timestamp |

### Columns — Comment Details

| Column | Type | Description |
|--------|------|-------------|
| issue_type | STRING | Comment type |
| severity | STRING | `major`, `minor`, `praise` |
| category | STRING | Issue category |
| recipient | STRING | Who the comment is directed at |
| resolved | BOOLEAN | Whether the issue was resolved |
| issue_created_at | TIMESTAMP | Comment creation time |

### Key Joins
- `activity_id` → `fact_otter_task_activity.id`
- `task_id` + `task_batch` + `campaign` → `fact_otter_tasks`

### Important Notes
- Comments are linked to the review activity window — between `prev_activity_created_at` and `created_at`
- No block-level granularity (unlike HAI `fact_comments` which has `block_id`)
- Use `severity` for filtering; `category` for grouping by issue type

### Common Patterns

**Comment Volume by Severity and Campaign:**
```sql
SELECT
  campaign, severity,
  COUNT(*) AS comment_count,
  COUNT(DISTINCT task_id) AS tasks_with_comments,
  ROUND(COUNT(*) / NULLIF(COUNT(DISTINCT task_id), 0), 2) AS avg_comments_per_task
FROM `hs-ai-production.hai_dev.fact_otter_comments`
GROUP BY campaign, severity
ORDER BY campaign,
  CASE severity WHEN 'major' THEN 1 WHEN 'minor' THEN 2 WHEN 'praise' THEN 3 END
```

**Issue Category Distribution:**
```sql
SELECT
  campaign, category,
  COUNT(*) AS occurrences,
  COUNTIF(severity = 'major') AS major_count,
  COUNTIF(severity = 'minor') AS minor_count,
  ROUND(COUNTIF(resolved = TRUE) * 100.0 / COUNT(*), 2) AS resolved_pct
FROM `hs-ai-production.hai_dev.fact_otter_comments`
WHERE category IS NOT NULL
GROUP BY campaign, category
ORDER BY occurrences DESC
```

**Unresolved Issues:**
```sql
SELECT
  task_id, task_batch, campaign, email,
  severity, category, issue_created_at
FROM `hs-ai-production.hai_dev.fact_otter_comments`
WHERE resolved = FALSE
  AND severity IN ('major', 'minor')
ORDER BY issue_created_at DESC
```

---

## 4. fact_otter_fellow_perf

**Fully-qualified name:** `hs-ai-production.hai_dev.fact_otter_fellow_perf`
**Grain:** One row per fellow per campaign
**Updates:** Hourly

### Columns — Identifiers

| Column | Type | Description |
|--------|------|-------------|
| email | STRING | Primary Key (Part 1) |
| profile_id | INTEGER | Optional mapped profile ID |
| user_id | STRING | Otter/Feather user ID |
| campaign | STRING | Primary Key (Part 2) |
| feather_account_created_at | TIMESTAMP | Feather account creation date |

### Columns — Role & Activity

| Column | Type | Description |
|--------|------|-------------|
| feather_roles | STRING | Roles in Feather |
| last_login_at | TIMESTAMP | Last login timestamp |
| latest_activity | TIMESTAMP | Most recent activity |
| active | BOOLEAN | Activity within last 7 days |
| days_since_latest_activity | INTEGER | Days since last activity |

### Columns — Task Counts

| Column | Type | Description |
|--------|------|-------------|
| submissions | INTEGER | Total submissions |
| submissions_awaiting_review | INTEGER | Pending review |
| submissions_reviewed_at_least_once | INTEGER | Reviewed submissions |
| total_reviews | INTEGER | Total review events |
| total_rejections | INTEGER | Rejected submissions |
| total_approvals | INTEGER | Approved submissions |
| tasks_attempted | INTEGER | Distinct tasks attempted |
| tasks_with_at_least_one_review | INTEGER | Tasks with reviews |
| tasks_awaiting_first_review | INTEGER | Tasks pending first review |
| tasks_completed | INTEGER | Completed tasks |

### Columns — Quality

| Column | Type | Description |
|--------|------|-------------|
| approval_rate | DECIMAL | 0.0–1.0 (multiply by 100 for %) |
| tasks_completed_on_first_attempt | INTEGER | Tasks approved without rework |
| first_pass_attempt_pct | DECIMAL | First-attempt approval rate |
| avg_major_issues_per_submission | FLOAT | Major issues per submission |
| avg_minor_issues_per_submission | FLOAT | Minor issues per submission |
| avg_tic_per_submission | FLOAT | TIC per submission |
| avg_praises_per_submission | FLOAT | Praises per submission |
| avg_major_issues_per_task | FLOAT | Major issues per task |
| avg_minor_issues_per_task | FLOAT | Minor issues per task |
| avg_tic_per_task | FLOAT | TIC per task |
| avg_praises_per_task | FLOAT | Praises per task |
| tasks_with_praise | INTEGER | Tasks receiving praise |

### Key Joins
- `email` + `campaign` → `fact_otter_tasks.fellow_email` + `campaign`
- `email` + `campaign` → `fact_otter_task_activity.email` + `campaign`

### Common Patterns

**Top Otter Fellows by Campaign:**
```sql
SELECT
  email, campaign,
  tasks_completed, submissions,
  ROUND(approval_rate * 100, 2) AS approval_rate_pct,
  ROUND(first_pass_attempt_pct * 100, 2) AS first_pass_pct,
  ROUND(avg_tic_per_task, 2) AS avg_tic
FROM `hs-ai-production.hai_dev.fact_otter_fellow_perf`
WHERE tasks_completed >= 5
ORDER BY approval_rate DESC, avg_tic_per_task ASC
LIMIT 20
```

**Otter Campaign Health Dashboard:**
```sql
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

**Fellows Needing Attention:**
```sql
SELECT
  email, campaign,
  ROUND(approval_rate * 100, 2) AS approval_rate_pct,
  ROUND(avg_tic_per_task, 2) AS avg_tic,
  days_since_latest_activity,
  CASE
    WHEN approval_rate < 0.7 AND total_reviews >= 5 THEN 'Low Approval Rate'
    WHEN avg_tic_per_task > 2.0 THEN 'High Issue Count'
    WHEN tasks_awaiting_first_review > 5 THEN 'Review Backlog'
    WHEN days_since_latest_activity > 14 THEN 'Inactive'
  END AS concern_type
FROM `hs-ai-production.hai_dev.fact_otter_fellow_perf`
WHERE (approval_rate < 0.7 AND total_reviews >= 5)
  OR avg_tic_per_task > 2.0
  OR tasks_awaiting_first_review > 5
  OR days_since_latest_activity > 14
ORDER BY approval_rate ASC
```

---

## 5. fact_otter_reviewer_perf

**Fully-qualified name:** `hs-ai-production.hai_dev.fact_otter_reviewer_perf`
**Grain:** One row per reviewer per campaign
**Updates:** Hourly

### Columns — Identifiers

| Column | Type | Description |
|--------|------|-------------|
| email | STRING | Primary Key (Part 1) |
| profile_id | INTEGER | Optional mapped profile ID |
| user_id | STRING | Otter/Feather user ID |
| campaign | STRING | Primary Key (Part 2) |
| feather_account_created_at | TIMESTAMP | Feather account creation date |
| feather_roles | STRING | Roles in Feather |
| last_login_at | TIMESTAMP | Last login timestamp |

### Columns — Activity

| Column | Type | Description |
|--------|------|-------------|
| latest_activity | TIMESTAMP | Most recent activity |
| days_since_latest_activity | INTEGER | Days since last activity |
| active | BOOLEAN | Activity within last 7 days |

### Columns — Review Volume

| Column | Type | Description |
|--------|------|-------------|
| num_reviews | INTEGER | Total reviews performed |
| num_approvals | INTEGER | Approvals issued |
| num_rejections | INTEGER | Rejections issued |
| approval_rate | DECIMAL | 0.0–1.0 (multiply by 100 for %) |
| num_tasks_reviewed | INTEGER | Distinct tasks reviewed |

### Columns — Quality (Issues Issued)

| Column | Type | Description |
|--------|------|-------------|
| avg_major_issues_issued_per_review | FLOAT | Avg major issues per review |
| avg_minor_issues_issued_per_review | FLOAT | Avg minor issues per review |
| avg_tic_issued_per_review | FLOAT | TIC per review |
| avg_praises_issued_per_review | FLOAT | Avg praises per review |
| avg_general_comments_issued_per_review | FLOAT | Avg general comments per review |
| avg_major_issues_issued_per_task | FLOAT | Avg major issues per task |
| avg_minor_issues_issued_per_task | FLOAT | Avg minor issues per task |
| avg_tic_issued_per_task | FLOAT | TIC per task |
| avg_praises_issued_per_task | FLOAT | Avg praises per task |
| avg_general_comments_issued_per_task | FLOAT | Avg general comments per task |

### Key Joins
- `email` + `campaign` → `fact_otter_tasks.reviewer_email` + `campaign`
- `email` + `campaign` → `fact_otter_task_activity.email` + `campaign`

### Important Notes
- No R2 concept — Otter has a single review layer (unlike HAI platform's R1 + R2)
- No time/hours tracking — Otter does not measure time worked
- `approval_rate` here is the reviewer's rate of approving tasks they review

### Common Patterns

**Top Otter Reviewers by Campaign:**
```sql
SELECT
  email, campaign,
  num_reviews, num_approvals, num_rejections,
  ROUND(approval_rate * 100, 2) AS approval_rate_pct,
  num_tasks_reviewed,
  ROUND(avg_tic_issued_per_review, 2) AS avg_tic_issued
FROM `hs-ai-production.hai_dev.fact_otter_reviewer_perf`
WHERE num_reviews >= 10
ORDER BY num_reviews DESC
LIMIT 20
```

**Reviewer Strictness Analysis:**
```sql
SELECT
  email, campaign,
  num_reviews,
  ROUND(approval_rate * 100, 2) AS approval_rate_pct,
  ROUND(avg_major_issues_issued_per_review, 2) AS avg_majors,
  ROUND(avg_tic_issued_per_review, 2) AS avg_tic,
  CASE
    WHEN approval_rate < 0.5 THEN 'Very Strict'
    WHEN approval_rate < 0.7 THEN 'Strict'
    WHEN approval_rate > 0.95 THEN 'Very Lenient'
    WHEN approval_rate > 0.85 THEN 'Lenient'
    ELSE 'Moderate'
  END AS strictness
FROM `hs-ai-production.hai_dev.fact_otter_reviewer_perf`
WHERE num_reviews >= 20
ORDER BY approval_rate ASC
```

**Campaign Reviewer Coverage:**
```sql
SELECT
  campaign,
  COUNT(DISTINCT email) AS total_reviewers,
  COUNTIF(active = TRUE) AS active_reviewers,
  SUM(num_reviews) AS total_reviews,
  ROUND(AVG(approval_rate) * 100, 2) AS avg_approval_rate_pct,
  ROUND(AVG(avg_tic_issued_per_review), 2) AS avg_tic_issued
FROM `hs-ai-production.hai_dev.fact_otter_reviewer_perf`
GROUP BY campaign
ORDER BY active_reviewers DESC
```
