# Onboarding Funnel Flags

Two query templates that return TRUE/FALSE flags for how far each fellow has progressed through the onboarding funnel for a specific project:

1. **BQ analysis query** — paste into the HAI BigQuery console. Runs from `hs-ai-production`. Includes timestamps for time-between-stage analysis.
2. **Fivetran sync query** — paste into Fivetran. Runs from `handshake-production`. Identical structure, project prefix swapped on curated tables.

**All flags are independently computed — no ordering is enforced.** A fellow can have `mock_tasks_started_flag = TRUE` and `coarse_comparisons_completed_flag = FALSE` if they were allowed to skip ahead or if thresholds don't apply to their cohort. This is intentional: show the truth, let the user define their own filter logic.

---

## Skill Workflow

When the user asks for funnel flag queries, ask:

1. **Project ID** — UUID of the HAI project (e.g. `fd0e5d21-5ab4-4007-9b9c-9f69c06d0ac4`)
2. **Project slug** — a short lowercase name for this project (e.g. `darwin`, `spectra`). This is used to prefix all flag columns in the Fivetran sync query so they don't collide with other projects in Census (e.g. `hai_darwin_pso_allocated_flag`). Ask the user: *"What short name should we use for this project? (e.g. darwin, spectra, proctor)"*
3. **Is this an Otter/Feather project?** — does it have a screener or production Feather campaign?
   - **No** → generate HAI funnel query only (Track 1)
   - **Yes** → also ask for screener campaign name + production campaign name, then auto-discover steps (see Track 2)

---

## Standard Identity Columns (all queries)

| Column | Source | Notes |
|--------|--------|-------|
| `profile_id` | `fact_project_funnel` | UUID string |
| `email` | `fact_project_funnel` | Real email — for Otter projects prefer `fpf.email` over Otter-side anonymised email |
| `profile_status` | `fact_project_funnel` (`profile_status`) | `verified`, `pending`, etc. |
| `current_onboarding_stage` | `hai_profiles_dim` | `fully-onboarded`, etc. |
| `project_name` | `fact_project_funnel` | |
| `project_status` | `hai_public.annotation_projects` | `active`, `paused`, etc. — JOIN `annotation_projects ap ON fpf.project_id = ap.id` |
| `last_touch_utm_source` | `hai_user_growth_dim` | HAI projects only — omit for Otter-only output |

---

## Track 1 — HAI Production Funnel

**Source:** `fact_project_funnel`
**Parameter:** `project_id` (UUID)

### Flags

| # | Flag | Column | Logic |
|---|------|--------|-------|
| 01 | `pso_allocated_flag` | `pso_allocated_pst` | `IS NOT NULL` |
| 02 | `pso_accepted_flag` | `pso_invitation_accepted_pst` | `IS NOT NULL` |
| 03 | `assessment_started_flag` | `canvas_assessment_first_started_pst` | `IS NOT NULL` |
| 04 | `assessment_submitted_flag` | `form_responses` CTE | `COALESCE(a.assessment_submitted_flag, FALSE)` |
| 05 | `assessment_graded_flag` | `form_autograder_results` | `COALESCE(a.assessment_graded_flag, FALSE)` |
| 06 | `assessment_passed_flag` | `form_autograder_results.passed` | `COALESCE(a.assessment_passed_flag, FALSE)` |
| 07 | `first_task_claimed_flag` | `first_claimed_at_pst` | `IS NOT NULL` |
| 08 | `first_task_submitted_flag` | `first_task_submitted_pst` | `IS NOT NULL` |
| 09 | `offboarded_flag` | `offboarded` | `COALESCE(f.offboarded, FALSE)` |

**Note:** Flags 04–06 require an optional `assessments` CTE. Only include if the project has an assessment — the user must provide the `form_definition_id`. If no assessment, omit the CTE and flags 04–06.

### Joins

```
fact_project_funnel           — base, filter by project_id (email, profile_status, project_name already here)
  LEFT JOIN annotation_projects     ON project_id = id             — project_status
  LEFT JOIN hai_profiles_dim        ON profile_id = profile_id     — current_onboarding_stage
  LEFT JOIN hai_user_growth_dim     ON profile_id = user_id        — last_touch_utm_source
  LEFT JOIN assessments CTE         ON profile_id = profile_id     — assessment flags (optional)
```

### BQ Analysis Query Template

