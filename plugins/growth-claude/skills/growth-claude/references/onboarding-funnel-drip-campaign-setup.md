# Onboarding Funnel — Event-Driven Drip Sync

A single query template that emits one row per (fellow x funnel milestone) as an **event**. Designed for Census/Iterable event-based syncs where drip campaigns are triggered by events rather than user-property updates.

Two variants:
1. **Fivetran sync query** — paste into Fivetran. Runs from `handshake-production`. Census upserts on `event_id`.
2. **BQ analysis query** — same template, swap `handshake-production` -> `hs-ai-production`.

---

## Output Shape

| Aspect | Description |
|--------|-------------|
| **Grain** | One row per (fellow x event) — a fellow who reached 5 milestones produces 5 rows |
| **Sync key** | `event_id` = `TO_HEX(MD5(CONCAT(profile_id, '-', event_name)))` — deterministic, stable across syncs |
| **Event naming** | `hai_[slug]_[milestone]` (e.g. `hai_alloy_pso_allocated`) |
| **Idempotency** | Same fellow + same milestone always produces the same `event_id`. Census upserts, no duplicate events. |

### Output Columns (fixed for all events)

| # | Column | Source |
|---|--------|--------|
| 1 | `event_id` | Computed: `TO_HEX(MD5(CONCAT(profile_id, '-', event_name)))` |
| 2 | `event_name` | Literal string per UNION ALL arm |
| 3 | `profile_id` | `base` CTE |
| 4 | `email` | `base` CTE |
| 5 | `profile_status` | `base` CTE |
| 6 | `current_onboarding_stage` | `base` CTE |
| 7 | `last_touch_utm_source` | `base` CTE |
| 8 | `last_activity` | `fact_fellow_status` — last activity date |

### Query Structure

```
1. assessments CTE       — optional, only if project has an assessment
2. base CTE              — computes all flags as booleans + context columns
3. UNION ALL fan-out     — one SELECT per flag, emitting (event_id, event_name, context cols)
```

Each UNION ALL arm filters `WHERE flag = TRUE` and injects the event name as a literal string. Additional events (e.g. `offboarded`, Otter screener steps) are added as more UNION ALL arms with the same column signature.

---

## Skill Workflow

When the user asks for a drip sync query, ask:

1. **Project ID** — UUID of the HAI project (e.g. `fd0e5d21-5ab4-4007-9b9c-9f69c06d0ac4`)
2. **Project slug** — a short lowercase name for this project (e.g. `alloy`, `spectra`). Used in `event_name` values (e.g. `hai_alloy_pso_allocated`). Ask the user: *"What short name should we use for this project? (e.g. alloy, spectra, proctor)"*
3. **Does the project have an assessment?** If yes, get the `form_definition_id`. If no, omit the assessments CTE and assessment event arms.
4. **Is this an Otter/Feather project?** Does it have a screener or production Feather campaign?
   - **No** — generate HAI-only event query
   - **Yes** — also ask for screener campaign name + production campaign name, then auto-discover steps (see Otter Extension below)

### Project-Active Gate (always applied)

Drip events should only fire while the annotation project itself is **active**. The project-level status lives in `hai_public.annotation_projects.status`. The base CTE must join this table and filter on it so that paused or ended projects do not generate drip events.

**Known status values** (as of 2026-04-17): `active`, `paused`, `ended`. Filter on `= 'active'`.

Sample lookup to confirm the project's current status before running the sync:

```sql
SELECT id AS project_id, name AS project_name, status
FROM `handshake-production.hai_public.annotation_projects`
WHERE id = '[project_id]'
```

In the `base` CTE, add:

```sql
JOIN `handshake-production.hai_public.annotation_projects` ap
  ON ap.id = f.project_id
...
WHERE f.project_id = '[project_id]'
  AND ap.status = 'active'        -- project-level gate: pause/archive stops all drip events
  AND f.pso_allocated_pst IS NOT NULL
```

