# Fact Table Schemas

**Use this file to look up exact column names, types, and join keys for fact tables. Never guess column names — find them here first. If a column isn't listed, run `bq show --format=prettyjson PROJECT:SCHEMA.TABLE` to verify against the live schema.**

## 1. fact_task_activity

**Fully-qualified name:** `hs-ai-production.hai_dev.fact_task_activity`
**Grain:** One row per action on a task
**Updates:** Hourly

### Columns

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Row ID |
| task_id | INTEGER | Unique task identifier |
| profile_id | INTEGER | Who performed the action |
| activity_type | STRING | `task_submitted`, `task_reviewed_approved`, `task_reviewed_rejected` |
| grouped_activity_type | STRING | Simplified — approvals/rejections combined as `reviewed` |
| created_at | TIMESTAMP | When action occurred |
| completed_at | TIMESTAMP | Task completion timestamp |
| project_name | STRING | Project name |
| pipeline_stage_name | STRING | `Review 1`, `Review 2`, `Not Started`, `Attempt` |
| task_revision_id | STRING | Specific task revision |
| time_worked_in_hours_capped | FLOAT | Time spent (capped at 1.5x limit) |
| payable_time_worked_in_hours | FLOAT | Payable time (capped at time limit) |
| major_issues | INTEGER | Count of major problems found |
| minor_issues | INTEGER | Count of minor problems found |
| next_activity_type | STRING | Following activity type |
| next_activity_created_at | TIMESTAMP | Timestamp of next activity |
| prev_activity_type | STRING | Previous activity type |

### Key Joins
- `profile_id` → `fact_fellow_perf.profile_id`
- `task_id` → `fact_tasks.task_id`
- `project_name` → shared across fact tables

### Common Patterns

**Approval Rate by Project:**
```sql
SELECT
  project_name,
  COUNT(DISTINCT CASE WHEN activity_type = 'task_reviewed_approved' THEN id END) * 1.0 /
    NULLIF(COUNT(DISTINCT CASE WHEN activity_type IN ('task_reviewed_approved', 'task_reviewed_rejected') THEN id END), 0)
    AS approval_rate
FROM `hs-ai-production.hai_dev.fact_task_activity`
GROUP BY project_name
```

**Average Handle Time (AHT):**
```sql
SELECT
  project_name,
  SUM(time_worked_in_hours_capped) / NULLIF(COUNT(DISTINCT task_id), 0) AS aht
FROM `hs-ai-production.hai_dev.fact_task_activity`
GROUP BY project_name
```

**Review Coverage:**
```sql
SELECT
  project_name,
  COUNT(DISTINCT CASE WHEN pipeline_stage_name = 'Review 1' THEN task_revision_id END) * 1.0 /
    NULLIF(COUNT(DISTINCT CASE WHEN activity_type = 'task_submitted' THEN task_revision_id END), 0)
    AS review_coverage
FROM `hs-ai-production.hai_dev.fact_task_activity`
GROUP BY project_name
```

**Active Contributors:**
```sql
COUNT(DISTINCT CASE WHEN pipeline_stage_name IN ('Not Started', 'Attempt') THEN profile_id END)
```

**Response Time (submission → review):**
```sql
AVG(TIMESTAMP_DIFF(next_activity_created_at, created_at, MINUTE)) AS avg_response_minutes,
APPROX_QUANTILES(TIMESTAMP_DIFF(next_activity_created_at, created_at, MINUTE), 2)[OFFSET(1)] AS median_response_minutes
```

**Task Rework (touches per task):**
```sql
SELECT pipeline_stage_name, task_id, COUNT(*) AS touches
FROM `hs-ai-production.hai_dev.fact_task_activity`
WHERE completed_at IS NOT NULL
GROUP BY pipeline_stage_name, task_id
```

---

## 2. fact_project_funnel

**Fully-qualified name:** `hs-ai-production.hai_dev.fact_project_funnel`
**Grain:** One row per profile_id + project_id
**Updates:** Hourly

### Columns

| Column | Type | Description |
|--------|------|-------------|
| profile_id | INTEGER | Fellow profile ID |
| project_id | INTEGER | Project ID |
| project_name | STRING | Project name |
| pso_allocated_pst | TIMESTAMP | When allocated to PSO |
| pso_completed_pst | TIMESTAMP | When PSO completed |
| pso_allocated_week | DATE | Week of PSO allocation (Monday start) |
| canvas_enrolled_at | TIMESTAMP | Canvas enrollment timestamp |
| canvas_finished_at | TIMESTAMP | Canvas completion timestamp |
| contract_finished_at_pst | TIMESTAMP | Contract signing completion |
| first_claimed_at_pst | TIMESTAMP | First task claim |
| first_task_submitted_pst | TIMESTAMP | First task submission |
| first_task_reviewed_pst | TIMESTAMP | First task review |
| first_task_approved_pst | TIMESTAMP | First task approval |

