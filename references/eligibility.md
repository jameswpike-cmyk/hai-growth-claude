# Eligibility & Availability Filter

**MANDATORY: Any query about "eligible", "available", or "who can work on X" MUST apply this full filter.**

---

## Standard Output Query

**This is the reference SELECT + JOIN that produces the standard output columns defined in SKILL.md.** Use this as the base for every ops/fellow query. Add criteria-specific columns after column 17.

```sql
WITH
base_fellow_status AS (
  SELECT id AS profile_id, status, current_onboarding_stage, country_code
  FROM `hs-ai-production.hai_public.profiles`
  WHERE status IN ('verified')
    AND current_onboarding_stage IN ('fully-onboarded')
),

availability AS (
  SELECT
    a.profile_id,
    a.current_project,
    a.last_activity,
    a.last_activity_type,
    CASE
      WHEN a.last_activity IS NULL THEN 'Available - Idle'
      WHEN DATE_DIFF(CURRENT_DATE(), DATE(a.last_activity), DAY) >= 20 THEN 'Available - Idle'
      WHEN a.current_project LIKE '%Offboarded%' THEN 'Available - Idle'
      WHEN a.current_project_paused = TRUE THEN 'Available - Project Paused'
      ELSE 'Unavailable - Active'
    END AS available,
    CASE
      WHEN a.last_otter_activity IS NOT NULL
        AND DATE_DIFF(CURRENT_DATE(), DATE(a.last_otter_activity), DAY) < 30 THEN TRUE
      ELSE FALSE
    END AS otter_ringfenced
  FROM `hs-ai-production.hai_dev.fact_fellow_status` a
  INNER JOIN base_fellow_status bfs ON a.profile_id = bfs.profile_id
),

on_hold AS (
  SELECT p.id AS profile_id, STRING_AGG(hold.project, ',') AS projects
  FROM (
    SELECT string_field_2 AS email, string_field_1 AS project
    FROM `hs-ai-sandbox.hai_dev.hai_on_hold`
    WHERE string_field_2 != 'Email'
  ) AS hold
  LEFT JOIN `hs-ai-production.hai_public.profiles` p ON hold.email = p.email
  WHERE p.id IS NOT NULL
  GROUP BY p.id
),

survey_opt AS (
  SELECT profile_id, CAST(requires_opt_or_cpt_sponsorship AS STRING) AS opt
  FROM `hs-ai-production.hai_public.survey_responses`
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY profile_id
    ORDER BY
      CASE WHEN requires_opt_or_cpt_sponsorship IS NOT NULL THEN 0 ELSE 1 END,
      created_at DESC
  ) = 1
)

-- Standard output columns (1–17)
SELECT
  -- Core columns (1–10)
  dim.profile_id,                                                          -- 1
  bfs.email,                                                               -- 2  (from profiles, NOT hai_profiles_dim)
  dim.first_name,                                                          -- 3
  dim.last_name,                                                           -- 4
  bfs.status,                                                              -- 5  (from profiles)
  bfs.current_onboarding_stage,                                            -- 6  (from profiles)
  dim.resume_url_in_product,                                               -- 7
  dim.highest_education_level,                                             -- 8
  dim.domain,                                                              -- 9
  dim.subdomain,                                                           -- 10

  -- Availability verdict + eligibility breakdown (11–17)
  a.available,                                                             -- 11 (computed CASE)
  a.current_project,                                                       -- 12
  a.last_activity,                                                         -- 13
  a.otter_ringfenced,                                                      -- 14
  CASE WHEN oh.profile_id IS NOT NULL THEN TRUE ELSE FALSE END AS on_hold, -- 15
  COALESCE(s.opt, 'false') AS opt_cpt,                                     -- 16
  bfs.country_code                                                         -- 17

  -- Add criteria confirmation columns here (e.g., major, resume_degree)
  -- Add custom columns here

FROM `hs-ai-production.hai_dev.hai_profiles_dim` dim
INNER JOIN base_fellow_status bfs ON dim.profile_id = CAST(bfs.profile_id AS STRING)
INNER JOIN availability a ON dim.profile_id = CAST(a.profile_id AS STRING)
LEFT JOIN on_hold oh ON CAST(oh.profile_id AS STRING) = dim.profile_id
LEFT JOIN survey_opt s ON CAST(s.profile_id AS STRING) = dim.profile_id

WHERE a.available IN ('Available - Idle', 'Available - Project Paused')
  AND a.otter_ringfenced = FALSE
  AND oh.profile_id IS NULL
  AND (s.opt = 'false' OR s.opt IS NULL)
  AND (LOWER(bfs.country_code) LIKE '%us%' OR LOWER(bfs.country_code) LIKE '%united states%')
  AND NOT LOWER(bfs.email) LIKE '%@joinhandshake.com%'
```