Also expose `ap.status AS project_status` as a context column in `base` so it can be inspected downstream. Unlike `offboarded` (which is fellow-level and fans out as its own event), `project_status` is a global filter — when the project is not `active`, the entire query returns zero rows and no events are emitted.

---

## Standard Identity Columns (all queries)

| Column | Source | Notes |
|--------|--------|-------|
| `profile_id` | `fact_project_funnel` | UUID string |
| `email` | `fact_project_funnel` | Real email — for Otter projects prefer `fpf.email` over Otter-side anonymised email |
| `profile_status` | `fact_project_funnel` (`profile_status`) | `verified`, `pending`, etc. |
| `current_onboarding_stage` | `hai_profiles_dim` | `fully-onboarded`, etc. |
| `last_touch_utm_source` | `hai_user_growth_dim` | HAI projects only — omit for Otter-only output |
| `last_activity` | `fact_fellow_status` | Last activity date |

---

## HAI Funnel Events

These are the standard HAI funnel milestone events, computed from `fact_project_funnel`:

| # | Event name | Flag source | Logic |
|---|------------|-------------|-------|
| 01 | `hai_[slug]_pso_allocated` | `pso_allocated_pst` | `IS NOT NULL` |
| 02 | `hai_[slug]_pso_accepted` | `pso_invitation_accepted_pst` | `IS NOT NULL` |
| 03 | `hai_[slug]_assessment_started` | `canvas_assessment_first_started_pst` | `IS NOT NULL` |
| 04 | `hai_[slug]_assessment_submitted` | `form_responses` CTE | `COALESCE(a.assessment_submitted_flag, FALSE)` |
| 05 | `hai_[slug]_assessment_graded` | `form_autograder_results` | `COALESCE(a.assessment_graded_flag, FALSE)` |
| 06 | `hai_[slug]_assessment_passed` | `form_autograder_results.passed` | `COALESCE(a.assessment_passed_flag, FALSE)` |
| 07 | `hai_[slug]_first_task_claimed` | `first_claimed_at_pst` | `IS NOT NULL` |
| 08 | `hai_[slug]_first_task_submitted` | `first_task_submitted_pst` | `IS NOT NULL` |
| 09 | `hai_[slug]_offboarded` | `offboarded` | `= TRUE` |

Events 03-06 require the optional `assessments` CTE. If the project has no assessment, omit the CTE and events 03-06.

---

## Fivetran Sync Query Template (HAI-Only)