### Key Joins
- `profile_id` → `fact_fellow_perf.profile_id`
- `project_id` → `fact_fellow_perf.project_id`
- `project_name` → shared across fact tables

### Data Logic
- **PSO**: Uses earliest of `project_onboarding_started_at` or `prod_onboarded_date` for allocation; `project_onboarding_completed_at` or `prod_onboarded_date` for completion
- **Canvas**: From `fellow_project_specific_onboarding_tasks` where type contains `canvas` and completed = true
- **Contract**: From `fellow_project_specific_onboarding_tasks` where type = `document` and completed = true

### Common Patterns

**Onboarding Funnel Counts:**
```sql
SELECT
  COUNT(DISTINCT profile_id) AS allocated,
  COUNT(DISTINCT CASE WHEN canvas_finished_at IS NOT NULL THEN profile_id END) AS completed_canvas,
  COUNT(DISTINCT CASE WHEN first_claimed_at_pst IS NOT NULL THEN profile_id END) AS claimed_task,
  COUNT(DISTINCT CASE WHEN first_task_approved_pst IS NOT NULL THEN profile_id END) AS approved_task
FROM `hs-ai-production.hai_dev.fact_project_funnel`
WHERE project_id = @project_id
```

**Time-to-Milestone:**
```sql
SELECT
  project_name,
  ROUND(AVG(DATETIME_DIFF(canvas_enrolled_at, pso_allocated_pst, HOUR)), 1) AS hours_to_canvas,
  ROUND(AVG(DATETIME_DIFF(first_claimed_at_pst, pso_completed_pst, HOUR)), 1) AS hours_to_first_claim,
  ROUND(AVG(DATETIME_DIFF(first_task_approved_pst, first_task_submitted_pst, HOUR)), 1) AS hours_to_approval
FROM `hs-ai-production.hai_dev.fact_project_funnel`
WHERE pso_allocated_week >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
GROUP BY 1
```

**Bottleneck Analysis:**
```sql
SELECT 'PSO → Canvas' AS stage,
  COUNT(*) AS started,
  COUNT(canvas_enrolled_at) AS completed,
  ROUND(COUNT(canvas_enrolled_at) * 100.0 / COUNT(*), 1) AS completion_pct
FROM `hs-ai-production.hai_dev.fact_project_funnel`
WHERE pso_allocated_pst IS NOT NULL
UNION ALL
SELECT 'Canvas → First Claim',
  COUNT(*), COUNT(first_claimed_at_pst),
  ROUND(COUNT(first_claimed_at_pst) * 100.0 / COUNT(*), 1)
FROM `hs-ai-production.hai_dev.fact_project_funnel`
WHERE canvas_finished_at IS NOT NULL
```

---

## 3. fact_fellow_profile

**Fully-qualified name:** `handshake-production.hai_dev.fact_fellow_profile`
**Grain:** One row per fellow profile
**Updates:** Hourly

### Columns

| Column | Type | Description |
|--------|------|-------------|
| profile_id | INTEGER | Primary Key |
| full_name | STRING | Fellow's full name |
| email | STRING | Fellow's email |
| profile_status | STRING | `active`, `inactive`, `pending` |
| profile_created_at | TIMESTAMP | Profile creation timestamp |
| handshake_user_id | INTEGER | Handshake platform ID |
| handshake_student_id | INTEGER | Handshake student ID |
| handshake_school_id | INTEGER | Current institution ID |
| current_school_name | STRING | School name |
| handshake_first_name | STRING | First name in Handshake |
| handshake_last_name | STRING | Last name in Handshake |
| handshake_preferred_full_name | STRING | Preferred name |
| current_cumulative_gpa | INTEGER | **GPA as integer — divide by 100** |
| graduation_date | DATE | Expected/actual graduation |
| current_education_level | STRING | Bachelor's, Master's, PhD |
| majors | STRING | Comma-separated (from gold_tables.majors) |
| colleges | STRING | Comma-separated college names |
| schools_attended | STRING | Comma-separated list |
| degrees_earned | STRING | Comma-separated degrees |
| undergraduate_university | STRING | From survey |
| graduate_university | STRING | From survey |
| educational_layer | STRING | Highest education from survey |
| current_authorized_in_us | BOOLEAN | Work authorization status |
| current_opt_cpt_work_authorization_eligible | BOOLEAN | OPT/CPT eligible |
| current_student_requires_us_sponsorship | BOOLEAN | Sponsorship needed |
| domain | STRING | System-classified expertise |
| subdomain | STRING | System-classified subdomain |
| survey_domain | STRING | Self-reported domain |
| survey_subdomains | STRING | Self-reported subdomains |
| skills | STRING | Comma-separated skills |
| languages | STRING | Comma-separated languages |
| proficiency_levels | STRING | Comma-separated proficiency levels |
| hometown_country | STRING | Canonical country name |

