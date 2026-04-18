# Design: Strava Cycling Widget for Craig's Dash
*Decided: 2026-04-17 — Craig + Claude*

## Overview
Add a Cycling section to Craig's Dash (Railway PWA) that pulls live data from the Strava API and displays it as an inspiring daily progress view.

---

## Goals
- Surface cycling metrics Craig actually cares about (not what Strava buries)
- Weekly distance progress bar toward a 175km target
- Season total vs same period last year (motivating comparison)
- Last ride details at a glance
- Zero manual logging — all data pulled automatically from Strava

---

## Architecture

### Data Flow
```
Strava API
    ↓  (refresh token → access token → activities)
server.js  GET /api/strava/summary
    ↓  (JSON response)
ace-dashboard.html  Cycling section
```

### Credentials (Railway env vars — already set)
- `STRAVA_CLIENT_ID` = 226673
- `STRAVA_CLIENT_SECRET` = (set)
- `STRAVA_REFRESH_TOKEN` = (set)

---

## Server Changes (server.js)

### New route: `GET /api/strava/summary`

**Step 1 — Token refresh**
POST to `https://www.strava.com/oauth/token` with:
- `client_id`, `client_secret`, `refresh_token`
- `grant_type: refresh_token`

Returns a fresh `access_token` (valid 6 hours).

**Step 2 — Fetch activities**
`GET https://www.strava.com/api/v3/athlete/activities`

Fetch rides needed for:
- This week (Monday → today)
- Season total (Jan 1 current year → today)
- Same-period last year (Jan 1 last year → today's date last year)

Filter to `type === 'Ride'` (covers both outdoor Ride and VirtualRide if desired).

**Step 3 — Compute and return summary**
```json
{
  "week": {
    "distance_km": 147.3,
    "time_minutes": 312,
    "elevation_m": 1840,
    "ride_count": 4
  },
  "last_ride": {
    "date": "2026-04-16",
    "name": "Morning Group Ride",
    "distance_km": 52.1,
    "time_minutes": 98,
    "elevation_m": 620,
    "avg_speed_kmh": 31.9
  },
  "season": {
    "distance_km": 1840,
    "ride_count": 47,
    "elevation_m": 21400
  },
  "last_year_same_period": {
    "distance_km": 1200,
    "ride_count": 31
  },
  "weekly_target_km": 175
}
```

**Error handling:** If Strava API fails, return `{ error: true }` — frontend shows "Data unavailable" gracefully, never crashes the dashboard.

---

## Frontend Changes (ace-dashboard.html)

### New Cycling tab/section

**Weekly Progress Bar**
```
This Week  [████████░░░░]  147 / 175 km
           4 rides · 5h 12m · 1,840m ↑
```

**Last Ride Card**
```
Last Ride — Apr 16
Morning Group Ride
52.1 km · 1h 38m · 620m ↑ · 31.9 km/h avg
```

**Season vs Last Year**
```
2026 Season    1,840 km  (47 rides)
2025 at Apr 17   1,200 km  (31 rides)
↑ 640 km ahead of last year's pace
```

---

## Constraints
- Strava rate limit: 200 req/15 min, 2,000/day — no polling, fetch on page load only
- Refresh token stored in Railway env vars only — never exposed to browser
- `STRAVA_REFRESH_TOKEN` in env vars should be updated if it ever rotates (Strava refreshes the refresh token on each use)
- Filter: `type === 'Ride'` — exclude runs, swims, etc.
- Weekly target: 175 km (hardcoded for now, can be made configurable later)

---

## Out of Scope (this phase)
- Full Health Compass → Railway migration
- Strava webhooks for real-time sync
- Power/HR analysis
- Route maps
- Per-ride detail pages
