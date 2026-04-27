# Dimension & Public Table Schemas

**Use this file to look up exact column names, types, and join keys for dimension and public tables (profiles, resumes, growth dim). Never guess column names — find them here first. If a column isn't listed, call `mcp__bigquery__describe-table` with `table_name="dataset.table"` (e.g. `hai_public.profiles`) to verify against the live schema.**

## Dimension Tables

### hai_profiles_dim

**Fully-qualified name:** `hs-ai-production.hai_dev.hai_profiles_dim`
**Grain:** One row per fellow profile
**Updates:** Hourly
**Purpose:** Profile dimension with education, domain, institution, and onboarding details. Use this when you need fellow metadata for filtering or joining.

#### Columns

| Column | Type | Description |
|--------|------|-------------|
| profile_id | STRING (UUID) | Primary Key — joins to all fact tables |
| email | STRING | Fellow's email |
| secondary_email | STRING | Secondary/alternate email |
| first_name | STRING | First name |
| last_name | STRING | Last name |
| status | STRING | Profile status (`verified`, `pending`, etc.) |
| current_onboarding_stage | STRING | `fully-onboarded`, `pending`, etc. |
| applied_at | TIMESTAMP | When fellow applied |
| conversion_timestamp | TIMESTAMP | When fellow converted (completed onboarding) |
| highest_education_level | STRING | `Doctorate`, `Master's`, `Bachelor's`, etc. |
| graduate_institution_name | STRING | Graduate school name |
| undergraduate_institution_name | STRING | Undergraduate school name |
| domain | STRING | System-classified expertise domain |
| subdomain | STRING | System-classified subdomain |
| major | STRING | Fellow's major |
| major_group | STRING | Grouped major category |
| degree_in_progress | BOOLEAN | Whether degree is in progress |
| authorized_to_work_us | STRING | Whether fellow is authorized to work in the US (string value, not boolean) |
| state_code | STRING | Fellow's state (e.g., `CA`, `NY`) |
| country_code | STRING | Fellow's country code (e.g., `US`, `IN`) |
| active_project_id | STRING | Currently assigned project ID |
| active_project_name | STRING | Currently assigned project name |
| all_projects_and_roles | STRING | All projects and roles (comma-separated or JSON) |
| completed_tasks | INTEGER | Total completed tasks across projects |
| resume_url_in_product | STRING | URL to resume in product |
| resume_url_typescript | STRING | URL to resume (TypeScript variant) |
| referrer | STRING | How the fellow was referred |
| research | STRING | Research interests or background |

#### Key Joins
- `profile_id` → `fact_fellow_perf.profile_id`
- `profile_id` → `fact_project_funnel.profile_id`
- `profile_id` → `hai_public.resumes.profileId` (both are STRING UUIDs; note camelCase on resumes side)
- `profile_id` → `hai_user_growth_dim.profile_id`

#### Common Patterns

**Find Fellows by Education Level & Institution:**
```sql
SELECT profile_id, email, first_name, last_name,
  highest_education_level, graduate_institution_name,
  domain, subdomain, major
FROM `hs-ai-production.hai_dev.hai_profiles_dim`
WHERE highest_education_level = 'Doctorate'
  AND graduate_institution_name IN ('MIT', 'Harvard University', 'Stanford University')
  AND NOT LOWER(email) LIKE '%@joinhandshake.com%'
```

**Filter Verified & Onboarded Fellows:**
```sql
SELECT profile_id, email, first_name, last_name, domain, subdomain
FROM `hs-ai-production.hai_dev.hai_profiles_dim`
WHERE LOWER(status) = 'verified'
  AND LOWER(current_onboarding_stage) = 'fully-onboarded'
  AND NOT LOWER(email) LIKE '%@joinhandshake.com%'
```

**Filter by Geography:**
```sql
SELECT profile_id, email, first_name, last_name, state_code, country_code, domain
FROM `hs-ai-production.hai_dev.hai_profiles_dim`
WHERE country_code = 'US'
  AND state_code IN ('CA', 'NY', 'TX')
  AND LOWER(status) = 'verified'
  AND NOT LOWER(email) LIKE '%@joinhandshake.com%'
```