### Key Joins
- `profile_id` → `fact_fellow_perf.profile_id`
- `profile_id` → `hai_profiles_dim.profile_id`

### Common Patterns

**Find Fellows by Major:**
```sql
SELECT profile_id, full_name, email, majors, graduation_date, current_school_name,
  current_cumulative_gpa / 100.0 AS gpa
FROM `handshake-production.hai_dev.fact_fellow_profile`
WHERE majors LIKE '%Computer Science%'
  AND graduation_date BETWEEN CURRENT_DATE() AND DATE_ADD(CURRENT_DATE(), INTERVAL 6 MONTH)
ORDER BY graduation_date ASC
```

**Skills Inventory (UNNEST pattern):**
```sql
WITH skills_split AS (
  SELECT profile_id, TRIM(skill) AS skill
  FROM `handshake-production.hai_dev.fact_fellow_profile`,
  UNNEST(SPLIT(skills, ',')) AS skill
  WHERE skills IS NOT NULL
)
SELECT skill, COUNT(DISTINCT profile_id) AS fellow_count
FROM skills_split
WHERE skill != ''
GROUP BY skill
ORDER BY fellow_count DESC
LIMIT 20
```

**Work Authorization Analysis:**
```sql
SELECT
  CASE
    WHEN current_authorized_in_us = TRUE THEN 'Authorized in US'
    WHEN current_opt_cpt_work_authorization_eligible = TRUE THEN 'OPT/CPT Eligible'
    WHEN current_student_requires_us_sponsorship = TRUE THEN 'Requires Sponsorship'
    ELSE 'Status Unknown'
  END AS work_auth_category,
  COUNT(*) AS fellow_count
FROM `handshake-production.hai_dev.fact_fellow_profile`
WHERE handshake_student_id IS NOT NULL
GROUP BY 1
ORDER BY fellow_count DESC
```

---

## 4. fact_fellow_perf

**Fully-qualified name:** `hs-ai-production.hai_dev.fact_fellow_perf`
**Grain:** One row per fellow per project
**Updates:** Hourly

### Columns — Identifiers

| Column | Type | Description |
|--------|------|-------------|
| profile_id | STRING | Primary Key (Part 1) |
| project_id | INTEGER | Primary Key (Part 2) |
| full_name | STRING | Fellow's full name |
| email | STRING | Fellow's email |
| project_name | STRING | Project name |

### Columns — Role & Activity

| Column | Type | Description |
|--------|------|-------------|
| allocated | BOOLEAN | Has assigned role |
| current_role | STRING | Comma-separated roles |
| latest_activity | TIMESTAMP | Most recent activity |
| active | BOOLEAN | Activity within last 7 days |
| days_since_latest_activity | INTEGER | Days since last activity |

### Columns — Task Counts

| Column | Type | Description |
|--------|------|-------------|
| submissions | INTEGER | Total submissions |
| approvals | INTEGER | Approved submissions |
| rejections | INTEGER | Rejected submissions |
| total_reviews | INTEGER | approvals + rejections |
| tasks_attempted | INTEGER | Distinct tasks attempted |
| tasks_submitted | INTEGER | Distinct submitted tasks |
| tasks_completed | INTEGER | Completed tasks |
| tasks_escalated | INTEGER | Escalated tasks |
| tasks_archived | INTEGER | Archived tasks |

### Columns — Review Status

| Column | Type | Description |
|--------|------|-------------|
| submissions_awaiting_review | INTEGER | Pending review |
| submissions_reviewed_at_least_once | INTEGER | Reviewed submissions |
| tasks_with_at_least_one_review | INTEGER | Tasks with reviews |
| tasks_awaiting_first_review | INTEGER | Submitted but not reviewed |

### Columns — Time