---

## Eligibility Criteria Summary

| Criterion | Source Table | Logic |
|-----------|-------------|-------|
| Verified & onboarded | `hai_public.profiles` | `status = 'verified'` AND `current_onboarding_stage = 'fully-onboarded'` |
| Available (idle) | `hai_dev.fact_fellow_status` | No activity in 20+ days, OR offboarded, OR project paused |
| Otter KYC verified | `hai_dev.fact_fellow_kyc` | `persona_status = 'verified'` (required for Otter eligibility — note: `hai_public.profiles.status = 'verified'` does NOT guarantee `persona_status = 'verified'`) |
| Not Otter-ringfenced | `hai_dev.fact_fellow_status` | No Otter activity in last 30 days |
| Not on hold | `hs-ai-sandbox.hai_dev.hai_on_hold` | Email not in on-hold sheet |
| No OPT/CPT needed | `hai_public.survey_responses` | `requires_opt_or_cpt_sponsorship` is false or null |
| US-based | `hai_public.profiles` | `country_code` contains 'us' or 'united states' |
| Not internal | any email field | Not `@joinhandshake.com` |

---

## Education & Background Queries (Dual-Source Rule)

**Any query about education, degrees, field of study, or expertise MUST use both sources:**

1. **`hai_profiles_dim`** — structured: `highest_education_level`, `domain`, `subdomain`, `major`, `major_group`, `graduate_institution_name`
2. **`hai_public.resumes`** — parsed resume: `parsed_data.education[].degree`, `parsed_data.education[].fieldOfStudy`, `parsed_data.education[].school`

Why both: `hai_profiles_dim` has pre-classified domain/subdomain but may miss nuance. `resumes.parsed_data` captures specifics (e.g., "Ph.D. in Condensed Matter Physics" vs subdomain "Physics").

### Standard Join Pattern

```sql
SELECT
  p.profile_id, p.email, p.first_name, p.last_name,
  p.highest_education_level, p.domain, p.subdomain, p.major,
  p.graduate_institution_name,
  JSON_EXTRACT_SCALAR(r.parsed_data, '$.education[0].degree') AS resume_degree,
  JSON_EXTRACT_SCALAR(r.parsed_data, '$.education[0].fieldOfStudy') AS resume_field_of_study
FROM `hs-ai-production.hai_dev.hai_profiles_dim` p
JOIN `hs-ai-production.hai_public.resumes` r
  ON p.profile_id = r.profileId
WHERE r.status = 'PROCESSED'
  AND r.parsed_data IS NOT NULL
  AND NOT LOWER(p.email) LIKE '%@joinhandshake.com%'
```

### Search Across ALL Education Entries (not just [0])

```sql
LOWER(TO_JSON_STRING(JSON_EXTRACT(r.parsed_data, '$.education'))) LIKE '%ph.d%'
```

### Education Level Grouping

```sql
CASE
  WHEN highest_education_level IN ('JD', 'MD', 'Postdoctoral Studies', 'Doctorate') THEN 'Doctorate'
  WHEN highest_education_level IN ('MBA', 'Masters') THEN 'Masters'
  WHEN highest_education_level IN ('Bachelors') THEN 'Bachelors'
  ELSE 'Other'
END AS education_level
```