**Find Fellows by Active Project Assignment:**
```sql
SELECT profile_id, email, first_name, last_name,
  active_project_id, active_project_name, completed_tasks
FROM `hs-ai-production.hai_dev.hai_profiles_dim`
WHERE active_project_name IS NOT NULL
  AND NOT LOWER(email) LIKE '%@joinhandshake.com%'
ORDER BY completed_tasks DESC
```

**Show Fellow's Resume (URL in Product):**
```sql
SELECT
  profile_id, email, first_name, last_name,
  resume_url_in_product
FROM `hs-ai-production.hai_dev.hai_profiles_dim`
WHERE LOWER(email) = LOWER(@email)
  AND resume_url_in_product IS NOT NULL
```

**Join with Resumes:**
```sql
SELECT
  p.profile_id, p.email, p.first_name, p.last_name,
  p.highest_education_level,
  COALESCE(p.graduate_institution_name, p.undergraduate_institution_name) AS school_name,
  p.domain, p.subdomain,
  r.id AS resume_id,
  TO_JSON_STRING(r.parsed_data) AS parsed_resume
FROM `hs-ai-production.hai_dev.hai_profiles_dim` p
JOIN `hs-ai-production.hai_public.resumes` r
  ON p.profile_id = r.profileId
WHERE r.status = 'PROCESSED'
  AND r.parsed_data IS NOT NULL
```

---

### hai_user_growth_dim

**Fully-qualified name:** `hs-ai-production.hai_dev.hai_user_growth_dim`
**Grain:** One row per fellow
**Updates:** Hourly
**Purpose:** Growth dimension with onboarding stage, status, and education details. Similar to hai_profiles_dim but oriented toward growth tracking.

#### Columns

| Column | Type | Description |
|--------|------|-------------|
| profile_id | INTEGER | Primary Key |
| email | STRING | Fellow's email |
| first_name | STRING | First name |
| last_name | STRING | Last name |
| status | STRING | Profile status |
| current_onboarding_stage | STRING | Onboarding stage |
| domain | STRING | Expertise domain |
| subdomain | STRING | Expertise subdomain |
| highest_education_level | STRING | Education level |
| graduate_institution_name | STRING | Graduate school |
| undergraduate_institution_name | STRING | Undergraduate school |

#### Key Joins
- `profile_id` → `hai_profiles_dim.profile_id`
- `profile_id` → `hai_public.resumes.profileId`

#### Common Patterns

**Join with Resumes for Keyword Search:**
```sql
SELECT
  u.profile_id, u.email, u.first_name, u.last_name,
  u.status, u.current_onboarding_stage,
  u.domain, u.subdomain, u.highest_education_level,
  u.graduate_institution_name, u.undergraduate_institution_name,
  r.id AS resume_id,
  TO_JSON_STRING(r.parsed_data) AS parsed_resume
FROM `hs-ai-production.hai_dev.hai_user_growth_dim` u
LEFT JOIN `hs-ai-production.hai_public.resumes` r
  ON u.profile_id = r.profileId
WHERE r.status = 'PROCESSED'
  AND NOT LOWER(u.email) LIKE '%@joinhandshake.com%'
```

---

## Public Tables

### resumes

**Fully-qualified name:** `hs-ai-production.hai_public.resumes`
**Type:** VIEW (wraps `handshake-production.hai_public.resumes` via Datastream)
**Grain:** One row per resume (~523k rows, ~90% PROCESSED)
**Purpose:** Parsed resume data with structured JSON content

#### Columns

| Column | Type | Description |
|--------|------|-------------|
| id | STRING (UUID) | Resume ID |
| profileId | STRING (UUID) | Profile ID (**camelCase** — joins to `profile_id` in dim tables) |
| status | STRING | `PROCESSED`, `PENDING`, `FAILED` |
| parsed_data | JSON | Structured resume content (full parse) |
| short_parsed_data | JSON | Lightweight parsed demographics (available before full processing) |
| s3_file_key | STRING | S3 storage key for the resume file |
| file_path | STRING | File path of the uploaded resume |
| created_at | TIMESTAMP | Upload timestamp |
| updated_at | TIMESTAMP | Last update timestamp |
| duplicated_to_core_at | TIMESTAMP | When resume was duplicated to core system |
| core_resume_id | STRING | Resume ID in the core system |

#### parsed_data JSON Structure

The `parsed_data` field contains structured resume content. All 8 top-level keys are always present (but may be `null`).

