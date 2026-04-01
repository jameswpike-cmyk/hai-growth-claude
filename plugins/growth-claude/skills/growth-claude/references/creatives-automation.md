# Paid Ads Creative Automation

Automates the Meta paid ads creative workflow — reads a Google Sheet, generates Figma ad creatives via text substitution, exports as PNG, and saves to Google Drive.

## What it replaces

Previously done manually:
1. Duplicate existing Meta campaign in Ads Manager
2. Update campaign / ad set / ad names
3. Open Figma → change headline text (e.g. "Godot" → "Game developer")
4. Apply sentence case, update sub-headline
5. Export as PNG
6. Upload PNG to Meta, update primary text and targeting

## How it works now

```
Google Sheet (input)
      ↓
Claude Code reads pending rows via Sheets API (gcloud credentials)
      ↓
Figma MCP — clone existing template → swap Subhead + CTA text only
      ↓
Figma REST API — export frame as 2x PNG
      ↓
Google Drive API — save PNG to growth-creatives-export folder
      ↓
Generated frame persists on _growth_creatives page in Figma
```

## Run it

```
/generate-creatives https://docs.google.com/spreadsheets/d/1e6SfbtyqZLmEElX0PlTW0bVuAOAods4U2eTn8lQICtM/edit
```

Or for a specific row:
```
/generate-creatives https://docs.google.com/spreadsheets/d/1e6SfbtyqZLmEElX0PlTW0bVuAOAods4U2eTn8lQICtM/edit row=3
```

## Google Sheet

**Link:** [growth-marketing-creatives](https://docs.google.com/spreadsheets/d/1e6SfbtyqZLmEElX0PlTW0bVuAOAods4U2eTn8lQICtM/edit)

| Col | Name | Notes |
|-----|------|-------|
| A | Status | `pending` → processed; auto-set to `done` |
| B | HAI Project | e.g. `Game developer` → used as `{hai_project}` |
| C | Dimensions | `1x1`, `4x5`, `9x16`, `16x9`, or `all` |
| D | Color | `Dusk`, `Lime`, `Green`, `Mixed`, or `Moonstone` |
| E | Sub-headline | Template string, e.g. `{hai_project}: Earn {hourly_rate}` |
| F | Hourly Rate | e.g. `$75/hr` → used as `{hourly_rate}` |
| G | CTA Button | e.g. `Apply now` |
| H | Stock Image URL | Google Drive URL for the stock photo |
| I | Figma Node ID | Auto-filled after generation |
| J | PNG Drive URL | Auto-filled after export |

### Variable interpolation

Sub-headline supports `{hai_project}` and `{hourly_rate}` placeholders:

```
Template:  "{hai_project}: Earn {hourly_rate}"
Row:       HAI Project = "Game developer", Hourly Rate = "$75/hr"
Output:    "Game developer: Earn $75/hr"
```

## Figma setup

| Resource | Value |
|---|---|
| Working file | [Handshake AI Paid Ads Copy](https://www.figma.com/design/g3kWYVZmwNPwcsH0ohKORs) |
| Template source page | `9.10.26` |
| Default template frame | `HAI_1x1_PhysicsExperts1-Dusk` |
| Output page | `_growth_creatives` (all generated frames accumulate here) |
| Brand fonts | SansPlomb `95` (headline), Noi Grotesk `Regular` / `Medium` (body/CTA) |

The automation only swaps text — all image fills, logo, decorative shapes, and layout are preserved from the original template.

## Google Drive

| Resource | Link |
|---|---|
| Export folder | [growth-creatives-export](https://drive.google.com/drive/folders/1-Kf3hR7twvNvQvzyDnmI7KSQT1PiJqu5) |
| File naming | `HAI_{dimensions}_{HAIProject}-{Color}.png` |

## Auth

Same gcloud credentials used for BigQuery also cover Sheets and Drive. No separate setup needed.

```bash
# If you hit a 403 on Sheets or Drive:
gcloud auth login --enable-gdrive-access --update-adc
```

Figma API token is stored in Claude memory.

## What's next / not yet built

- [ ] Stock image swap (download from Drive URL → apply as image fill in Figma)
- [ ] ALL CAPS vs sentence case variants auto-generated per row
- [ ] Multi-dimension batch (`all` → generate 1x1, 4x5, 9x16, 16x9 in one run)
- [ ] Auto-write Figma Node ID and PNG Drive URL back to sheet columns I and J