```sql
-- [Project Name] Drip — single Fivetran sync query
-- Fivetran sync query — runs from handshake-production
-- query_date: YYYY-MM-DD
-- project_id: [UUID]
-- Sync key: event_id
WITH assessments AS (
    -- OPTIONAL: include only if project has an assessment
    -- Replace form_definition_id with the project's assessment form ID
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
),
base AS (
    SELECT DISTINCT
        f.profile_id,
        f.email,
        f.profile_status,
        ap.status AS project_status,
        dim.current_onboarding_stage,
        ug.last_touch_utm_source,
        CAST(fs.last_activity AS DATE) AS last_activity,
        f.offboarded,

        f.pso_allocated_pst IS NOT NULL                   AS pso_allocated_flag,
        f.pso_invitation_accepted_pst IS NOT NULL         AS pso_accepted_flag,
        f.canvas_assessment_first_started_pst IS NOT NULL AS assessment_started_flag,
        COALESCE(a.assessment_submitted_flag, FALSE)      AS assessment_submitted_flag,
        COALESCE(a.assessment_graded_flag, FALSE)         AS assessment_graded_flag,
        COALESCE(a.assessment_passed_flag, FALSE)         AS assessment_passed_flag,
        f.first_claimed_at_pst IS NOT NULL                AS first_task_claimed_flag,
        f.first_task_submitted_pst IS NOT NULL            AS first_task_submitted_flag

    FROM `handshake-production.hai_dev.fact_project_funnel` f
    JOIN `handshake-production.hai_public.annotation_projects` ap
      ON ap.id = f.project_id
    LEFT JOIN `handshake-production.hai_dev.hai_profiles_dim` dim
      ON f.profile_id = dim.profile_id
    LEFT JOIN `handshake-production.hai_dev.hai_user_growth_dim` ug
      ON f.profile_id = ug.user_id
    LEFT JOIN assessments a
      ON f.profile_id = a.profile_id
    LEFT JOIN `handshake-production.hai_dev.fact_fellow_status` fs
      ON f.profile_id = fs.profile_id
    WHERE f.project_id = '[project_id]'
      AND ap.status = 'active'
      AND f.pso_allocated_pst IS NOT NULL
)

SELECT TO_HEX(MD5(CONCAT(profile_id, '-hai_[slug]_pso_allocated')))        AS event_id, 'hai_[slug]_pso_allocated'        AS event_name, profile_id, email, profile_status, current_onboarding_stage, last_touch_utm_source, last_activity FROM base WHERE pso_allocated_flag        = TRUE
UNION ALL
SELECT TO_HEX(MD5(CONCAT(profile_id, '-hai_[slug]_pso_accepted')))         AS event_id, 'hai_[slug]_pso_accepted'         AS event_name, profile_id, email, profile_status, current_onboarding_stage, last_touch_utm_source, last_activity FROM base WHERE pso_accepted_flag         = TRUE
UNION ALL
SELECT TO_HEX(MD5(CONCAT(profile_id, '-hai_[slug]_assessment_started')))   AS event_id, 'hai_[slug]_assessment_started'   AS event_name, profile_id, email, profile_status, current_onboarding_stage, last_touch_utm_source, last_activity FROM base WHERE assessment_started_flag   = TRUE
UNION ALL
SELECT TO_HEX(MD5(CONCAT(profile_id, '-hai_[slug]_assessment_submitted'))) AS event_id, 'hai_[slug]_assessment_submitted' AS event_name, profile_id, email, profile_status, current_onboarding_stage, last_touch_utm_source, last_activity FROM base WHERE assessment_submitted_flag = TRUE
UNION ALL
SELECT TO_HEX(MD5(CONCAT(profile_id, '-hai_[slug]_assessment_graded')))    AS event_id, 'hai_[slug]_assessment_graded'    AS event_name, profile_id, email, profile_status, current_onboarding_stage, last_touch_utm_source, last_activity FROM base WHERE assessment_graded_flag    = TRUE
UNION ALL
SELECT TO_HEX(MD5(CONCAT(profile_id, '-hai_[slug]_assessment_passed')))    AS event_id, 'hai_[slug]_assessment_passed'    AS event_name, profile_id, email, profile_status, current_onboarding_stage, last_touch_utm_source, last_activity FROM base WHERE assessment_passed_flag    = TRUE
UNION ALL
SELECT TO_HEX(MD5(CONCAT(profile_id, '-hai_[slug]_first_task_claimed')))   AS event_id, 'hai_[slug]_first_task_claimed'   AS event_name, profile_id, email, profile_status, current_onboarding_stage, last_touch_utm_source, last_activity FROM base WHERE first_task_claimed_flag   = TRUE
UNION ALL
SELECT TO_HEX(MD5(CONCAT(profile_id, '-hai_[slug]_first_task_submitted'))) AS event_id, 'hai_[slug]_first_task_submitted' AS event_name, profile_id, email, profile_status, current_onboarding_stage, last_touch_utm_source, last_activity FROM base WHERE first_task_submitted_flag = TRUE
UNION ALL
SELECT TO_HEX(MD5(CONCAT(profile_id, '-hai_[slug]_offboarded')))           AS event_id, 'hai_[slug]_offboarded'           AS event_name, profile_id, email, profile_status, current_onboarding_stage, last_touch_utm_source, last_activity FROM base WHERE offboarded               = TRUE
```

### BQ Analysis Query

Same template — swap `handshake-production` to `hs-ai-production` for all table references.