| Field | Structure | Population | Notes |
|-------|-----------|------------|-------|
| **education** | `[{school, degree, fieldOfStudy, gpa, graduation_date}]` | 96% | Most reliable field |
| **experience** | `[{company, position, description, achievements[], start_date, end_date}]` | 95% | `achievements` is an array of bullet strings |
| **summary** | `string` | 95% | Free-text resume summary |
| **certifications** | `[string]` | 90% | Often present but `null` inside |
| **skills** | `[string]` | ~95% | Flat array of skill strings |
| **personal_information** | `{name, email, phone, location}` | ~100% | `name` is often `null`; `location` is typically a state abbreviation |
| **languages** | `[{language, proficiency}]` | 34% | **Only 1 in 3 resumes** — NOT plain strings, each is an object |
| **projects** | `[{name, description, technologies[], start_date, end_date}]` | 28% | **Only 1 in 4 resumes** — `technologies` is an array of strings |

> **Note:** `suggestedDomain` is NOT in `parsed_data` — it lives in `short_parsed_data`.

#### short_parsed_data JSON Structure

The `short_parsed_data` field is a lightweight demographics extract. Populated on ~72% of resumes (375k of 523k). **Not always available** — 96k processed resumes have `parsed_data` but no `short_parsed_data`. Fields:

| Field | Type | Description |
|-------|------|-------------|
| firstName | string | First name |
| lastName | string | Last name |
| fullName | string | Full name |
| email | string | Email address |
| phone | string | Phone number |
| country | string | Country |
| state | string | State/province |
| graduationYear | string | Most recent graduation year |
| highestEducationLevel | string | Highest education level |
| mostRecentInstitution | string | Most recent school/university |
| hasTeachingExperience | boolean | Whether resume mentions teaching |
| spokenLanguages | array | Languages spoken |
| suggestedDomain | string | AI-suggested expertise domain |
| suggestedSubdomains | array | AI-suggested subdomains |

#### JSON Extraction Patterns

```sql
-- Extract as full JSON string for text search
TO_JSON_STRING(r.parsed_data) AS parsed_resume

-- Extract specific scalar values from parsed_data
JSON_EXTRACT_SCALAR(r.parsed_data, '$.education[0].school') AS school
JSON_EXTRACT_SCALAR(r.parsed_data, '$.education[0].degree') AS degree
JSON_EXTRACT_SCALAR(r.parsed_data, '$.education[0].fieldOfStudy') AS field_of_study
JSON_EXTRACT_SCALAR(r.parsed_data, '$.education[0].graduation_date') AS grad_date

-- Extract language with proficiency (only 34% of resumes have languages)
JSON_EXTRACT_SCALAR(r.parsed_data, '$.languages[0].language') AS language
JSON_EXTRACT_SCALAR(r.parsed_data, '$.languages[0].proficiency') AS proficiency

-- Extract experience fields
JSON_EXTRACT_SCALAR(r.parsed_data, '$.experience[0].company') AS company
JSON_EXTRACT_SCALAR(r.parsed_data, '$.experience[0].position') AS position
JSON_EXTRACT_SCALAR(r.parsed_data, '$.experience[0].description') AS description
JSON_EXTRACT_SCALAR(r.parsed_data, '$.experience[0].start_date') AS start_date
JSON_EXTRACT(r.parsed_data, '$.experience[0].achievements') AS achievements

-- Extract project fields (only 28% of resumes have projects)
JSON_EXTRACT_SCALAR(r.parsed_data, '$.projects[0].name') AS project_name
JSON_EXTRACT_SCALAR(r.parsed_data, '$.projects[0].description') AS project_desc
JSON_EXTRACT(r.parsed_data, '$.projects[0].technologies') AS technologies

-- Extract personal information
JSON_EXTRACT_SCALAR(r.parsed_data, '$.personal_information.name') AS pi_name
JSON_EXTRACT_SCALAR(r.parsed_data, '$.personal_information.email') AS pi_email
JSON_EXTRACT_SCALAR(r.parsed_data, '$.personal_information.phone') AS pi_phone
JSON_EXTRACT_SCALAR(r.parsed_data, '$.personal_information.location') AS pi_location

-- Extract summary
JSON_EXTRACT_SCALAR(r.parsed_data, '$.summary') AS resume_summary

-- Extract from short_parsed_data (lightweight demographics)
JSON_EXTRACT_SCALAR(r.short_parsed_data, '$.suggestedDomain') AS suggested_domain
JSON_EXTRACT_SCALAR(r.short_parsed_data, '$.fullName') AS full_name
JSON_EXTRACT_SCALAR(r.short_parsed_data, '$.highestEducationLevel') AS education_level
JSON_EXTRACT_SCALAR(r.short_parsed_data, '$.mostRecentInstitution') AS institution
JSON_EXTRACT_SCALAR(r.short_parsed_data, '$.graduationYear') AS grad_year
JSON_EXTRACT_SCALAR(r.short_parsed_data, '$.country') AS country
JSON_EXTRACT_SCALAR(r.short_parsed_data, '$.state') AS state
JSON_EXTRACT(r.short_parsed_data, '$.suggestedSubdomains') AS suggested_subdomains

-- Full-text keyword search in resume
LOWER(TO_JSON_STRING(r.parsed_data)) LIKE '%keyword%'

-- Character count for content validation
LENGTH(TO_JSON_STRING(r.parsed_data)) AS resume_character_count
```