```sql
-- [Project Name] Fellow-Level Funnel Flags
-- BQ analysis query — runs from hs-ai-production
-- query_date: YYYY-MM-DD
-- project_id: [UUID]
WITH assessments AS (
    -- OPTIONAL: include only if project has an assessment
    -- Replace form_definition_id with the project's assessment form ID
    SELECT
        fr.created_by AS profile_id,
        TRUE AS assessment_submitted_flag,
        far.passed IS NOT NULL AS assessment_graded_flag,
        COALESCE(far.passed, FALSE) AS assessment_passed_flag
    FROM `hs-ai-production.hai_public.form_responses` fr
    JOIN `hs-ai-production.hai_public.form_definition_versions` fdv
      ON fdv.id = fr.form_definition_version_id
    JOIN `hs-ai-production.hai_public.form_definitions` fd
      ON fd.id = fdv.form_definition_id
    LEFT JOIN `hs-ai-production.hai_public.form_autograder_results` far
      ON fr.id = far.form_response_id
    WHERE fd.id = '[form_definition_id]'
    QUALIFY ROW_NUMBER() OVER (PARTITION BY fr.created_by ORDER BY fr.created_at DESC) = 1
)
SELECT DISTINCT
    f.profile_id,
    f.email,
    f.profile_status,
    dim.current_onboarding_stage,
    f.project_name,
    ap.status AS project_status,
    ug.last_touch_utm_source,

    -- Flags (project-prefixed)
    f.pso_allocated_pst IS NOT NULL                     AS hai_[slug]_pso_allocated_flag,
    f.pso_invitation_accepted_pst IS NOT NULL           AS hai_[slug]_pso_accepted_flag,
    f.canvas_assessment_first_started_pst IS NOT NULL   AS hai_[slug]_assessment_started_flag,
    COALESCE(a.assessment_submitted_flag, FALSE)        AS hai_[slug]_assessment_submitted_flag,
    COALESCE(a.assessment_graded_flag, FALSE)           AS hai_[slug]_assessment_graded_flag,
    COALESCE(a.assessment_passed_flag, FALSE)           AS hai_[slug]_assessment_passed_flag,
    f.first_claimed_at_pst IS NOT NULL                  AS hai_[slug]_first_task_claimed_flag,
    f.first_task_submitted_pst IS NOT NULL              AS hai_[slug]_first_task_submitted_flag,
    COALESCE(f.offboarded, FALSE)                       AS hai_[slug]_offboarded_flag,

    -- Timestamps
    f.pso_allocated_pst,
    f.pso_invitation_accepted_pst,
    f.canvas_assessment_first_started_pst,
    f.first_claimed_at_pst,
    f.first_task_submitted_pst

FROM `hs-ai-production.hai_dev.fact_project_funnel` f
LEFT JOIN `hs-ai-production.hai_public.annotation_projects` ap
  ON f.project_id = ap.id
LEFT JOIN `hs-ai-production.hai_dev.hai_profiles_dim` dim
  ON f.profile_id = dim.profile_id
LEFT JOIN `hs-ai-production.hai_dev.hai_user_growth_dim` ug
  ON f.profile_id = ug.user_id
LEFT JOIN assessments a
  ON f.profile_id = a.profile_id
WHERE f.project_id = '[project_id]'
  AND f.pso_allocated_pst IS NOT NULL
```

### Fivetran Sync Query Template

Identical structure — swap `hs-ai-production.hai_dev` → `handshake-production.hai_dev` and `hs-ai-production.hai_public` → `handshake-production.hai_public`. Flag names are project-prefixed for Census namespacing.