---

## Otter Extension

For projects that use Feather/Otter for screener and/or production tasking, add Otter screener step events and production events as additional UNION ALL arms.

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

| task_batch | Type | Threshold | Events generated |
|------------|------|-----------|-----------------|
| Step 1: Instruction Quiz | claimed | — | `hai_[slug]_instruction_quiz_claimed` |
| Step 2: Coarse comparisons | completed_all | >= 14 | `hai_[slug]_coarse_comparisons_started` + `hai_[slug]_coarse_comparisons_completed` |
| Step 3: Mock Tasks | completed_all | >= 12 | `hai_[slug]_mock_tasks_started` + `hai_[slug]_mock_tasks_completed` |

### Step 2 — Auto-discover production task batches

Run this to identify post-onboarding vs production batches:

```sql
SELECT DISTINCT task_batch
FROM `hs-ai-production.hai_dev.fact_otter_task_activity`
WHERE campaign = '[production_campaign]'
ORDER BY task_batch
```

Production tasks = everything that is NOT a post-onboarding batch. Filter: `LOWER(task_batch) NOT LIKE '%post-onboarding%'`

### Otter Events

**Screener events** (one `_claimed` or `_started` + `_completed` pair per step):

| Event pattern | Logic |
|---------------|-------|
| `hai_[slug]_[step]_claimed` | `MIN(created_at WHERE task_batch = '[batch]') IS NOT NULL` |
| `hai_[slug]_[step]_started` | `MIN(created_at WHERE task_batch = '[batch]') IS NOT NULL` |
| `hai_[slug]_[step]_completed` | `COUNTIF(task_batch = '[batch]' AND activity_type = 'completed') >= [threshold]` |

**Production events:**

| Event | Logic |
|-------|-------|
| `hai_[slug]_allocated_to_production` | Has any activity in production campaign (BQ proxy) |
| `hai_[slug]_production_task_claimed` | `COUNTIF(non-post-onboarding tasks) > 0` |
| `hai_[slug]_production_task_submitted` | `COUNTIF(non-post-onboarding AND activity_type = 'completed') > 0` |

### BQ vs Fivetran difference for Otter

- **BQ query** uses `hs-ai-production.hai_dev.fact_otter_task_activity` — `allocated_to_screener/production` means "has any activity" (does not capture allocated-but-never-started)
- **Fivetran query** uses `handshake-production.hai_public.otter_campaign_user_allocations` — true allocation timestamp, captures everyone including never-started

### Fivetran Sync Query Template (HAI + Otter)

