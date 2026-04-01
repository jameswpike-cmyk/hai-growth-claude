# Query Patterns

**These are proven SQL examples from real queries. Do NOT write SQL from scratch — find the closest pattern below and adapt it.** If your use case isn't covered here, check the schema in `fact-tables.md` or `dimension-tables.md` and model your query after the patterns here.

## Table of Contents
- Active Fellow Counts
- Funnel Analysis & Drop-Off
- Fellow Search by Education / Domain / Skills
- Show Resume / Resume URL Lookup
- Resume Keyword Search
- Resume Demographics via short_parsed_data
- Resume Experience & Project Extraction
- Cross-Table Joins

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
