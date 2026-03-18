# Query Patterns

**These are proven SQL examples from real queries. Do NOT write SQL from scratch — find the closest pattern below and adapt it.** If your use case isn't covered here, check the schema in `fact-tables.md` or `dimension-tables.md` and model your query after the patterns here.

## Table of Contents
- Approval Rates by Project
- Active Fellow Counts
- Funnel Analysis & Drop-Off
- Fellow Search by Education / Domain / Skills
- Show Resume / Resume URL Lookup
- Resume Keyword Search
- Resume Demographics via short_parsed_data
- Geography & Project Assignment Queries
- Resume Experience & Project Extraction
- Olympiad / Competition Search in Resumes
- Task Lifecycle Analysis
- Comment / Quality Analysis
- Cross-Table Joins
- Reviewer Performance (R1/R2)
- Block Values Analysis
- Otter Approval Rates
- Otter Campaign Health
- Otter Cross-Table Joins

---

## Approval Rates by Project

```sql
-- From fact_task_activity (computed from events)
SELECT
  project_name,
  COUNT(DISTINCT CASE WHEN activity_type = 'task_reviewed_approved' THEN id END) AS approvals,
  COUNT(DISTINCT CASE WHEN activity_type = 'task_reviewed_rejected' THEN id END) AS rejections,
  COUNT(DISTINCT CASE WHEN activity_type IN ('task_reviewed_approved', 'task_reviewed_rejected') THEN id END) AS total_reviews,
  ROUND(
    COUNT(DISTINCT CASE WHEN activity_type = 'task_reviewed_approved' THEN id END) * 100.0 /
    NULLIF(COUNT(DISTINCT CASE WHEN activity_type IN ('task_reviewed_approved', 'task_reviewed_rejected') THEN id END), 0),
  2) AS approval_rate_pct
FROM `hs-ai-production.hai_dev.fact_task_activity`
GROUP BY project_name
ORDER BY approval_rate_pct DESC
```

```sql
-- From fact_fellow_perf (pre-computed, per fellow per project)
SELECT
  project_name,
  COUNT(DISTINCT profile_id) AS fellow_count,
  SUM(approvals) AS total_approvals,
  SUM(rejections) AS total_rejections,
  ROUND(AVG(approval_rate) * 100, 2) AS avg_approval_rate_pct
FROM `hs-ai-production.hai_dev.fact_fellow_perf`
WHERE total_reviews > 0
GROUP BY project_name
ORDER BY avg_approval_rate_pct DESC
```

---

## Active Fellow Counts

```sql
-- Count active fellows on a specific project
SELECT COUNT(DISTINCT profile_id) AS active_fellow_count
FROM `hs-ai-production.hai_dev.fact_fellow_perf`
WHERE project_name = 'Project Dior'
  AND active = TRUE
```

```sql
-- Active vs inactive breakdown by project
SELECT
  project_name,
  COUNT(DISTINCT profile_id) AS total_fellows,
  COUNTIF(active = TRUE) AS active_fellows,
  COUNTIF(active = FALSE) AS inactive_fellows,
  ROUND(COUNTIF(active = TRUE) * 100.0 / COUNT(DISTINCT profile_id), 1) AS active_pct
FROM `hs-ai-production.hai_dev.fact_fellow_perf`
GROUP BY project_name
ORDER BY active_fellows DESC
```

---

## Funnel Analysis & Drop-Off

```sql
-- Full onboarding funnel with drop-off rates
SELECT
  project_name,
  COUNT(DISTINCT profile_id) AS allocated,
  COUNT(DISTINCT CASE WHEN pso_completed_pst IS NOT NULL THEN profile_id END) AS pso_completed,
  COUNT(DISTINCT CASE WHEN canvas_finished_at IS NOT NULL THEN profile_id END) AS canvas_completed,
  COUNT(DISTINCT CASE WHEN contract_finished_at_pst IS NOT NULL THEN profile_id END) AS contract_signed,
  COUNT(DISTINCT CASE WHEN first_claimed_at_pst IS NOT NULL THEN profile_id END) AS first_claim,
  COUNT(DISTINCT CASE WHEN first_task_submitted_pst IS NOT NULL THEN profile_id END) AS first_submit,
  COUNT(DISTINCT CASE WHEN first_task_approved_pst IS NOT NULL THEN profile_id END) AS first_approval,

  -- Drop-off rates
  ROUND(100 - COUNT(DISTINCT CASE WHEN pso_completed_pst IS NOT NULL THEN profile_id END) * 100.0 /
    NULLIF(COUNT(DISTINCT profile_id), 0), 1) AS pso_dropoff_pct,
  ROUND(100 - COUNT(DISTINCT CASE WHEN first_claimed_at_pst IS NOT NULL THEN profile_id END) * 100.0 /
    NULLIF(COUNT(DISTINCT CASE WHEN canvas_finished_at IS NOT NULL THEN profile_id END), 0), 1) AS claim_dropoff_pct

FROM `hs-ai-production.hai_dev.fact_project_funnel`
GROUP BY project_name
ORDER BY allocated DESC
```