```sql
-- [Project Name] Drip — single Fivetran sync query (HAI + Otter)
-- Fivetran sync query — runs from handshake-production
-- query_date: YYYY-MM-DD
-- HAI project_id: [UUID]
-- Otter screener campaign: [campaign_name]
-- Otter production campaign: [campaign_name]
-- Sync key: event_id
WITH assessments AS (
    -- OPTIONAL: include only if project has an assessment
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
),
base AS (
    SELECT DISTINCT
        f.profile_id,
        f.email,
        f.profile_status,
        ap.status AS project_status,
        dim.current_onboarding_stage,
        ug.last_touch_utm_source,
        CAST(fs.last_activity AS DATE) AS last_activity,
        f.offboarded,

        f.pso_allocated_pst IS NOT NULL                   AS pso_allocated_flag,
        f.pso_invitation_accepted_pst IS NOT NULL         AS pso_accepted_flag,
        f.canvas_assessment_first_started_pst IS NOT NULL AS assessment_started_flag,
        COALESCE(a.assessment_submitted_flag, FALSE)      AS assessment_submitted_flag,
        COALESCE(a.assessment_graded_flag, FALSE)         AS assessment_graded_flag,
        COALESCE(a.assessment_passed_flag, FALSE)         AS assessment_passed_flag,
        f.first_claimed_at_pst IS NOT NULL                AS first_task_claimed_flag,
        f.first_task_submitted_pst IS NOT NULL            AS first_task_submitted_flag

    FROM `handshake-production.hai_dev.fact_project_funnel` f
    JOIN `handshake-production.hai_public.annotation_projects` ap
      ON ap.id = f.project_id
    LEFT JOIN `handshake-production.hai_dev.hai_profiles_dim` dim
      ON f.profile_id = dim.profile_id
    LEFT JOIN `handshake-production.hai_dev.hai_user_growth_dim` ug
      ON f.profile_id = ug.user_id
    LEFT JOIN assessments a
      ON f.profile_id = a.profile_id
    LEFT JOIN `handshake-production.hai_dev.fact_fellow_status` fs
      ON f.profile_id = fs.profile_id
    WHERE f.project_id = '[project_id]'
      AND ap.status = 'active'
      AND f.pso_allocated_pst IS NOT NULL
),
screener_otter AS (
    SELECT
        fl.profile_id,
        -- One block per screener step — customise batch names and thresholds
        MIN(CASE WHEN th.task_batch = '[Step 1 batch name]' THEN th.created_at END) IS NOT NULL
            AS [step1_slug]_claimed_flag,
        MIN(CASE WHEN th.task_batch = '[Step 2 batch name]' THEN th.created_at END) IS NOT NULL
            AS [step2_slug]_started_flag,
        COUNTIF(th.task_batch = '[Step 2 batch name]' AND th.status = 'completed') >= [N]
            AS [step2_slug]_completed_flag,
        MIN(CASE WHEN th.task_batch = '[Step 3 batch name]' THEN th.created_at END) IS NOT NULL
            AS [step3_slug]_started_flag,
        COUNTIF(th.task_batch = '[Step 3 batch name]' AND th.status = 'completed') >= [N]
            AS [step3_slug]_completed_flag
    FROM `handshake-production.hai_public.otter_campaign_user_allocations` AS cua
    JOIN `handshake-production.hai_public.otter_users` AS u ON u.email = cua.user
    LEFT JOIN `handshake-production.hai_dev.fact_otter_email_mapping` AS fl ON fl.email = u.email
    LEFT JOIN `handshake-production.hai_public.otter_task_status_history` AS th
      ON th.email = cua.user
      AND th.campaign = '[screener_campaign]'
    WHERE cua.campaign = '[screener_campaign]'
      AND fl.profile_id IS NOT NULL
    GROUP BY fl.profile_id
),
production_otter AS (
    SELECT
        fl.profile_id,
        TRUE AS allocated_to_production_flag,
        COUNTIF(LOWER(th.task_batch) NOT LIKE '%post-onboarding%') > 0
            AS production_task_claimed_flag,
        COUNTIF(LOWER(th.task_batch) NOT LIKE '%post-onboarding%' AND th.status = 'completed') > 0
            AS production_task_submitted_flag
    FROM `handshake-production.hai_public.otter_campaign_user_allocations` AS cua
    JOIN `handshake-production.hai_public.otter_users` AS u ON u.email = cua.user
    LEFT JOIN `handshake-production.hai_dev.fact_otter_email_mapping` AS fl ON fl.email = u.email
    LEFT JOIN `handshake-production.hai_public.otter_task_status_history` AS th
      ON th.email = cua.user
      AND th.campaign = '[production_campaign]'
    WHERE cua.campaign = '[production_campaign]'
      AND fl.profile_id IS NOT NULL
    GROUP BY fl.profile_id
)

-- HAI funnel events
SELECT TO_HEX(MD5(CONCAT(profile_id, '-hai_[slug]_pso_allocated')))        AS event_id, 'hai_[slug]_pso_allocated'        AS event_name, profile_id, email, profile_status, current_onboarding_stage, last_touch_utm_source, last_activity FROM base WHERE pso_allocated_flag        = TRUE
UNION ALL
SELECT TO_HEX(MD5(CONCAT(profile_id, '-hai_[slug]_pso_accepted')))         AS event_id, 'hai_[slug]_pso_accepted'         AS event_name, profile_id, email, profile_status, current_onboarding_stage, last_touch_utm_source, last_activity FROM base WHERE pso_accepted_flag         = TRUE
UNION ALL
SELECT TO_HEX(MD5(CONCAT(profile_id, '-hai_[slug]_assessment_started')))   AS event_id, 'hai_[slug]_assessment_started'   AS event_name, profile_id, email, profile_status, current_onboarding_stage, last_touch_utm_source, last_activity FROM base WHERE assessment_started_flag   = TRUE
UNION ALL
SELECT TO_HEX(MD5(CONCAT(profile_id, '-hai_[slug]_assessment_submitted'))) AS event_id, 'hai_[slug]_assessment_submitted' AS event_name, profile_id, email, profile_status, current_onboarding_stage, last_touch_utm_source, last_activity FROM base WHERE assessment_submitted_flag = TRUE
UNION ALL
SELECT TO_HEX(MD5(CONCAT(profile_id, '-hai_[slug]_assessment_graded')))    AS event_id, 'hai_[slug]_assessment_graded'    AS event_name, profile_id, email, profile_status, current_onboarding_stage, last_touch_utm_source, last_activity FROM base WHERE assessment_graded_flag    = TRUE
UNION ALL
SELECT TO_HEX(MD5(CONCAT(profile_id, '-hai_[slug]_assessment_passed')))    AS event_id, 'hai_[slug]_assessment_passed'    AS event_name, profile_id, email, profile_status, current_onboarding_stage, last_touch_utm_source, last_activity FROM base WHERE assessment_passed_flag    = TRUE
UNION ALL
SELECT TO_HEX(MD5(CONCAT(profile_id, '-hai_[slug]_first_task_claimed')))   AS event_id, 'hai_[slug]_first_task_claimed'   AS event_name, profile_id, email, profile_status, current_onboarding_stage, last_touch_utm_source, last_activity FROM base WHERE first_task_claimed_flag   = TRUE
UNION ALL
SELECT TO_HEX(MD5(CONCAT(profile_id, '-hai_[slug]_first_task_submitted'))) AS event_id, 'hai_[slug]_first_task_submitted' AS event_name, profile_id, email, profile_status, current_onboarding_stage, last_touch_utm_source, last_activity FROM base WHERE first_task_submitted_flag = TRUE
UNION ALL
SELECT TO_HEX(MD5(CONCAT(profile_id, '-hai_[slug]_offboarded')))           AS event_id, 'hai_[slug]_offboarded'           AS event_name, profile_id, email, profile_status, current_onboarding_stage, last_touch_utm_source, last_activity FROM base WHERE offboarded               = TRUE
UNION ALL
-- Otter screener events (one block per step — customise)
SELECT TO_HEX(MD5(CONCAT(so.profile_id, '-hai_[slug]_[step1_slug]_claimed')))   AS event_id, 'hai_[slug]_[step1_slug]_claimed'   AS event_name, so.profile_id, b.email, b.profile_status, b.current_onboarding_stage, b.last_touch_utm_source, b.last_activity FROM screener_otter so JOIN base b ON so.profile_id = b.profile_id WHERE so.[step1_slug]_claimed_flag   = TRUE
UNION ALL
SELECT TO_HEX(MD5(CONCAT(so.profile_id, '-hai_[slug]_[step2_slug]_started')))   AS event_id, 'hai_[slug]_[step2_slug]_started'   AS event_name, so.profile_id, b.email, b.profile_status, b.current_onboarding_stage, b.last_touch_utm_source, b.last_activity FROM screener_otter so JOIN base b ON so.profile_id = b.profile_id WHERE so.[step2_slug]_started_flag   = TRUE
UNION ALL
SELECT TO_HEX(MD5(CONCAT(so.profile_id, '-hai_[slug]_[step2_slug]_completed'))) AS event_id, 'hai_[slug]_[step2_slug]_completed' AS event_name, so.profile_id, b.email, b.profile_status, b.current_onboarding_stage, b.last_touch_utm_source, b.last_activity FROM screener_otter so JOIN base b ON so.profile_id = b.profile_id WHERE so.[step2_slug]_completed_flag = TRUE
UNION ALL
SELECT TO_HEX(MD5(CONCAT(so.profile_id, '-hai_[slug]_[step3_slug]_started')))   AS event_id, 'hai_[slug]_[step3_slug]_started'   AS event_name, so.profile_id, b.email, b.profile_status, b.current_onboarding_stage, b.last_touch_utm_source, b.last_activity FROM screener_otter so JOIN base b ON so.profile_id = b.profile_id WHERE so.[step3_slug]_started_flag   = TRUE
UNION ALL
SELECT TO_HEX(MD5(CONCAT(so.profile_id, '-hai_[slug]_[step3_slug]_completed'))) AS event_id, 'hai_[slug]_[step3_slug]_completed' AS event_name, so.profile_id, b.email, b.profile_status, b.current_onboarding_stage, b.last_touch_utm_source, b.last_activity FROM screener_otter so JOIN base b ON so.profile_id = b.profile_id WHERE so.[step3_slug]_completed_flag = TRUE
UNION ALL
-- Otter production events
SELECT TO_HEX(MD5(CONCAT(po.profile_id, '-hai_[slug]_allocated_to_production')))    AS event_id, 'hai_[slug]_allocated_to_production'    AS event_name, po.profile_id, b.email, b.profile_status, b.current_onboarding_stage, b.last_touch_utm_source, b.last_activity FROM production_otter po JOIN base b ON po.profile_id = b.profile_id WHERE po.allocated_to_production_flag    = TRUE
UNION ALL
SELECT TO_HEX(MD5(CONCAT(po.profile_id, '-hai_[slug]_production_task_claimed')))    AS event_id, 'hai_[slug]_production_task_claimed'    AS event_name, po.profile_id, b.email, b.profile_status, b.current_onboarding_stage, b.last_touch_utm_source, b.last_activity FROM production_otter po JOIN base b ON po.profile_id = b.profile_id WHERE po.production_task_claimed_flag    = TRUE
UNION ALL
SELECT TO_HEX(MD5(CONCAT(po.profile_id, '-hai_[slug]_production_task_submitted')))  AS event_id, 'hai_[slug]_production_task_submitted'  AS event_name, po.profile_id, b.email, b.profile_status, b.current_onboarding_stage, b.last_touch_utm_source, b.last_activity FROM production_otter po JOIN base b ON po.profile_id = b.profile_id WHERE po.production_task_submitted_flag  = TRUE
```

---

## Notes

- **All flags are independently computed — no ordering is enforced.** A fellow can reach a later milestone without an earlier one being TRUE. This is intentional: show the truth, let the drip campaign logic define its own filter.
- **Completion thresholds:** `COUNTIF >= N` thresholds are project-specific. Always confirm with the user or inspect the data before hardcoding.
- **Otter allocated_to_production (BQ):** The BQ query uses `fact_otter_task_activity` — "allocated" means "has any activity". Fellows who were allocated but never touched the screener won't appear. Use the Fivetran query with `otter_campaign_user_allocations` for true allocation counts.
- **Profile ID type:** `profile_id` is a UUID string in all tables — do not cast to INTEGER.
- **Duplicate emails:** Some profile_ids have multiple emails in `fact_otter_task_activity`. Always `GROUP BY profile_id` only (not profile_id + email) in Otter CTEs.
- **Real vs anonymised email:** Otter-side emails may be anonymised (`@handshakecommunity.ai`). Always prefer `fpf.email` from `fact_project_funnel` via `COALESCE(fpf.email, otter_email)`.
- **Extending with custom events:** Add more UNION ALL arms with the same 8-column signature. The `event_id` hash ensures uniqueness as long as the `event_name` literal is unique per profile.
