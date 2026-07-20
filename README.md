# Clocker

Mobile-friendly web app for tracking work clock-in / clock-out times — a Safari-friendly remake of the LabVIEW **Clocker** tool.

Works on iPhone: open in Safari, then **Share → Add to Home Screen** for a full-screen app with local storage and optional GitHub sync.

## Features

- **FOB In Now / FOB Out Now** — one-tap punches with delay adjustment
- **Delay Seconds** — subtracts on In (door → desk), adds on Out (desk → door)
- **Times table** — dates, punches, and calculated total hours (same pairing logic as LabVIEW)
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

LabVIEW-compatible `data/times.txt` is tab-delimited:

```text
7/6/2026	8:40 AM	11:39 AM	12:00 PM	5:47 PM	8.77
```

Empty punch cells are allowed (stored as `null` in JSON). Total hours = paired in/out differences.

## GitHub sync (iPhone)

1. Create a fine-grained token with **Contents: Read and write** on `clockin-logger`
2. Open **Settings** in the app → paste token → **Test token**
3. Turn on **Auto-sync**, or use **Pull** / **Push** manually
4. Switch **Real** / **Test** to change which file is used

## Tech

Vanilla HTML, CSS, and JavaScript — no build step. Service worker for offline/home-screen use.