```sql
-- Time between funnel stages
SELECT
  project_name,
  ROUND(AVG(DATETIME_DIFF(canvas_enrolled_at, pso_allocated_pst, HOUR)), 1) AS hours_pso_to_canvas,
  ROUND(AVG(DATETIME_DIFF(first_claimed_at_pst, pso_completed_pst, HOUR)), 1) AS hours_pso_to_first_claim,
  ROUND(AVG(DATETIME_DIFF(first_task_approved_pst, first_task_submitted_pst, HOUR)), 1) AS hours_submit_to_approval
FROM `hs-ai-production.hai_dev.fact_project_funnel`
WHERE pso_allocated_week >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
GROUP BY project_name
```

---

## Fellow Search by Education / Domain / Skills

```sql
-- Search hai_profiles_dim for PhDs from top institutions
SELECT
  p.profile_id, p.email, p.first_name, p.last_name,
  p.highest_education_level,
  COALESCE(p.graduate_institution_name, p.undergraduate_institution_name) AS school_name,
  p.major, p.major_group,
  p.domain, p.subdomain,
  p.status, p.current_onboarding_stage
FROM `hs-ai-production.hai_dev.hai_profiles_dim` p
WHERE p.highest_education_level = 'Doctorate'
  AND p.graduate_institution_name IN (
    'MIT', 'Harvard University', 'Stanford University',
    'Princeton University', 'UC Berkeley', 'Caltech',
    'Columbia University', 'University of Chicago',
    'Yale University', 'Cornell University'
  )
  AND NOT LOWER(p.email) LIKE '%@joinhandshake.com%'
ORDER BY p.graduate_institution_name, p.last_name
```

```sql
-- Find fellows by domain with performance data
SELECT
  fp.profile_id, fp.full_name, fp.majors,
  fp.current_education_level, fp.current_school_name,
  fperf.project_name, fperf.total_hours_worked_capped,
  ROUND(fperf.approval_rate * 100, 2) AS approval_rate_pct,
  fp.current_cumulative_gpa / 100.0 AS gpa
FROM `handshake-production.hai_dev.fact_fellow_profile` fp
INNER JOIN `hs-ai-production.hai_dev.fact_fellow_perf` fperf
  ON fp.profile_id = fperf.profile_id
WHERE fp.profile_status = 'active'
  AND fperf.total_hours_worked_capped > 0
ORDER BY fperf.approval_rate DESC, fperf.total_hours_worked_capped DESC
```

```sql
-- Skills inventory (UNNEST comma-separated)
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

---

## Show Resume / Resume URL Lookup

```sql
-- Look up a fellow's resume URL by email
SELECT
  profile_id, email, first_name, last_name,
  resume_url_in_product
FROM `hs-ai-production.hai_dev.hai_profiles_dim`
WHERE LOWER(email) = LOWER(@email)
  AND resume_url_in_product IS NOT NULL
```

```sql
-- Look up a fellow's resume URL by profile_id
SELECT
  profile_id, email, first_name, last_name,
  resume_url_in_product
FROM `hs-ai-production.hai_dev.hai_profiles_dim`
WHERE profile_id = @profile_id
  AND resume_url_in_product IS NOT NULL
```

```sql
-- Look up a fellow's resume URL by name
SELECT
  profile_id, email, first_name, last_name,
  resume_url_in_product