```sql
-- [Project Name] Fellow-Level Funnel Flags
-- Fivetran sync query — runs from handshake-production
-- query_date: YYYY-MM-DD
-- project_id: [UUID]
WITH assessments AS (
    SELECT
        fr.created_by AS profile_id,
        TRUE AS assessment_submitted_flag,
        far.passed IS NOT NULL AS assessment_graded_flag,
        COALESCE(far.passed, FALSE) AS assessment_passed_flag
    FROM `handshake-production.hai_public.form_responses` fr
    JOIN `handshake-production.hai_public.form_definition_versions` fdv
      ON fdv.id = fr.form_definition_version_id
    JOIN `handshake-production.hai_public.form_definitions` fd
      ON fd.id = fdv.form_definition_id
    LEFT JOIN `handshake-production.hai_public.form_autograder_results` far
      ON fr.id = far.form_response_id
    WHERE fd.id = '[form_definition_id]'
    QUALIFY ROW_NUMBER() OVER (PARTITION BY fr.created_by ORDER BY fr.created_at DESC) = 1
)
SELECT DISTINCT
    f.profile_id,
    f.email,
    f.profile_status,
    dim.current_onboarding_stage,
    f.project_name,
    ap.status AS project_status,
    ug.last_touch_utm_source,

    -- Flags (project-prefixed for Census)
    f.pso_allocated_pst IS NOT NULL                     AS hai_[slug]_pso_allocated_flag,
    f.pso_invitation_accepted_pst IS NOT NULL           AS hai_[slug]_pso_accepted_flag,
    f.canvas_assessment_first_started_pst IS NOT NULL   AS hai_[slug]_assessment_started_flag,
    COALESCE(a.assessment_submitted_flag, FALSE)        AS hai_[slug]_assessment_submitted_flag,
    COALESCE(a.assessment_graded_flag, FALSE)           AS hai_[slug]_assessment_graded_flag,
    COALESCE(a.assessment_passed_flag, FALSE)           AS hai_[slug]_assessment_passed_flag,
    f.first_claimed_at_pst IS NOT NULL                  AS hai_[slug]_first_task_claimed_flag,
    f.first_task_submitted_pst IS NOT NULL              AS hai_[slug]_first_task_submitted_flag,
    COALESCE(f.offboarded, FALSE)                       AS hai_[slug]_offboarded_flag

FROM `handshake-production.hai_dev.fact_project_funnel` f
LEFT JOIN `handshake-production.hai_public.annotation_projects` ap
  ON f.project_id = ap.id
LEFT JOIN `handshake-production.hai_dev.hai_profiles_dim` dim
  ON f.profile_id = dim.profile_id
LEFT JOIN `handshake-production.hai_dev.hai_user_growth_dim` ug
  ON f.profile_id = ug.user_id
LEFT JOIN assessments a
  ON f.profile_id = a.profile_id
WHERE f.project_id = '[project_id]'
  AND f.pso_allocated_pst IS NOT NULL
```

---

## Track 2 — Otter Screener + Production

For projects that use Feather/Otter for screener and/or production tasking.

**Parameters:** `screener_campaign` name, `production_campaign` name

### Step 1 — Auto-discover screener steps

Before writing the query, run this to discover available `task_batch` values for the screener campaign:

```sql
SELECT
    task_batch,
    COUNT(DISTINCT profile_id) AS fellows,
    MIN(created_at) AS first_seen
FROM `hs-ai-production.hai_dev.fact_otter_task_activity`
WHERE campaign = '[screener_campaign]'
GROUP BY task_batch
ORDER BY first_seen
```

Present the results to the user and confirm for each batch:
- Is this a screener step? (yes/no)
- Flag type: `claimed` (first touch only) or `completed_all` (requires finishing N tasks)?
- If `completed_all`: what is the completion threshold N?

**Example for Spectra `[Image] Onboarding / screening`:**

| task_batch | Type | Threshold | Flag name |
|------------|------|-----------|-----------|
| Step 1: Instruction Quiz | claimed | — | `instruction_quiz_claimed_flag` |
| Step 2: Coarse comparisons | completed_all | ≥ 14 | `coarse_comparisons_started_flag` + `coarse_comparisons_completed_flag` |
| Step 3: Mock Tasks | completed_all | ≥ 12 | `mock_tasks_started_flag` + `mock_tasks_completed_flag` |

### Step 2 — Auto-discover production task batches

Run this to identify post-onboarding vs production batches:

```sql
SELECT DISTINCT task_batch
FROM `hs-ai-production.hai_dev.fact_otter_task_activity`
WHERE campaign = '[production_campaign]'
ORDER BY task_batch
```

Production tasks = everything that is NOT a post-onboarding batch. Filter: `LOWER(task_batch) NOT LIKE '%post-onboarding%'`

### Flags

**Screener flags** (one `_claimed` or `_started` + `_completed` pair per step):

| Flag pattern | Logic |
|-------------|-------|
| `[step]_claimed_flag` | `MIN(created_at WHERE task_batch = '[batch]') IS NOT NULL` |
| `[step]_started_flag` | `MIN(created_at WHERE task_batch = '[batch]') IS NOT NULL` |
| `[step]_completed_flag` | `COUNTIF(task_batch = '[batch]' AND activity_type = 'completed') >= [threshold]` |

**Production flags:**

