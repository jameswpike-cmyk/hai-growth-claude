# Fellow Engagement Score

Classifies each fellow into an engagement tier based on how far they progressed through the onboarding funnel after receiving a project allocation email.

**Source table:** `hs-ai-production.hai_dev.fact_project_funnel`
**Grain:** One row per `profile_id` + `project_id`

---

## Engagement Tiers

| Tier | Label | Criteria | Interpretation |
|------|-------|----------|----------------|
| No Engagement | `no_engagement` | Did NOT open allocation email (`pso_allocation_email_open_at_pst IS NULL`) | Never reached |
| Low Engagement | `low_engagement` | Opened email but took no further action | Saw it, ignored it |
| Medium Engagement | `medium_engagement` | Opened email AND did at least one of: viewed project page, loaded checklist, accepted invitation — but did NOT submit | Engaged but didn't finish |
| High Engagement | `high_engagement` | Submitted at least one task (`first_task_submitted_pst IS NOT NULL`) | Fully activated |

---

## Columns Used

These columns from `fact_project_funnel` drive the engagement score:

| Column | Type | Role in Score |
|--------|------|---------------|
| `pso_allocation_email_open_at_pst` | TIMESTAMP | Gate for no_engagement vs. everything else |
| `project_invitation_page_loaded_pst` | TIMESTAMP | Medium signal: viewed project page |
| `pso_checklist_initial_load_pst` | TIMESTAMP | Medium signal: loaded PSO checklist |
| `pso_invitation_accepted_pst` | TIMESTAMP | Medium signal: accepted invitation |
| `first_task_submitted_pst` | TIMESTAMP | High signal: submitted a task |

---

## Query Patterns

### Score fellows on a single project

```sql
WITH base AS (
  SELECT
    profile_id,
    pso_allocation_email_open_at_pst,
    project_invitation_page_loaded_pst,
    pso_checklist_initial_load_pst,
    pso_invitation_accepted_pst,
    first_task_submitted_pst
  FROM `hs-ai-production.hai_dev.fact_project_funnel`
  WHERE project_id = @project_id
)

SELECT
  profile_id,
  CASE
    WHEN pso_allocation_email_open_at_pst IS NULL
    THEN 'no_engagement'

    WHEN first_task_submitted_pst IS NOT NULL
    THEN 'high_engagement'

    WHEN project_invitation_page_loaded_pst IS NOT NULL
      OR pso_checklist_initial_load_pst IS NOT NULL
      OR pso_invitation_accepted_pst IS NOT NULL
    THEN 'medium_engagement'

    ELSE 'low_engagement'
  END AS engagement_bucket
FROM base
```

### Engagement distribution for a project

```sql
WITH base AS (
  SELECT
    profile_id,
    pso_allocation_email_open_at_pst,
    project_invitation_page_loaded_pst,
    pso_checklist_initial_load_pst,
    pso_invitation_accepted_pst,
    first_task_submitted_pst
  FROM `hs-ai-production.hai_dev.fact_project_funnel`
  WHERE project_id = @project_id
),

scored AS (
  SELECT
    profile_id,
    CASE
      WHEN pso_allocation_email_open_at_pst IS NULL THEN 'no_engagement'
      WHEN first_task_submitted_pst IS NOT NULL THEN 'high_engagement'
      WHEN project_invitation_page_loaded_pst IS NOT NULL
        OR pso_checklist_initial_load_pst IS NOT NULL
        OR pso_invitation_accepted_pst IS NOT NULL
      THEN 'medium_engagement'
      ELSE 'low_engagement'
    END AS engagement_bucket
  FROM base
)

SELECT
  engagement_bucket,
  COUNT(*) AS fellow_count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) AS pct
FROM scored
GROUP BY engagement_bucket
ORDER BY
  CASE engagement_bucket
    WHEN 'high_engagement' THEN 1
    WHEN 'medium_engagement' THEN 2
    WHEN 'low_engagement' THEN 3
    WHEN 'no_engagement' THEN 4
  END
```

### Cross-project engagement comparison

```sql
WITH scored AS (
  SELECT
    project_name,
    profile_id,
    CASE
      WHEN pso_allocation_email_open_at_pst IS NULL THEN 'no_engagement'
      WHEN first_task_submitted_pst IS NOT NULL THEN 'high_engagement'
      WHEN project_invitation_page_loaded_pst IS NOT NULL
        OR pso_checklist_initial_load_pst IS NOT NULL
        OR pso_invitation_accepted_pst IS NOT NULL
      THEN 'medium_engagement'
      ELSE 'low_engagement'
    END AS engagement_bucket
  FROM `hs-ai-production.hai_dev.fact_project_funnel`
)

SELECT
  project_name,
  COUNT(*) AS total_fellows,
  COUNTIF(engagement_bucket = 'high_engagement') AS high,
  COUNTIF(engagement_bucket = 'medium_engagement') AS medium,
  COUNTIF(engagement_bucket = 'low_engagement') AS low,
  COUNTIF(engagement_bucket = 'no_engagement') AS none,
  ROUND(COUNTIF(engagement_bucket = 'high_engagement') * 100.0 / COUNT(*), 1) AS high_pct
FROM scored
GROUP BY project_name
ORDER BY high_pct DESC
```

### Engagement with fellow details

```sql
WITH scored AS (
  SELECT
    f.profile_id,
    f.project_name,
    CASE
      WHEN f.pso_allocation_email_open_at_pst IS NULL THEN 'no_engagement'
      WHEN f.first_task_submitted_pst IS NOT NULL THEN 'high_engagement'
      WHEN f.project_invitation_page_loaded_pst IS NOT NULL
        OR f.pso_checklist_initial_load_pst IS NOT NULL
        OR f.pso_invitation_accepted_pst IS NOT NULL
      THEN 'medium_engagement'
      ELSE 'low_engagement'
    END AS engagement_bucket,
    f.pso_allocation_email_open_at_pst,
    f.project_invitation_page_loaded_pst,
    f.pso_checklist_initial_load_pst,
    f.pso_invitation_accepted_pst,
    f.first_task_submitted_pst
  FROM `hs-ai-production.hai_dev.fact_project_funnel` f
  WHERE f.project_id = @project_id
)

SELECT
  s.profile_id,
  p.email,
  p.first_name,
  p.last_name,
  s.engagement_bucket,
  s.pso_allocation_email_open_at_pst,
  s.project_invitation_page_loaded_pst,
  s.pso_checklist_initial_load_pst,
  s.pso_invitation_accepted_pst,
  s.first_task_submitted_pst
FROM scored s
LEFT JOIN `hs-ai-production.hai_dev.hai_profiles_dim` p
  ON s.profile_id = CAST(p.profile_id AS INT64)
ORDER BY
  CASE s.engagement_bucket
    WHEN 'high_engagement' THEN 1
    WHEN 'medium_engagement' THEN 2
    WHEN 'low_engagement' THEN 3
    WHEN 'no_engagement' THEN 4
  END,
  s.profile_id
```