FROM `hs-ai-production.hai_dev.hai_profiles_dim`
WHERE LOWER(first_name) = LOWER(@first_name)
  AND LOWER(last_name) = LOWER(@last_name)
  AND resume_url_in_product IS NOT NULL
  AND NOT LOWER(email) LIKE '%@joinhandshake.com%'
```

> **Note:** `resume_url_in_product` is the direct link to view the fellow's resume in the product. If the URL is NULL, the fellow has not uploaded a resume. There is also `resume_url_typescript` as an alternative URL variant.

---

## Resume Keyword Search

```sql
-- Search parsed resume JSON for keywords
SELECT
  p.profile_id, p.email, p.first_name, p.last_name,
  p.highest_education_level,
  p.graduate_institution_name,
  p.domain, p.subdomain,
  r.id AS resume_id
FROM `hs-ai-production.hai_dev.hai_profiles_dim` p
JOIN `hs-ai-production.hai_public.resumes` r
  ON p.profile_id = r.profileId
WHERE r.status = 'PROCESSED'
  AND LOWER(TO_JSON_STRING(r.parsed_data)) LIKE '%machine learning%'
  AND NOT LOWER(p.email) LIKE '%@joinhandshake.com%'
ORDER BY p.last_name
```

```sql
-- Multi-keyword tiered confidence scoring
WITH matches AS (
  SELECT
    p.profile_id, p.email, p.first_name, p.last_name,
    p.domain, p.subdomain,
    r.id AS resume_id,
    TO_JSON_STRING(r.parsed_data) AS parsed_resume,

    -- Tier 1: High confidence
    CASE WHEN LOWER(TO_JSON_STRING(r.parsed_data)) LIKE '%specific_term_1%'
              OR LOWER(TO_JSON_STRING(r.parsed_data)) LIKE '%specific_term_2%'
         THEN 1 ELSE 0 END AS tier1_match,

    -- Tier 2: Medium confidence
    CASE WHEN LOWER(TO_JSON_STRING(r.parsed_data)) LIKE '%broader_term%'
         THEN 1 ELSE 0 END AS tier2_match

  FROM `hs-ai-production.hai_dev.hai_profiles_dim` p
  JOIN `hs-ai-production.hai_public.resumes` r ON p.profile_id = r.profileId
  WHERE r.status = 'PROCESSED'
    AND NOT LOWER(p.email) LIKE '%@joinhandshake.com%'
)
SELECT *,
  tier1_match * 3 + tier2_match AS confidence_score
FROM matches
WHERE tier1_match > 0 OR tier2_match > 0
ORDER BY confidence_score DESC
```

```sql
-- Extract education from parsed resume JSON
SELECT
  r.profileId AS profile_id,
  JSON_EXTRACT_SCALAR(r.parsed_data, '$.education[0].school') AS school,
  JSON_EXTRACT_SCALAR(r.parsed_data, '$.education[0].degree') AS degree,
  JSON_EXTRACT_SCALAR(r.parsed_data, '$.education[0].fieldOfStudy') AS field_of_study,
  JSON_EXTRACT_SCALAR(r.parsed_data, '$.education[0].graduation_date') AS grad_date
FROM `hs-ai-production.hai_public.resumes` r
WHERE r.status = 'PROCESSED'
  AND r.parsed_data IS NOT NULL
```

---

## Resume Demographics via short_parsed_data

```sql
-- Filter resumes by suggested domain
SELECT
  r.profileId AS profile_id,
  JSON_EXTRACT_SCALAR(r.short_parsed_data, '$.fullName') AS full_name,
  JSON_EXTRACT_SCALAR(r.short_parsed_data, '$.suggestedDomain') AS domain,
  JSON_EXTRACT(r.short_parsed_data, '$.suggestedSubdomains') AS subdomains,
  JSON_EXTRACT_SCALAR(r.short_parsed_data, '$.highestEducationLevel') AS education_level,
  JSON_EXTRACT_SCALAR(r.short_parsed_data, '$.mostRecentInstitution') AS institution
FROM `hs-ai-production.hai_public.resumes` r
WHERE r.short_parsed_data IS NOT NULL
  AND JSON_EXTRACT_SCALAR(r.short_parsed_data, '$.suggestedDomain') = 'STEM'