| Flag | Logic |
|------|-------|
| `allocated_to_production_flag` | Has any activity in production campaign (BQ proxy) |
| `production_task_claimed_flag` | `COUNTIF(non-post-onboarding tasks) > 0` |
| `production_task_submitted_flag` | `COUNTIF(non-post-onboarding AND activity_type = 'completed') > 0` |

**⚠️ BQ vs Fivetran difference for Otter:**
- **BQ query** uses `hs-ai-production.hai_dev.fact_otter_task_activity` — `allocated_to_screener/production` means "has any activity" (does not capture allocated-but-never-started)
- **Fivetran query** uses `handshake-production.hai_public.otter_campaign_user_allocations` — true allocation timestamp, captures everyone including never-started

### BQ Analysis Query Template (Otter project)

**Base from `fact_project_funnel` (HAI screener project) + Otter step flags:**

```sql
-- [Project Name] Funnel Flags (HAI + Otter)
-- BQ analysis query — runs from hs-ai-production
-- query_date: YYYY-MM-DD
-- HAI screener project_id: [UUID]
-- HAI production project_id: [UUID]
-- Otter screener campaign: [campaign_name]
-- Otter production campaign: [campaign_name]
WITH screener_otter AS (
    SELECT
        profile_id,
        -- One block per screener step — customise batch names and thresholds
        MIN(CASE WHEN task_batch = '[Step 1 batch name]' THEN created_at END) IS NOT NULL
            AS [step1_slug]_claimed_flag,
        MIN(CASE WHEN task_batch = '[Step 2 batch name]' THEN created_at END) IS NOT NULL
            AS [step2_slug]_started_flag,
        COUNTIF(task_batch = '[Step 2 batch name]' AND activity_type = 'completed') >= [N]
            AS [step2_slug]_completed_flag,
        MIN(CASE WHEN task_batch = '[Step 3 batch name]' THEN created_at END) IS NOT NULL
            AS [step3_slug]_started_flag,
        COUNTIF(task_batch = '[Step 3 batch name]' AND activity_type = 'completed') >= [N]
            AS [step3_slug]_completed_flag,
        -- Timestamps
        MIN(CASE WHEN task_batch = '[Step 1 batch name]' THEN created_at END) AS [step1_slug]_first_claimed_at,
        MIN(CASE WHEN task_batch = '[Step 2 batch name]' THEN created_at END) AS [step2_slug]_first_claimed_at,
        MIN(CASE WHEN task_batch = '[Step 3 batch name]' THEN created_at END) AS [step3_slug]_first_claimed_at
    FROM `hs-ai-production.hai_dev.fact_otter_task_activity`
    WHERE campaign = '[screener_campaign]'
      AND profile_id IS NOT NULL
    GROUP BY profile_id
),
production_otter AS (
    SELECT
        profile_id,
        TRUE AS allocated_to_production_flag,
        COUNTIF(LOWER(task_batch) NOT LIKE '%post-onboarding%') > 0
            AS production_task_claimed_flag,
        COUNTIF(LOWER(task_batch) NOT LIKE '%post-onboarding%' AND activity_type = 'completed') > 0
            AS production_task_submitted_flag,
        MIN(CASE WHEN LOWER(task_batch) NOT LIKE '%post-onboarding%' THEN created_at END)
            AS production_first_claimed_at
    FROM `hs-ai-production.hai_dev.fact_otter_task_activity`
    WHERE campaign = '[production_campaign]'
      AND profile_id IS NOT NULL
    GROUP BY profile_id
)
SELECT
    fpf.profile_id,
    fpf.email,
    fpf.profile_status,
    dim.current_onboarding_stage,
    fpf.project_name,
    ap.status AS project_status,

    -- HAI platform flags (project-prefixed)
    fpf.pso_allocated_pst IS NOT NULL               AS hai_[slug]_pso_allocated_flag,
    fpf.pso_invitation_accepted_pst IS NOT NULL     AS hai_[slug]_pso_accepted_flag,
    fpf.pso_completed_pst IS NOT NULL               AS hai_[slug]_pso_completed_flag,
    COALESCE(fpf.offboarded, FALSE)                 AS hai_[slug]_offboarded_flag,

    -- Otter screener step flags (project-prefixed)
    COALESCE(so.[step1_slug]_claimed_flag, FALSE)       AS hai_[slug]_[step1_slug]_claimed_flag,
    COALESCE(so.[step2_slug]_started_flag, FALSE)       AS hai_[slug]_[step2_slug]_started_flag,
    COALESCE(so.[step2_slug]_completed_flag, FALSE)     AS hai_[slug]_[step2_slug]_completed_flag,
    COALESCE(so.[step3_slug]_started_flag, FALSE)       AS hai_[slug]_[step3_slug]_started_flag,
    COALESCE(so.[step3_slug]_completed_flag, FALSE)     AS hai_[slug]_[step3_slug]_completed_flag,

    -- Production flags (project-prefixed)
    COALESCE(po.allocated_to_production_flag, FALSE)        AS hai_[slug]_allocated_to_production_flag,
    COALESCE(po.production_task_claimed_flag, FALSE)        AS hai_[slug]_production_task_claimed_flag,
    COALESCE(po.production_task_submitted_flag, FALSE)      AS hai_[slug]_production_task_submitted_flag,

    -- Timestamps
    fpf.pso_allocated_pst,
    fpf.pso_invitation_accepted_pst,
    fpf.pso_completed_pst,
    so.[step1_slug]_first_claimed_at,
    so.[step2_slug]_first_claimed_at,
    so.[step3_slug]_first_claimed_at,
    po.production_first_claimed_at

FROM `hs-ai-production.hai_dev.fact_project_funnel` fpf
LEFT JOIN `hs-ai-production.hai_public.annotation_projects` ap
  ON fpf.project_id = ap.id
LEFT JOIN `hs-ai-production.hai_dev.hai_profiles_dim` dim
  ON fpf.profile_id = dim.profile_id
LEFT JOIN screener_otter so ON fpf.profile_id = so.profile_id
LEFT JOIN production_otter po ON fpf.profile_id = po.profile_id
WHERE fpf.project_id = '[hai_screener_project_id]'
ORDER BY fpf.pso_allocated_pst
```