| Column | Type | Description |
|--------|------|-------------|
| total_hours_worked_capped | FLOAT | Hours (capped 1.5x limit) — **use this** |
| total_hours_worked_raw | FLOAT | Hours (uncapped — inflated by timer left on) |
| payable_total_hours_worked | FLOAT | Hours (capped at time limit) |
| aht | FLOAT | Average handling time per task |
| median_aht | FLOAT | Median AHT |

### Columns — Quality

| Column | Type | Description |
|--------|------|-------------|
| approval_rate | DECIMAL | 0.0–1.0 (multiply by 100 for %) |
| first_pass_pct | DECIMAL | Approvals without escalation / total approvals |
| total_major_issues | INTEGER | Count of major issues |
| total_minor_issues | INTEGER | Count of minor issues |
| total_praises | INTEGER | Count of praise comments |
| avg_major_issues | FLOAT | Major issues per review |
| avg_minor_issues | FLOAT | Minor issues per review |
| avg_tic | FLOAT | (major + 0.33 * minor) / tasks_attempted |

### Key Joins
- `profile_id` → `fact_fellow_profile.profile_id`
- `profile_id` → `hai_profiles_dim.profile_id`
- `project_id` → `fact_project_funnel.project_id`

### Common Patterns

**Active Fellow Count:**
```sql
SELECT COUNT(DISTINCT profile_id) AS active_fellow_count
FROM `hs-ai-production.hai_dev.fact_fellow_perf`
WHERE project_name = 'Project X'
  AND active = TRUE
```

**Top Performers (min 10 reviews):**
```sql
SELECT profile_id, full_name, email, project_name,
  approvals, rejections, total_reviews,
  ROUND(approval_rate * 100, 2) AS approval_rate_pct,
  ROUND(total_hours_worked_capped, 2) AS hours_worked,
  tasks_completed,
  ROUND(avg_tic, 2) AS avg_tic
FROM `hs-ai-production.hai_dev.fact_fellow_perf`
WHERE total_reviews >= 10
ORDER BY approval_rate DESC, avg_tic ASC
LIMIT 20
```

**Project Health Dashboard:**
```sql
SELECT project_name,
  COUNT(DISTINCT profile_id) AS total_fellows,
  COUNTIF(active = TRUE) AS active_fellows,
  SUM(tasks_completed) AS total_tasks_completed,
  SUM(submissions_awaiting_review) AS review_backlog,
  ROUND(AVG(approval_rate) * 100, 2) AS avg_approval_rate_pct,
  ROUND(SUM(total_hours_worked_capped), 2) AS total_hours
FROM `hs-ai-production.hai_dev.fact_fellow_perf`
GROUP BY project_name
ORDER BY active_fellows DESC
```

**Fellows Needing Attention:**
```sql
SELECT profile_id, full_name, email, project_name,
  ROUND(approval_rate * 100, 2) AS approval_rate_pct,
  ROUND(avg_tic, 2) AS avg_tic,
  days_since_latest_activity,
  CASE
    WHEN approval_rate < 0.7 AND total_reviews >= 5 THEN 'Low Approval Rate'
    WHEN avg_tic > 2.0 THEN 'High Issue Count'
    WHEN tasks_awaiting_first_review > 5 THEN 'Review Backlog'
    WHEN days_since_latest_activity > 14 THEN 'Inactive'
  END AS concern_type
FROM `hs-ai-production.hai_dev.fact_fellow_perf`
WHERE (approval_rate < 0.7 AND total_reviews >= 5)
  OR avg_tic > 2.0
  OR tasks_awaiting_first_review > 5
  OR days_since_latest_activity > 14
ORDER BY approval_rate ASC
```

---

## 5. fact_tasks

**Fully-qualified name:** `hs-ai-production.hai_dev.fact_tasks`
**Grain:** One row per task
**Updates:** Hourly

### Columns — Identifiers

| Column | Type | Description |
|--------|------|-------------|
| task_id | STRING | Primary Key |
| project_id | INTEGER | Project ID |
| project_name | STRING | Project name |
| latest_revision_id | STRING | Latest task revision |
| template_version | STRING | Template version used |

### Columns — People

| Column | Type | Description |
|--------|------|-------------|
| fellow_id | STRING | Profile ID of fellow |
| fellow_email | STRING | Fellow's email |
| fellow_profile_status | STRING | Fellow's profile status |
| fellow_latest_activity | TIMESTAMP | Fellow's latest activity |
| reviewer_id | STRING | Latest reviewer ID |
| reviewer_email | STRING | Reviewer's email |
| reviewer_profile_status | STRING | Reviewer's profile status |
| reviewer_latest_activity | TIMESTAMP | Reviewer's latest activity |

### Columns — Lifecycle Timestamps