```

```sql
-- Find fellows with teaching experience
SELECT
  r.profileId AS profile_id,
  JSON_EXTRACT_SCALAR(r.short_parsed_data, '$.fullName') AS full_name,
  JSON_EXTRACT_SCALAR(r.short_parsed_data, '$.suggestedDomain') AS domain,
  JSON_EXTRACT_SCALAR(r.short_parsed_data, '$.mostRecentInstitution') AS institution,
  JSON_EXTRACT(r.short_parsed_data, '$.spokenLanguages') AS languages
FROM `hs-ai-production.hai_public.resumes` r
WHERE r.short_parsed_data IS NOT NULL
  AND JSON_EXTRACT_SCALAR(r.short_parsed_data, '$.hasTeachingExperience') = 'true'
```

```sql
-- Extract languages with proficiency from parsed_data
SELECT
  r.profileId AS profile_id,
  JSON_EXTRACT_SCALAR(r.parsed_data, '$.languages[0].language') AS language_1,
  JSON_EXTRACT_SCALAR(r.parsed_data, '$.languages[0].proficiency') AS proficiency_1,
  JSON_EXTRACT_SCALAR(r.parsed_data, '$.languages[1].language') AS language_2,
  JSON_EXTRACT_SCALAR(r.parsed_data, '$.languages[1].proficiency') AS proficiency_2
FROM `hs-ai-production.hai_public.resumes` r
WHERE r.status = 'PROCESSED'
  AND r.parsed_data IS NOT NULL
  AND JSON_EXTRACT(r.parsed_data, '$.languages') IS NOT NULL
```

---

## Geography & Project Assignment Queries

```sql
-- Fellows by geography with project assignment
SELECT
  p.profile_id, p.email, p.first_name, p.last_name,
  p.state_code, p.country_code,
  p.active_project_name, p.completed_tasks,
  p.domain, p.subdomain
FROM `hs-ai-production.hai_dev.hai_profiles_dim` p
WHERE p.country_code = 'US'
  AND p.state_code IS NOT NULL
  AND LOWER(p.status) = 'verified'
  AND NOT LOWER(p.email) LIKE '%@joinhandshake.com%'
ORDER BY p.state_code, p.completed_tasks DESC
```

```sql
-- Work-authorized fellows with resumes
SELECT
  p.profile_id, p.email, p.first_name, p.last_name,
  p.authorized_to_work_us, p.state_code, p.country_code,
  p.domain, p.subdomain,
  r.id AS resume_id,
  JSON_EXTRACT_SCALAR(r.short_parsed_data, '$.suggestedDomain') AS suggested_domain
FROM `hs-ai-production.hai_dev.hai_profiles_dim` p
JOIN `hs-ai-production.hai_public.resumes` r ON p.profile_id = r.profileId
WHERE LOWER(p.authorized_to_work_us) = 'true'
  AND r.status = 'PROCESSED'
  AND NOT LOWER(p.email) LIKE '%@joinhandshake.com%'
```

---

## Resume Experience & Project Extraction

```sql
-- Extract most recent work experience per resume
SELECT
  r.profileId AS profile_id,
  JSON_EXTRACT_SCALAR(r.parsed_data, '$.experience[0].company') AS company,
  JSON_EXTRACT_SCALAR(r.parsed_data, '$.experience[0].position') AS position,
  JSON_EXTRACT_SCALAR(r.parsed_data, '$.experience[0].description') AS description,
  JSON_EXTRACT_SCALAR(r.parsed_data, '$.experience[0].start_date') AS start_date,
  JSON_EXTRACT_SCALAR(r.parsed_data, '$.experience[0].end_date') AS end_date
FROM `hs-ai-production.hai_public.resumes` r
WHERE r.status = 'PROCESSED'
  AND r.parsed_data IS NOT NULL
  AND JSON_EXTRACT_SCALAR(r.parsed_data, '$.experience[0].position') IS NOT NULL
```

```sql
-- Search for fellows with specific company experience
SELECT
  p.profile_id, p.email, p.first_name, p.last_name,
  p.domain, p.subdomain,
  JSON_EXTRACT_SCALAR(r.parsed_data, '$.experience[0].company') AS company_1,
  JSON_EXTRACT_SCALAR(r.parsed_data, '$.experience[0].position') AS position_1,
  JSON_EXTRACT_SCALAR(r.parsed_data, '$.experience[1].company') AS company_2,
  JSON_EXTRACT_SCALAR(r.parsed_data, '$.experience[1].position') AS position_2
