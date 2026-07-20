# Clocker

Mobile-friendly web app for tracking work clock-in / clock-out times — a Safari-friendly remake of the LabVIEW **Clocker** tool.

**Live on iPhone:** [https://d-mccarter.github.io/clockin-logger/](https://d-mccarter.github.io/clockin-logger/)

Open that URL in Safari, then **Share → Add to Home Screen** for a full-screen app with local storage and optional GitHub sync.

## Features

- **FOB In Now / FOB Out Now** — one-tap punches at the current time
- **Times table** — dates, punches, and calculated total hours (same pairing logic as LabVIEW)
- **Charts** — first clock-in, last clock-out, and hours per day
- **Add Custom Time** / **Delete Selected** — fix missed or wrong punches
- **Real / Test data profiles** — separate local + GitHub files (same idea as Guitar Practice App)
- **GitHub sync** — pull/push `data/times-data.json` (or test file) with a personal access token
- **Import / Export** — load LabVIEW `times.txt` or JSON; export either format

## Quick start

```bash
cd clockin-logger
npx --yes serve .
```

Open `http://localhost:3000` (or your machine’s LAN IP from iPhone Safari on the same Wi‑Fi).

## Data

| Profile | Local storage key | GitHub file |
|---------|-------------------|-------------|
| Real | `clocker-data` | `data/times-data.json` |
| Test | `clocker-data-test` | `data/times-data-test.json` |

Real punch history is sourced from LabVIEW `times.txt` (also kept at the repo root and as `data/times.txt`).

JSON shape:

```json
{
  "version": 1,
  "settings": { "delaySeconds": 60 },
  "days": [
    {
      "date": "2026-07-06",
      "times": ["08:40", "11:39", "12:00", "17:47"]
    }
  ]
}
```

`settings.delaySeconds` is retained for file compatibility but is no longer used by the app.

LabVIEW-compatible `times.txt` is tab-delimited (CRLF), with empty punch cells allowed and no trailing totals column:

```text
7/6/2026	8:40 AM	11:39 AM	12:00 PM	5:47 PM					
7/14/2026	7:50 AM		12:19 PM	12:22 PM	6:14 PM				
```

Total hours in the app = paired in/out differences (empty cells are skipped when pairing).

## GitHub sync (iPhone)

1. Create a fine-grained token with **Contents: Read and write** on `clockin-logger`
2. Open **Settings** in the app → paste token → **Test token**
3. Turn on **Auto-sync**, or use **Pull** / **Push** manually
4. Switch **Real** / **Test** to change which file is used

**Auto-sync timing:** not a polling interval. When enabled, Clocker syncs once on app open, then pushes about **1.5 seconds** after each local change (debounced).

## Tech

Vanilla HTML, CSS, and JavaScript — no build step.