| Column | Type | Description |
|--------|------|-------------|
| task_created_at | TIMESTAMP | Task creation |
| task_created_by | STRING | Creator profile ID |
| first_submitted_at | TIMESTAMP | First submission |
| last_edited_at | TIMESTAMP | Most recent edit |
| first_reviewed_at | TIMESTAMP | First review |
| last_reviewed_at | TIMESTAMP | Most recent review |
| last_touch_at | TIMESTAMP | max(last_edited_at, last_reviewed_at) |

### Columns — Metrics

| Column | Type | Description |
|--------|------|-------------|
| revisions | INTEGER | Count of task revisions |
| touches | INTEGER | Count of activity timestamps |
| total_time_worked_in_hours_raw | FLOAT | Total hours (uncapped) |
| total_time_worked_in_hours_capped | FLOAT | Total hours (1.5x capped) |
| total_payable_time_worked_in_hours | FLOAT | Total hours (time limit capped) |
| major_issues | INTEGER | Total major issues |
| minor_issues | INTEGER | Total minor issues |
| praises | INTEGER | Total praise comments |

### Columns — Status

| Column | Type | Description |
|--------|------|-------------|
| status | STRING | Current task status |
| archived | BOOLEAN | Is archived |
| escalated | BOOLEAN | Is escalated |
| escalation_notes | STRING | Notes from escalation |
| pipeline_stage_name | STRING | Current pipeline stage |
| domain | STRING | Domain from block values |

### Key Joins
- `task_id` → `fact_task_activity.task_id`
- `fellow_id` → `fact_fellow_perf.profile_id`
- `project_id` → `fact_fellow_perf.project_id`

---

## 6. fact_comments

**Fully-qualified name:** `handshake-production.hai_dev.fact_comments`
**Grain:** One row per comment per activity per block
**Updates:** Hourly

### Columns — Activity Context

| Column | Type | Description |
|--------|------|-------------|
| annotation_project_activity_id | STRING | Primary Key Component |
| project_id | INTEGER | Project ID |
| project_name | STRING | Project name |
| task_id | STRING | Task ID |
| task_revision_id | STRING | Task revision ID |
| activity_type | STRING | `task_reviewed_approved`, `task_reviewed_rejected`, `task_submitted` |
| activity_created_at | TIMESTAMP | Activity timestamp |
| pipeline_stage_id | INTEGER | Pipeline stage ID |
| pipeline_stage_name | STRING | Pipeline stage name |
| profile_id | STRING | Reviewer profile ID |

### Columns — Previous Activity

| Column | Type | Description |
|--------|------|-------------|
| prev_activity_type | STRING | Previous activity type |
| prev_activity_created_at | TIMESTAMP | Previous activity timestamp |
| prev_pipeline_stage_id | INTEGER | Previous stage ID |
| prev_pipeline_stage_name | STRING | Previous stage name |
| submitted_by | STRING | Fellow who submitted |

### Columns — Block Context

| Column | Type | Description |
|--------|------|-------------|
| block_id | STRING | Primary Key Component |
| block_label | STRING | Block name (e.g. "Response Quality") |
| turn | INTEGER | Conversation turn (NULL for non-conversational) |
| block_value | STRING | Block content/value |

### Columns — Comment Details

| Column | Type | Description |
|--------|------|-------------|
| issue_type | STRING | `root` (initial), `issue` (standard), `reopen` (reopened) |
| severity | STRING | `major`, `minor`, `praise` |
| issue_label | STRING | Issue category from comment_labels |
| message | STRING | Comment text |
| issue_created_at | TIMESTAMP | Comment creation time |

### Key Joins
- `task_id` → `fact_tasks.task_id`
- `profile_id` → reviewer in `fact_fellow_perf`
- `submitted_by` → fellow in `fact_fellow_perf`

### Important Notes
- **Grain matters**: COUNT(*) counts comment-activity-block combinations. Use COUNT(DISTINCT task_id) for unique tasks.
- **Severity + activity_type**: A task can be `task_reviewed_approved` yet still have `major` severity comments (approved despite issues).
- **Turn**: Integer for conversational tasks (turn 1, 2, etc.), NULL for non-conversational.
- **Reopens**: `issue_type = 'reopen'` indicates quality concerns that persisted across revisions.

### Common Patterns