FROM `hs-ai-production.hai_dev.hai_profiles_dim` p
JOIN `hs-ai-production.hai_public.resumes` r ON p.profile_id = r.profileId
WHERE r.status = 'PROCESSED'
  AND LOWER(TO_JSON_STRING(JSON_EXTRACT(r.parsed_data, '$.experience'))) LIKE '%google%'
  AND NOT LOWER(p.email) LIKE '%@joinhandshake.com%'
```

```sql
-- Fellows with technical projects (only ~28% of resumes have projects)
SELECT
  r.profileId AS profile_id,
  JSON_EXTRACT_SCALAR(r.parsed_data, '$.projects[0].name') AS project_name,
  JSON_EXTRACT_SCALAR(r.parsed_data, '$.projects[0].description') AS project_desc,
  JSON_EXTRACT(r.parsed_data, '$.projects[0].technologies') AS technologies
FROM `hs-ai-production.hai_public.resumes` r
WHERE r.status = 'PROCESSED'
  AND r.parsed_data IS NOT NULL
  AND JSON_EXTRACT_SCALAR(r.parsed_data, '$.projects[0].name') IS NOT NULL
```

---

## Olympiad / Competition Search in Resumes

```sql
-- Find math olympiad participants from parsed resumes
WITH olympiad_matches AS (
  SELECT
    u.profile_id, u.email, u.first_name, u.last_name,
    u.status, u.domain, u.subdomain,
    u.highest_education_level, u.graduate_institution_name,
    r.id AS resume_id,
    CASE
      WHEN LOWER(TO_JSON_STRING(r.parsed_data)) LIKE '%international mathematical olympiad%' THEN 'IMO'
      WHEN LOWER(TO_JSON_STRING(r.parsed_data)) LIKE '%usamo%' THEN 'USAMO'
      WHEN LOWER(TO_JSON_STRING(r.parsed_data)) LIKE '%aime%'
           AND LOWER(TO_JSON_STRING(r.parsed_data)) LIKE '%american invitational%' THEN 'AIME'
      WHEN LOWER(TO_JSON_STRING(r.parsed_data)) LIKE '%putnam%'
           AND LOWER(TO_JSON_STRING(r.parsed_data)) LIKE '%competition%' THEN 'Putnam'
    END AS olympiad_match,
    CASE
      WHEN LOWER(TO_JSON_STRING(r.parsed_data)) LIKE '%gold medal%' THEN 'Gold'
      WHEN LOWER(TO_JSON_STRING(r.parsed_data)) LIKE '%silver medal%' THEN 'Silver'
      WHEN LOWER(TO_JSON_STRING(r.parsed_data)) LIKE '%bronze medal%' THEN 'Bronze'
    END AS medal_type
  FROM `hs-ai-production.hai_dev.hai_user_growth_dim` u
  LEFT JOIN `hs-ai-production.hai_public.resumes` r ON u.profile_id = r.profileId
  WHERE r.status = 'PROCESSED'
    AND (
      LOWER(TO_JSON_STRING(r.parsed_data)) LIKE '%olympiad%'
      OR LOWER(TO_JSON_STRING(r.parsed_data)) LIKE '%usamo%'
      OR LOWER(TO_JSON_STRING(r.parsed_data)) LIKE '%putnam%'
    )
    AND NOT LOWER(u.email) LIKE '%@joinhandshake.com%'
)
SELECT * FROM olympiad_matches
WHERE olympiad_match IS NOT NULL
ORDER BY
  CASE WHEN medal_type IS NOT NULL THEN 1 ELSE 2 END,
  CASE medal_type WHEN 'Gold' THEN 1 WHEN 'Silver' THEN 2 WHEN 'Bronze' THEN 3 ELSE 4 END
```

---

## Task Lifecycle Analysis

```sql
-- Task turnaround times
SELECT
  project_name,
  COUNT(*) AS total_tasks,
  ROUND(AVG(TIMESTAMP_DIFF(first_submitted_at, task_created_at, HOUR)), 1) AS avg_hours_to_submit,
  ROUND(AVG(TIMESTAMP_DIFF(first_reviewed_at, first_submitted_at, HOUR)), 1) AS avg_hours_to_review,
  ROUND(AVG(total_time_worked_in_hours_capped), 2) AS avg_hours_per_task,
  AVG(revisions) AS avg_revisions,
  AVG(touches) AS avg_touches