#### Important Notes
- Always filter `status = 'PROCESSED'` — only processed resumes have usable parsed_data (~90% of rows)
- ~10% of resumes are stuck in `PROCESSING` (51k rows) — these have no parsed_data
- `short_parsed_data` is populated on ~72% of resumes. It is NOT a superset of `parsed_data` — ~96k processed resumes have `parsed_data` but no `short_parsed_data`. Always check for NULL.
- Join key is `profileId` (camelCase, STRING UUID) → `profile_id` (STRING UUID) in dimension tables
- `parsed_data IS NOT NULL` to ensure resume was actually parsed
- Multiple resumes per profile are possible — use `ORDER BY updated_at DESC LIMIT 1` for latest
- `s3_file_key` is only populated on ~15% of resumes; `file_path` is always populated (format: `resume/{timestamp}-{profileId}-{random}.pdf`)
- `core_resume_id` is effectively unused (~0% populated)
- `languages` and `projects` are the sparsest parsed_data fields (34% and 28%) — don't assume they exist. Always guard with `IS NOT NULL`.
- All `parsed_data` top-level keys are always present but may contain `null` — check for both `IS NOT NULL` and `!= 'null'` when using `JSON_EXTRACT` (or use `JSON_EXTRACT_SCALAR` which returns NULL for JSON `null`)
- For keyword search, `TO_JSON_STRING(parsed_data)` is the most reliable approach — it searches across all fields including experience, education, skills, and summary
- `personal_information.name` is often `null` even when the resume is fully parsed — prefer `short_parsed_data.fullName` for names, or use dim table `first_name`/`last_name`

---

### profiles

**Fully-qualified name:** `hs-ai-production.hai_public.profiles`
**Grain:** One row per profile
**Purpose:** Base profile data from the platform

#### Columns

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Profile ID |
| email | STRING | Fellow's email |
| full_name | STRING | Full name |
| status | STRING | Profile status |
| onboarding_stage | STRING | Current onboarding stage |

#### Key Joins
- `id` → `hai_public.tasks.profile_id`
- `id` → `hai_profiles_dim.profile_id`

---

### tasks

**Fully-qualified name:** `hs-ai-production.hai_public.tasks`
**Grain:** One row per task
**Purpose:** Raw task data from the annotation platform

#### Columns

| Column | Type | Description |
|--------|------|-------------|
| id | STRING | Task ID |
| status | STRING | Task status |
| priority | INTEGER | Task priority |
| archived | BOOLEAN | Is archived |
| escalated | BOOLEAN | Is escalated |
| annotation_project_id | STRING | Annotation project ID |
| pipeline_stage_id | INTEGER | Pipeline stage ID |
| profile_id | INTEGER | Assigned fellow's profile ID |
| data | JSON | Raw task data payload |
| created_at | TIMESTAMP | Task creation timestamp |
| updated_at | TIMESTAMP | Last update timestamp |

#### Key Joins
- `profile_id` → `hai_public.profiles.id`
- `annotation_project_id` → project identifier

#### Common Patterns

**Task Overview for a Project:**
```sql
SELECT
  t.id AS task_id,
  t.status,
  t.priority,
  t.archived,
  t.escalated,
  t.pipeline_stage_id,
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