**Comment Volume by Severity:**
```sql
SELECT project_name, severity,
  COUNT(*) AS comment_count,
  COUNT(DISTINCT task_id) AS tasks_with_comments,
  ROUND(COUNT(*) / NULLIF(COUNT(DISTINCT task_id), 0), 2) AS avg_comments_per_task
FROM `handshake-production.hai_dev.fact_comments`
GROUP BY project_name, severity
ORDER BY project_name,
  CASE severity WHEN 'major' THEN 1 WHEN 'minor' THEN 2 WHEN 'praise' THEN 3 END
```

**Block-Level Issue Analysis:**
```sql
SELECT project_name, block_label,
  COUNTIF(severity = 'major') AS major_issues,
  COUNTIF(severity = 'minor') AS minor_issues,
  COUNTIF(severity = 'praise') AS praises,
  ROUND(COUNTIF(severity = 'major') / COUNT(*) * 100, 2) AS major_issue_pct
FROM `handshake-production.hai_dev.fact_comments`
WHERE block_label IS NOT NULL
GROUP BY project_name, block_label
HAVING COUNT(*) >= 10
ORDER BY COUNT(*) DESC
```

---

## 7. fact_reviewer_perf

**Fully-qualified name:** `hs-ai-production.hai_dev.fact_reviewer_perf`
**Grain:** One row per reviewer per project (Review 1 reviewers only)
**Updates:** Hourly

### Columns — Identifiers

| Column | Type | Description |
|--------|------|-------------|
| profile_id | INTEGER | Primary Key (Part 1) |
| project_id | INTEGER | Primary Key (Part 2) |
| full_name | STRING | Reviewer's full name |
| email | STRING | Reviewer's email |
| secondary_email | STRING | Secondary email |
| project_name | STRING | Project name |
| role | STRING | Reviewer role |
| chosen_domain | STRING | Domain |
| chosen_subdomains | STRING | Subdomains |

### Columns — Activity

| Column | Type | Description |
|--------|------|-------------|
| latest_activity | TIMESTAMP | Most recent activity |
| days_since_latest_activity | INTEGER | Days since last activity |
| active | BOOLEAN | Activity within last 7 days |
| active_days | INTEGER | Number of active days |
| avg_hours_per_day | FLOAT | Average hours worked per active day |

### Columns — R1 Review Volume

| Column | Type | Description |
|--------|------|-------------|
| num_r1_reviews | INTEGER | Total R1 reviews performed |
| num_r1_approvals | INTEGER | R1 approvals issued |
| num_r1_rejections | INTEGER | R1 rejections issued |
| r1_approval_rate | DECIMAL | R1 approval rate (0.0–1.0) |
| num_r1_tasks_reviewed | INTEGER | Distinct tasks reviewed in R1 |

### Columns — R2 Outcomes (Most Important)

| Column | Type | Description |
|--------|------|-------------|
| num_r1_reviews_reviewed_in_r2 | INTEGER | R1 reviews that went to R2 |
| num_r1_reviews_approved_in_r2 | INTEGER | R1 reviews approved in R2 |
| num_r1_reviews_rejected_in_r2 | INTEGER | R1 reviews rejected in R2 |
| r2_approval_rate | DECIMAL | **Key metric** — % of R1 work that passes R2 (0.0–1.0) |

### Columns — Time

| Column | Type | Description |
|--------|------|-------------|
| total_hours_worked_capped | FLOAT | Hours (capped 1.5x limit) — **use this** |
| total_hours_worked_raw | FLOAT | Hours (uncapped) |
| total_payable_hours_worked | FLOAT | Hours (capped at time limit) |
| aht | FLOAT | Average handling time per review |
| payable_aht | FLOAT | Payable AHT |

### Columns — Quality (Issues Issued by Reviewer)

| Column | Type | Description |
|--------|------|-------------|
| avg_major_issues_issued_per_r1_review | FLOAT | Avg major issues reviewer gives per R1 review |
| avg_minor_issues_issued_per_r1_review | FLOAT | Avg minor issues per R1 review |
| avg_tic_issued_per_r1_review | FLOAT | TIC of issues reviewer gives per R1 review |
| avg_praises_issued_per_r1_review | FLOAT | Avg praises per R1 review |

### Columns — Quality (R2 Feedback on Reviewer's Work)

| Column | Type | Description |
|--------|------|-------------|
| avg_major_issues_r2_per_r1_review | FLOAT | Avg major issues R2 finds per R1 review |
| avg_minor_issues_r2_per_r1_review | FLOAT | Avg minor issues R2 finds per R1 review |
| avg_tic_issued_r2_per_r1_review | FLOAT | TIC from R2 per R1 review |
| avg_praises_r2_per_r1_review | FLOAT | Avg praises from R2 per R1 review |