FROM `hs-ai-production.hai_dev.fact_tasks`
WHERE first_submitted_at IS NOT NULL
GROUP BY project_name
ORDER BY total_tasks DESC
```

```sql
-- Escalated tasks with notes
SELECT
  task_id, project_name, fellow_email, reviewer_email,
  status, pipeline_stage_name,
  escalation_notes,
  major_issues, minor_issues,
  total_time_worked_in_hours_capped AS hours_worked
FROM `hs-ai-production.hai_dev.fact_tasks`
WHERE escalated = TRUE
ORDER BY major_issues DESC
```

```sql
-- Tasks by pipeline stage
SELECT
  project_name, pipeline_stage_name,
  COUNT(*) AS task_count,
  SUM(total_payable_time_worked_in_hours) AS total_payable_hours,
  AVG(major_issues) AS avg_major_issues
FROM `hs-ai-production.hai_dev.fact_tasks`
GROUP BY project_name, pipeline_stage_name
ORDER BY project_name, task_count DESC
```

---

## Comment / Quality Analysis

```sql
-- Most common issue labels by project
SELECT
  project_name, issue_label, severity,
  COUNT(*) AS occurrences,
  COUNT(DISTINCT task_id) AS tasks_affected,
  ROUND(AVG(CHAR_LENGTH(message)), 0) AS avg_message_length
FROM `handshake-production.hai_dev.fact_comments`
WHERE issue_label IS NOT NULL
GROUP BY project_name, issue_label, severity
ORDER BY occurrences DESC
LIMIT 50
```

```sql
-- Reviewer comment patterns (find strict/lenient reviewers)
SELECT
  profile_id, project_name,
  COUNT(DISTINCT task_id) AS tasks_reviewed,
  ROUND(COUNT(*) * 1.0 / NULLIF(COUNT(DISTINCT task_id), 0), 2) AS avg_comments_per_task,
  COUNTIF(severity = 'major') AS major_count,
  COUNTIF(severity = 'minor') AS minor_count,
  COUNTIF(severity = 'praise') AS praise_count,
  ROUND(COUNTIF(severity = 'major') * 100.0 / NULLIF(COUNT(*), 0), 2) AS major_pct
FROM `handshake-production.hai_dev.fact_comments`
GROUP BY profile_id, project_name
HAVING COUNT(DISTINCT task_id) >= 10
ORDER BY avg_comments_per_task DESC
```

```sql
-- Comment trends over time
SELECT
  project_name,
  DATE_TRUNC(activity_created_at, WEEK) AS week,
  COUNT(*) AS comments,
  COUNTIF(severity = 'major') AS major_issues,
  COUNTIF(severity = 'praise') AS praises,
  ROUND(COUNTIF(severity = 'major') * 100.0 / COUNT(*), 2) AS major_pct,
  COUNT(DISTINCT task_id) AS tasks,
  COUNT(DISTINCT profile_id) AS reviewers
FROM `handshake-production.hai_dev.fact_comments`
WHERE activity_created_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY)
GROUP BY project_name, week
ORDER BY project_name, week
```

```sql
-- Reopen analysis (quality concerns that persist)
SELECT
  project_name, task_id,
  COUNT(*) AS reopen_comments,
  COUNT(DISTINCT block_id) AS blocks_reopened,
  STRING_AGG(DISTINCT issue_label, ', ' ORDER BY issue_label) AS reopen_reasons,
  COUNT(DISTINCT profile_id) AS reviewers_involved
FROM `handshake-production.hai_dev.fact_comments`
WHERE issue_type = 'reopen'
GROUP BY project_name, task_id
ORDER BY reopen_comments DESC
LIMIT 50
```

---

## Cross-Table Joins

### profiles_dim → resumes
```sql
-- Join key: hai_profiles_dim.profile_id = resumes.profileId (camelCase!)
SELECT
  p.profile_id, p.email, p.first_name, p.last_name,
  p.highest_education_level, p.domain, p.subdomain,
  r.id AS resume_id,
  TO_JSON_STRING(r.parsed_data) AS parsed_resume