### Fivetran Sync Query Template (Otter project)

Same structure. Key differences:
- `hs-ai-production.hai_dev` → `handshake-production.hai_dev`
- Uses raw `handshake-production.hai_public.otter_campaign_user_allocations` for true allocation
- Flag names are project-prefixed (`hai_[slug]_*`)

```sql
-- [Project Name] Funnel Flags (HAI + Otter)
-- Fivetran sync query — runs from handshake-production
-- query_date: YYYY-MM-DD
WITH screener_flags AS (
    SELECT
        fl.profile_id,
        hpd.email,
        MIN(DATETIME(cua.created_at, 'America/Los_Angeles')) IS NOT NULL AS pso_completed_flag,
        -- One block per screener step
        MIN(CASE
            WHEN th.task_batch = '[Step 1 batch name]'
            THEN DATETIME(th.created_at, 'America/Los_Angeles')
        END) IS NOT NULL AS [step1_slug]_claimed_flag,
        MIN(CASE
            WHEN th.task_batch = '[Step 2 batch name]'
            THEN DATETIME(th.created_at, 'America/Los_Angeles')
        END) IS NOT NULL AS [step2_slug]_started_flag,
        COUNTIF(th.task_batch = '[Step 2 batch name]' AND th.status = 'completed') >= [N]
            AS [step2_slug]_completed_flag,
        MIN(CASE
            WHEN th.task_batch = '[Step 3 batch name]'
            THEN DATETIME(th.created_at, 'America/Los_Angeles')
        END) IS NOT NULL AS [step3_slug]_started_flag,
        COUNTIF(th.task_batch = '[Step 3 batch name]' AND th.status = 'completed') >= [N]
            AS [step3_slug]_completed_flag
    FROM `handshake-production.hai_public.otter_campaign_user_allocations` AS cua
    JOIN `handshake-production.hai_public.otter_users` AS u
      ON u.email = cua.user
    LEFT JOIN `handshake-production.hai_dev.fact_otter_email_mapping` AS fl
      ON fl.email = u.email
    LEFT JOIN `handshake-production.hai_dev.hai_profiles_dim` AS hpd
      ON hpd.profile_id = fl.profile_id
    LEFT JOIN `handshake-production.hai_public.otter_task_status_history` AS th
      ON th.email = cua.user
      AND th.campaign = '[screener_campaign]'
    LEFT JOIN `handshake-production.hai_dev.fact_project_funnel` AS pf
      ON pf.profile_id = fl.profile_id
      AND pf.project_id = '[hai_screener_project_id]'
    WHERE cua.campaign = '[screener_campaign]'
      AND fl.profile_id IS NOT NULL
    GROUP BY ALL
),
production_flags AS (
    SELECT
        fl.profile_id,
        TRUE AS allocated_to_production_flag,
        MIN(CASE
            WHEN LOWER(th.task_batch) NOT LIKE '%post-onboarding%'
            THEN th.created_at
        END) IS NOT NULL AS production_task_claimed_flag,
        MIN(CASE
            WHEN LOWER(th.task_batch) NOT LIKE '%post-onboarding%' AND th.status = 'completed'
            THEN th.created_at
        END) IS NOT NULL AS production_task_submitted_flag
    FROM `handshake-production.hai_public.otter_campaign_user_allocations` AS cua
    JOIN `handshake-production.hai_public.otter_users` AS u ON u.email = cua.user
    LEFT JOIN `handshake-production.hai_dev.fact_otter_email_mapping` AS fl ON fl.email = u.email
    LEFT JOIN `handshake-production.hai_public.otter_task_status_history` AS th
      ON th.email = cua.user
      AND th.campaign = '[production_campaign]'
    WHERE cua.campaign = '[production_campaign]'
      AND fl.profile_id IS NOT NULL
    GROUP BY ALL
)
SELECT DISTINCT
    COALESCE(s.profile_id, po.profile_id) AS profile_id,
    COALESCE(fpf.email, s.email) AS email,
    dim.status AS profile_status,
    dim.current_onboarding_stage,
    ap.status AS project_status,

    -- HAI + Otter flags (project-prefixed for Census)
    fpf.pso_allocated_pst IS NOT NULL                       AS hai_[slug]_pso_allocated_flag,
    fpf.pso_invitation_accepted_pst IS NOT NULL             AS hai_[slug]_pso_accepted_flag,
    COALESCE(s.pso_completed_flag, FALSE)                   AS hai_[slug]_pso_completed_flag,
    COALESCE(s.[step1_slug]_claimed_flag, FALSE)            AS hai_[slug]_[step1_slug]_claimed_flag,
    COALESCE(s.[step2_slug]_started_flag, FALSE)            AS hai_[slug]_[step2_slug]_started_flag,
    COALESCE(s.[step2_slug]_completed_flag, FALSE)          AS hai_[slug]_[step2_slug]_completed_flag,
    COALESCE(s.[step3_slug]_started_flag, FALSE)            AS hai_[slug]_[step3_slug]_started_flag,
    COALESCE(s.[step3_slug]_completed_flag, FALSE)          AS hai_[slug]_[step3_slug]_completed_flag,
    COALESCE(po.allocated_to_production_flag, FALSE)        AS hai_[slug]_allocated_to_production_flag,
    COALESCE(po.production_task_claimed_flag, FALSE)        AS hai_[slug]_production_task_claimed_flag,
    COALESCE(po.production_task_submitted_flag, FALSE)      AS hai_[slug]_production_task_submitted_flag,
    COALESCE(fpf.offboarded, FALSE)                         AS hai_[slug]_offboarded_flag

FROM screener_flags s
FULL OUTER JOIN production_flags po ON s.profile_id = po.profile_id
LEFT JOIN `handshake-production.hai_dev.fact_project_funnel` fpf
  ON COALESCE(s.profile_id, po.profile_id) = fpf.profile_id
  AND fpf.project_id = '[hai_screener_project_id]'
LEFT JOIN `handshake-production.hai_public.annotation_projects` ap
  ON fpf.project_id = ap.id
LEFT JOIN `handshake-production.hai_dev.hai_profiles_dim` dim
  ON COALESCE(s.profile_id, po.profile_id) = dim.profile_id
```

---

## Notes

- **Flag independence:** Flags are not enforced in order. A later flag can be TRUE while an earlier flag is FALSE — this is by design. Users filter as needed.
- **Completion thresholds:** `COUNTIF >= N` thresholds are project-specific. Always confirm with the user or inspect the data before hardcoding.
- **Otter allocated_to_screener (BQ):** The BQ query uses `fact_otter_task_activity` — "allocated" means "has any activity". Fellows who were allocated but never touched the screener won't appear. Use the Fivetran query for true allocation counts.
- **Profile ID type:** `profile_id` is a UUID string in all tables — do not cast to INTEGER.
- **Duplicate emails:** Some profile_ids have multiple emails in `fact_otter_task_activity`. Always `GROUP BY profile_id` only (not profile_id + email) in Otter CTEs.
- **Real vs anonymised email:** Otter-side emails may be anonymised (`@handshakecommunity.ai`). Always prefer `fpf.email` from `fact_project_funnel` via `COALESCE(fpf.email, otter_email)`.