### Key Joins
- `profile_id` → `fact_fellow_perf.profile_id`
- `project_id` → `fact_fellow_perf.project_id`
- `project_name` → shared across fact tables

### Common Patterns

**Top R1 Reviewers by Approval Rate:**
```sql
SELECT
  profile_id, full_name, email, project_name,
  num_r1_reviews, num_r1_approvals, num_r1_rejections,
  ROUND(r1_approval_rate * 100, 2) AS r1_approval_rate_pct,
  ROUND(r2_approval_rate * 100, 2) AS r2_approval_rate_pct
FROM `hs-ai-production.hai_dev.fact_reviewer_perf`
WHERE num_r1_reviews >= 10
ORDER BY r2_approval_rate DESC
LIMIT 20
```

**R2 Approval Rate by Project (Most Important Metric):**
```sql
SELECT
  project_name,
  COUNT(DISTINCT profile_id) AS reviewer_count,
  SUM(num_r1_reviews) AS total_r1_reviews,
  ROUND(AVG(r2_approval_rate) * 100, 2) AS avg_r2_approval_rate_pct
FROM `hs-ai-production.hai_dev.fact_reviewer_perf`
WHERE num_r1_reviews_reviewed_in_r2 > 0
GROUP BY project_name
ORDER BY avg_r2_approval_rate_pct DESC
```

**Strict vs Lenient Reviewers:**
```sql
SELECT
  profile_id, full_name, project_name,
  num_r1_reviews,
  ROUND(r1_approval_rate * 100, 2) AS r1_approval_rate_pct,
  ROUND(r2_approval_rate * 100, 2) AS r2_approval_rate_pct,
  ROUND(avg_tic_issued_per_r1_review, 2) AS avg_tic_issued,
  CASE
    WHEN r1_approval_rate < 0.5 AND r2_approval_rate > 0.8 THEN 'Too Strict'
    WHEN r1_approval_rate > 0.9 AND r2_approval_rate < 0.6 THEN 'Too Lenient'
    ELSE 'Calibrated'
  END AS calibration
FROM `hs-ai-production.hai_dev.fact_reviewer_perf`
WHERE num_r1_reviews >= 20
ORDER BY r2_approval_rate ASC
```

**Reviewer Productivity:**
```sql
SELECT
  profile_id, full_name, project_name,
  num_r1_reviews,
  active_days,
  ROUND(num_r1_reviews * 1.0 / NULLIF(active_days, 0), 2) AS reviews_per_day,
  ROUND(total_hours_worked_capped, 2) AS total_hours,
  ROUND(aht, 2) AS avg_handle_time
FROM `hs-ai-production.hai_dev.fact_reviewer_perf`
WHERE active = TRUE
ORDER BY reviews_per_day DESC
```

---

## 8. fact_block_values

**Fully-qualified name:** `hs-ai-production.hai_dev.fact_block_values`
**Grain:** One row per block value (latest revisions only, excludes archived/escalated)
**Updates:** Hourly
**Variant:** `hs-ai-production.hai_dev.fact_block_values_incl_prev_versions` includes all historical revisions

### Columns — Identifiers

| Column | Type | Description |
|--------|------|-------------|
| active_block_value_id | STRING | Primary Key |
| block_id | STRING | Block identifier |
| task_id | STRING | Task ID |
| task_revision_id | STRING | Task revision ID |
| block_value_id | STRING | Block value ID |
| project_id | INTEGER | Project ID |

### Columns — Block Metadata

| Column | Type | Description |
|--------|------|-------------|
| block_type | STRING | Block type (multi_response, questions_per_response, confirmation, rubric, text, etc.) |
| label | STRING | Block name / label |
| config | JSON | Block configuration |
| previous_block_id | STRING | Previous block in sequence |
| parent_block_id | STRING | Parent block (for nested blocks) |
| template_version_id | STRING | Template version |
| block_created_at | TIMESTAMP | Block creation timestamp |
| block_updated_at | TIMESTAMP | Block update timestamp |

### Columns — Normalized Values

| Column | Type | Description |
|--------|------|-------------|
| value_raw | STRING | Raw block value |
| normalized_block_value | STRING | Human-readable resolved value (handles option resolution) |
| finish_reason | STRING | Completion reason |
| reasoning | STRING | Reasoning text |

### Columns — Model Info

| Column | Type | Description |
|--------|------|-------------|
| model_id | STRING | Model identifier |
| model_name | STRING | Model name |
| model_provider | STRING | Model provider |
| model_title | STRING | Model display title |
| model_status | STRING | Model status |
| model_params | JSON | Model parameters |
| model_provider_settings | JSON | Provider-level settings |