FROM `hs-ai-production.hai_dev.hai_profiles_dim` p
LEFT JOIN `hs-ai-production.hai_public.resumes` r
  ON p.profile_id = r.profileId
WHERE r.status = 'PROCESSED'
```

### fact_fellow_perf → fact_tasks
```sql
-- Join on fellow_id / profile_id + project_id
SELECT
  fp.profile_id, fp.full_name, fp.project_name,
  fp.approval_rate, fp.tasks_completed,
  COUNT(ft.task_id) AS task_count,
  COUNTIF(ft.escalated = TRUE) AS escalated_tasks,
  SUM(ft.major_issues) AS total_major_issues
FROM `hs-ai-production.hai_dev.fact_fellow_perf` fp
LEFT JOIN `hs-ai-production.hai_dev.fact_tasks` ft
  ON fp.profile_id = ft.fellow_id AND fp.project_id = ft.project_id
GROUP BY 1, 2, 3, 4, 5
```

### fact_fellow_profile → fact_fellow_perf
```sql
-- Join on profile_id for profile + performance
SELECT
  fp.profile_id, fp.full_name, fp.majors,
  fp.current_education_level, fp.current_school_name,
  fp.current_cumulative_gpa / 100.0 AS gpa,
  fperf.project_name,
  ROUND(fperf.approval_rate * 100, 2) AS approval_rate_pct,
  fperf.total_hours_worked_capped AS hours,
  fperf.tasks_completed
FROM `handshake-production.hai_dev.fact_fellow_profile` fp
INNER JOIN `hs-ai-production.hai_dev.fact_fellow_perf` fperf
  ON fp.profile_id = fperf.profile_id
WHERE fp.profile_status = 'active'
  AND fperf.total_reviews >= 5
ORDER BY fperf.approval_rate DESC
```

### tasks → profiles (public tables)
```sql
-- Join raw task data with profile info
SELECT
  t.id AS task_id, t.status, t.priority,
  t.archived, t.escalated, t.pipeline_stage_id,
  t.created_at,
  p.full_name AS assignee_name,
  p.email AS assignee_email,
  SUBSTR(CAST(t.data AS STRING), 1, 100) AS data_preview
FROM `hs-ai-production.hai_public.tasks` t
LEFT JOIN `hs-ai-production.hai_public.profiles` p
  ON t.profile_id = p.id
WHERE t.annotation_project_id = @project_id
ORDER BY t.created_at DESC
```

### Verified onboarded fellows with resumes (multi-filter)
```sql
-- Typical sourcing query pattern
SELECT
  p.profile_id, p.email, p.first_name, p.last_name,
  p.applied_at, p.highest_education_level,
  p.graduate_institution_name, p.undergraduate_institution_name,
  p.domain, p.subdomain, p.major,
  p.status, p.current_onboarding_stage,
  r.id AS resume_id,
  LENGTH(TO_JSON_STRING(r.parsed_data)) AS resume_character_count
FROM `hs-ai-production.hai_dev.hai_profiles_dim` p
JOIN `hs-ai-production.hai_public.resumes` r ON p.profile_id = r.profileId
WHERE LENGTH(TO_JSON_STRING(r.parsed_data)) > 200
  AND r.status = 'PROCESSED'
  AND r.parsed_data IS NOT NULL
  AND LOWER(p.status) = 'verified'
  AND LOWER(p.current_onboarding_stage) = 'fully-onboarded'
  AND NOT LOWER(p.email) LIKE '%@joinhandshake.com%'
ORDER BY p.applied_at DESC
```

---

## Reviewer Performance (R1/R2)

```sql
-- Top R1 reviewers by R2 approval rate (the most important reviewer metric)
SELECT
  profile_id, full_name, email, project_name,
  num_r1_reviews,
  ROUND(r1_approval_rate * 100, 2) AS r1_approval_rate_pct,
  ROUND(r2_approval_rate * 100, 2) AS r2_approval_rate_pct,
  ROUND(avg_tic_issued_per_r1_review, 2) AS avg_tic_issued
