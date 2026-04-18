# Design: Expanded Cycling Dashboard
*Decided: 2026-04-17 — Craig + Claude*

## Overview
Expand the existing Cycling tab on Craig's Dash into a full-featured cycling dashboard with charts, trends, personal bests, HR fitness tracking, and a full season ride log.

---

## Sections (top to bottom)

### 1. Season Stats Bar
Four stat pills in a row at the top:
- Total km this season
- Total hours this season
- Total elevation this season (m)
- Total ride count

### 2. Weekly Progress (existing — keep)
Progress bar toward 175km weekly target. No changes.

### 3. Weekly Volume Chart (Chart.js bar)
- Last 12 weeks of km/week as vertical bars
- Current week: orange (`#f97316`)
- Past weeks: teal (`#2dd4bf`)
- X-axis: week labels (e.g. "Apr 14", "Apr 7")
- Y-axis: km
- Computed from season rides bucketed by ISO week

### 4. Season vs 2025 Line Chart (Chart.js dual line)
- Cumulative km by week number (week 1 = Jan 1)
- This year: solid orange line
- Last year: dashed gray line
- X-axis: week numbers / month labels
- Y-axis: cumulative km
- Shaded area between lines (green if ahead, subtle if behind)

### 5. HR Trend (Chart.js small line)
- Avg HR for each of the last 10 rides that have HR data
- Orange line, small chart
- Only rendered if at least 3 rides have HR data
- Label: "Avg HR — last 10 rides with HR data"
- Downward trend = getting fitter

### 6. Personal Bests (4 stat cards in 2×2 grid)
- 🏅 Longest ride (km)
- ⛰ Most elevation in one ride (m)
- ⚡ Best avg speed (km/h)
- 🔥 Longest active streak (consecutive days with a ride)
- All computed from season rides

### 7. All Season Rides (collapsible)
- Collapsed by default: "Show all X rides ↓" button
- Expanded: full scrollable list, newest first
- Each ride row: date · name · distance · time · elevation · avg HR (if available) · avg speed
- Compact single-line format optimized for mobile

---

## Architecture

### Server (`server.js`)
Replace `buildStravaSummary` with an expanded version that computes all new fields from the same three rides arrays (weekRides, seasonRides, lastYearRides). No new API calls.

**New fields added to the response:**
```json
{
  "season_stats": {
    "total_hours": 47.3,
    "total_elevation_m": 21400,
    "distance_km": 1840,
    "ride_count": 47
  },
  "weekly_volumes": [
    { "label": "Apr 14", "km": 147, "rides": 4 },
    ...12 weeks...
  ],
  "cumulative_by_week": [
    { "week": 1, "label": "Jan 1", "this_year": 0, "last_year": 0 },
    ...up to current week...
  ],
  "hr_trend": [
    { "date": "Apr 16", "avg_hr": 142 },
    ...last 10 rides with HR...
  ],
  "personal_bests": {
    "longest_ride_km": 87.3,
    "most_elevation_m": 1240,
    "best_avg_speed_kmh": 34.2,
    "longest_streak_days": 5
  },
  "all_rides": [
    {
      "date": "2026-04-16",
      "name": "Morning Group Ride",
      "distance_km": 52.1,
      "time_minutes": 98,
      "elevation_m": 620,
      "avg_hr": 142,
      "avg_speed_kmh": 31.9
    },
    ...all season rides...
  ]
}
```

### Frontend (`ace-dashboard.html`)
- Add Chart.js via CDN: `<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>`
- Replace current `loadCyclingData` with expanded version
- Charts rendered into `<canvas>` elements inside existing card structure
- Chart instances stored in variables so they can be destroyed/re-created if tab is reopened

---

## Constraints
- No new API calls — all computed from existing 3 fetches
- Chart.js loaded from CDN (no npm install needed)
- HR trend section skipped silently if fewer than 3 rides have HR data
- All season rides list collapsed by default (performance — don't render 47 rows on load)
- Streak calculated as consecutive calendar days with at least one ride