### Columns — Prompt & Response

| Column | Type | Description |
|--------|------|-------------|
| prompt | STRING | Prompt text |
| system_prompt | STRING | System prompt |
| instructions | STRING | Block instructions |
| question_initial_answer | STRING | Initial answer for question blocks |
| question_options | STRING | Available options for question blocks |
| question_uuid | STRING | Question UUID |
| confirmation_option_index | INTEGER | Selected option index |
| model_response | STRING | Model response text |
| model_response_index | INTEGER | Response index in multi-response |
| question_index | INTEGER | Question index |

### Columns — Rubric Fields

| Column | Type | Description |
|--------|------|-------------|
| rubric_item_id | STRING | Rubric item ID |
| rubric_response_id | STRING | Rubric response ID |
| rubric_active_instructions | STRING | Active rubric instructions |
| rubric_item_order | INTEGER | Rubric item ordering |
| rubric_field_label | STRING | Rubric field label |
| rubric_limit_min | FLOAT | Rubric min limit |
| rubric_limit_max | FLOAT | Rubric max limit |
| rubric_field_type | STRING | Rubric field type |
| rubric_field_min | FLOAT | Rubric field min value |
| rubric_field_max | FLOAT | Rubric field max value |

### Columns — Task Metadata

| Column | Type | Description |
|--------|------|-------------|
| turn | INTEGER | Conversation turn (NULL for non-conversational) |
| index | INTEGER | Block index |
| completed | BOOLEAN | Whether block is completed |
| created_by | STRING | Creator profile ID |
| created_at | TIMESTAMP | Value creation timestamp |
| pipeline_stage_id_at_block_submission | INTEGER | Pipeline stage at time of submission |
| current_pipeline_stage_id | INTEGER | Current pipeline stage |
| current_pipeline_stage_name | STRING | Current pipeline stage name |
| multimodal | BOOLEAN | Whether task is multimodal |
| latest | BOOLEAN | Whether this is the latest revision |
| archived | BOOLEAN | Is archived |
| escalated | BOOLEAN | Is escalated |
| template_version | STRING | Template version |

### Key Joins
- `task_id` → `fact_tasks.task_id`
- `task_revision_id` → `fact_task_activity.task_revision_id`
- `project_id` → `fact_fellow_perf.project_id`
- `block_id` → `fact_comments.block_id`

### Common Patterns

**Standard Block Pivot (extract key responses per task):**
```sql
SELECT
  task_id,
  MAX(CASE WHEN label = 'Overall Quality' THEN normalized_block_value END) AS overall_quality,
  MAX(CASE WHEN label = 'Response Rating' THEN normalized_block_value END) AS response_rating,
  MAX(CASE WHEN label = 'Justification' THEN normalized_block_value END) AS justification
FROM `hs-ai-production.hai_dev.fact_block_values`
WHERE project_id = @project_id
GROUP BY task_id
```

**Multi-Turn Conversation Blocks:**
```sql
SELECT
  task_id, turn, label, normalized_block_value, model_name, model_response
FROM `hs-ai-production.hai_dev.fact_block_values`
WHERE turn IS NOT NULL
  AND project_id = @project_id
ORDER BY task_id, turn, index
```

**Questions-Per-Response Analysis:**
```sql
SELECT
  task_id, question_index, question_uuid,
  prompt AS question_text,
  normalized_block_value AS answer,
  question_options
FROM `hs-ai-production.hai_dev.fact_block_values`
WHERE block_type = 'questions_per_response'
  AND project_id = @project_id
ORDER BY task_id, question_index
```

**Rubric Score Distribution:**
```sql
SELECT
  rubric_field_label,
  normalized_block_value AS score,
  COUNT(*) AS count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (PARTITION BY rubric_field_label), 2) AS pct
FROM `hs-ai-production.hai_dev.fact_block_values`
WHERE block_type = 'rubric'
  AND project_id = @project_id
  AND rubric_field_label IS NOT NULL
GROUP BY rubric_field_label, normalized_block_value
ORDER BY rubric_field_label, count DESC
```

**Join Block Values with Comments:**
```sql
SELECT
  bv.task_id, bv.label, bv.normalized_block_value,
  c.severity, c.issue_label, c.message
FROM `hs-ai-production.hai_dev.fact_block_values` bv
INNER JOIN `handshake-production.hai_dev.fact_comments` c
  ON bv.task_id = c.task_id AND bv.block_id = c.block_id
WHERE bv.project_id = @project_id
ORDER BY bv.task_id, bv.label
```