FROM `hs-ai-production.hai_dev.fact_reviewer_perf`
WHERE num_r1_reviews >= 20
ORDER BY r2_approval_rate DESC
LIMIT 20
```

```sql
-- R2 approval rate by project (aggregate reviewer quality)
SELECT
  project_name,
  COUNT(DISTINCT profile_id) AS reviewer_count,
  SUM(num_r1_reviews) AS total_r1_reviews,
  SUM(num_r1_reviews_reviewed_in_r2) AS total_sent_to_r2,
  ROUND(
    SUM(num_r1_reviews_approved_in_r2) * 100.0 /
    NULLIF(SUM(num_r1_reviews_reviewed_in_r2), 0),
  2) AS r2_approval_rate_pct
FROM `hs-ai-production.hai_dev.fact_reviewer_perf`
WHERE num_r1_reviews_reviewed_in_r2 > 0
GROUP BY project_name
ORDER BY r2_approval_rate_pct DESC
```

```sql
-- Strict vs lenient reviewers (R1 approval rate vs R2 outcome)
SELECT
  profile_id, full_name, project_name,
  num_r1_reviews,
  ROUND(r1_approval_rate * 100, 2) AS r1_approval_rate_pct,
  ROUND(r2_approval_rate * 100, 2) AS r2_approval_rate_pct,
  CASE
    WHEN r1_approval_rate < 0.5 AND r2_approval_rate > 0.8 THEN 'Too Strict'
    WHEN r1_approval_rate > 0.9 AND r2_approval_rate < 0.6 THEN 'Too Lenient'
    ELSE 'Calibrated'
  END AS calibration
FROM `hs-ai-production.hai_dev.fact_reviewer_perf`
WHERE num_r1_reviews >= 20
ORDER BY
  CASE
    WHEN r1_approval_rate > 0.9 AND r2_approval_rate < 0.6 THEN 1
    WHEN r1_approval_rate < 0.5 AND r2_approval_rate > 0.8 THEN 2
    ELSE 3
  END
```

```sql
-- R1 → R2 drift: reviewers whose R2 rejection rate is rising
SELECT
  profile_id, full_name, project_name,
  num_r1_reviews,
  num_r1_reviews_reviewed_in_r2,
  num_r1_reviews_rejected_in_r2,
  ROUND(r2_approval_rate * 100, 2) AS r2_approval_rate_pct,
  ROUND(avg_major_issues_r2_per_r1_review, 2) AS avg_r2_majors,
  ROUND(avg_tic_issued_r2_per_r1_review, 2) AS avg_r2_tic
FROM `hs-ai-production.hai_dev.fact_reviewer_perf`
WHERE r2_approval_rate < 0.7
  AND num_r1_reviews_reviewed_in_r2 >= 10
ORDER BY r2_approval_rate ASC
```

---

## Block Values Analysis

```sql
-- Standard block pivot: extract key responses per task
SELECT
  task_id,
  MAX(CASE WHEN label = 'Overall Quality' THEN normalized_block_value END) AS overall_quality,
  MAX(CASE WHEN label = 'Response Rating' THEN normalized_block_value END) AS response_rating,
  MAX(CASE WHEN label = 'Justification' THEN normalized_block_value END) AS justification
FROM `hs-ai-production.hai_dev.fact_block_values`
WHERE project_id = @project_id
GROUP BY task_id
```

```sql
-- Multi-turn conversation analysis
SELECT
  task_id, turn, label, normalized_block_value,
  model_name, model_response
FROM `hs-ai-production.hai_dev.fact_block_values`
WHERE turn IS NOT NULL
  AND project_id = @project_id
ORDER BY task_id, turn, index
```

```sql
-- Questions-per-response analysis
SELECT
  task_id, question_index,
  prompt AS question_text,
  normalized_block_value AS answer,
  question_options
FROM `hs-ai-production.hai_dev.fact_block_values`
WHERE block_type = 'questions_per_response'
  AND project_id = @project_id
ORDER BY task_id, question_index
```

```sql
-- Rubric score distribution
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

```sql
-- Block values joined with comments (issue context per block)
SELECT
  bv.task_id, bv.label, bv.normalized_block_value,
  c.severity, c.issue_label, c.message
FROM `hs-ai-production.hai_dev.fact_block_values` bv
INNER JOIN `handshake-production.hai_dev.fact_comments` c
  ON bv.task_id = c.task_id AND bv.block_id = c.block_id
WHERE bv.project_id = @project_id
ORDER BY bv.task_id, bv.label
```

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
