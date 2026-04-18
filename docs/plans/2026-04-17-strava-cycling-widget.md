# Strava Cycling Widget Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Cycling section to Craig's Dash that pulls live ride data from Strava and displays weekly progress, last ride, and season vs last year comparison.

**Architecture:** The raw Node.js HTTP server gains one new route (`GET /api/strava/summary`) that exchanges the stored refresh token for a fresh access token, fetches activities from the Strava API, computes summaries, and returns JSON. The single-file HTML frontend adds a Cycling tab that calls this endpoint on load and renders the data.

**Tech Stack:** Node.js (raw http module), Strava REST API v3, vanilla JS + HTML/CSS in ace-dashboard.html

---

## Context

- Server: `C:/Users/cyoun/craigs-dash/server.js` — raw `http.createServer`, no Express
- Frontend: `C:/Users/cyoun/craigs-dash/ace-dashboard.html` — single HTML file served by the server
- All data stored in Supabase via `writeSyncData` / `readSyncData` (one JSON blob, row id=1)
- Railway env vars already set: `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_REFRESH_TOKEN`
- Deploy: push to `craigtyoung/craigs-dash` GitHub repo → Railway auto-deploys

---

## Task 1: Add Strava token refresh helper to server.js

**Files:**
- Modify: `server.js`

**Step 1: Add the `https` module require at top of server.js**

At the top of `server.js`, alongside the existing requires, add:
```js
const https = require('https');
```

**Step 2: Add `stravaRequest` helper function**

Add this helper after the `readBody` function (around line 54):

```js
function stravaRequest(options, postData) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('Invalid JSON from Strava')); }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}
```

**Step 3: Add `getStravaAccessToken` function**

Add immediately after `stravaRequest`:

```js
async function getStravaAccessToken() {
  const postData = new URLSearchParams({
    client_id:     process.env.STRAVA_CLIENT_ID,
    client_secret: process.env.STRAVA_CLIENT_SECRET,
    refresh_token: process.env.STRAVA_REFRESH_TOKEN,
    grant_type:    'refresh_token',
  }).toString();

  const data = await stravaRequest({
    hostname: 'www.strava.com',
    path:     '/oauth/token',
    method:   'POST',
    headers: {
      'Content-Type':   'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(postData),
    },
  }, postData);

  if (!data.access_token) throw new Error('Token refresh failed: ' + JSON.stringify(data));
  return data.access_token;
}
```

**Step 4: Commit**

```bash
git add server.js
git commit -m "feat: add Strava token refresh helpers to server"
```

---

## Task 2: Add Strava activities fetcher and summary calculator

**Files:**
- Modify: `server.js`

**Step 1: Add `fetchStravaActivities` function**

Add after `getStravaAccessToken`:

```js
async function fetchStravaActivities(accessToken, afterEpoch, beforeEpoch) {
  const params = new URLSearchParams({ after: afterEpoch, before: beforeEpoch, per_page: 200 });
  const data = await stravaRequest({
    hostname: 'www.strava.com',
    path:     `/api/v3/athlete/activities?${params}`,
    method:   'GET',
    headers:  { Authorization: `Bearer ${accessToken}` },
  });
  if (!Array.isArray(data)) throw new Error('Unexpected Strava response: ' + JSON.stringify(data));
  return data.filter(a => a.type === 'Ride' || a.sport_type === 'Ride');
}
```

**Step 2: Add `buildStravaSummary` function**

Add after `fetchStravaActivities`:

```js
function buildStravaSummary(weekRides, seasonRides, lastYearRides) {
  const sum = (rides, field) => rides.reduce((acc, r) => acc + (r[field] || 0), 0);

  const weekDistKm  = Math.round(sum(weekRides, 'distance') / 10) / 100;
  const weekTimeMin = Math.round(sum(weekRides, 'moving_time') / 60);
  const weekElevM   = Math.round(sum(weekRides, 'total_elevation_gain'));

  const last = weekRides
    .concat(seasonRides)
    .sort((a, b) => new Date(b.start_date) - new Date(a.start_date))[0];

  return {
    week: {
      distance_km:   weekDistKm,
      time_minutes:  weekTimeMin,
      elevation_m:   weekElevM,
      ride_count:    weekRides.length,
    },
    last_ride: last ? {
      date:          last.start_date.split('T')[0],
      name:          last.name,
      distance_km:   Math.round(last.distance / 10) / 100,
      time_minutes:  Math.round(last.moving_time / 60),
      elevation_m:   Math.round(last.total_elevation_gain),
      avg_speed_kmh: Math.round((last.average_speed * 3.6) * 10) / 10,
    } : null,
    season: {
      distance_km: Math.round(sum(seasonRides, 'distance') / 10) / 100,
      ride_count:  seasonRides.length,
      elevation_m: Math.round(sum(seasonRides, 'total_elevation_gain')),
    },
    last_year_same_period: {
      distance_km: Math.round(sum(lastYearRides, 'distance') / 10) / 100,
      ride_count:  lastYearRides.length,
    },
    weekly_target_km: 175,
  };
}
```

**Step 3: Commit**

```bash
git add server.js
git commit -m "feat: add Strava activity fetcher and summary builder"
```

---

## Task 3: Add /api/strava/summary route to server.js

**Files:**
- Modify: `server.js`

**Step 1: Add the route handler**

Inside `http.createServer`, add this block **before** the final `res.writeHead(404)` line:

```js
// ── Strava summary ──
if (req.url === '/api/strava/summary' && req.method === 'GET') {
  try {
    const accessToken = await getStravaAccessToken();

    const now       = new Date();
    const monday    = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    monday.setHours(0, 0, 0, 0);

    const jan1This  = new Date(now.getFullYear(), 0, 1);
    const jan1Last  = new Date(now.getFullYear() - 1, 0, 1);
    const todayLastYear = new Date(now);
    todayLastYear.setFullYear(now.getFullYear() - 1);

    const toEpoch = d => Math.floor(d.getTime() / 1000);

    const [weekRides, seasonRides, lastYearRides] = await Promise.all([
      fetchStravaActivities(accessToken, toEpoch(monday),   toEpoch(now)),
      fetchStravaActivities(accessToken, toEpoch(jan1This), toEpoch(now)),
      fetchStravaActivities(accessToken, toEpoch(jan1Last), toEpoch(todayLastYear)),
    ]);

    const summary = buildStravaSummary(weekRides, seasonRides, lastYearRides);
    json(res, 200, summary);
  } catch (e) {
    console.error('Strava error:', e.message);
    json(res, 200, { error: true, message: e.message });
  }
  return;
}
```

**Step 2: Test locally (if server is running)**

```bash
curl http://localhost:3001/api/strava/summary
```

Expected: JSON with `week`, `last_ride`, `season`, `last_year_same_period` fields.
If Strava creds aren't set locally, test by pushing to Railway (step 4).

**Step 3: Commit**

```bash
git add server.js
git commit -m "feat: add /api/strava/summary route"
```

---

## Task 4: Add Cycling section to ace-dashboard.html

**Files:**
- Modify: `ace-dashboard.html`

**Step 1: Add Cycling tab button**

Find the tab navigation in `ace-dashboard.html` (look for the row of tab buttons like Today, Schedule, Tasks, etc.). Add a Cycling tab:

```html
<button class="tab-btn" data-tab="cycling" onclick="showTab('cycling')">🚴 Cycling</button>
```

**Step 2: Add Cycling tab panel**

Find where the other tab panels are defined (e.g. `<div id="tab-today">`). Add:

```html
<div id="tab-cycling" class="tab-panel" style="display:none">
  <div id="cycling-loading" style="text-align:center;padding:2rem;color:#888">Loading Strava data…</div>
  <div id="cycling-content" style="display:none">

    <!-- Weekly Progress -->
    <div class="card" style="margin-bottom:1rem">
      <h3 style="margin:0 0 0.75rem;font-size:0.85rem;text-transform:uppercase;letter-spacing:0.05em;color:#888">This Week</h3>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem">
        <span id="cycling-week-dist" style="font-size:1.4rem;font-weight:700"></span>
        <span style="color:#888;font-size:0.85rem">/ 175 km target</span>
      </div>
      <div style="background:#1e1e2e;border-radius:6px;height:10px;overflow:hidden">
        <div id="cycling-week-bar" style="height:100%;background:linear-gradient(90deg,#f97316,#fb923c);border-radius:6px;transition:width 0.6s ease"></div>
      </div>
      <div id="cycling-week-meta" style="margin-top:0.5rem;font-size:0.8rem;color:#888"></div>
    </div>

    <!-- Last Ride -->
    <div class="card" style="margin-bottom:1rem">
      <h3 style="margin:0 0 0.75rem;font-size:0.85rem;text-transform:uppercase;letter-spacing:0.05em;color:#888">Last Ride</h3>
      <div id="cycling-last-ride"></div>
    </div>

    <!-- Season vs Last Year -->
    <div class="card">
      <h3 style="margin:0 0 0.75rem;font-size:0.85rem;text-transform:uppercase;letter-spacing:0.05em;color:#888">Season</h3>
      <div id="cycling-season"></div>
    </div>

  </div>
  <div id="cycling-error" style="display:none;text-align:center;padding:2rem;color:#888">Strava data unavailable</div>
</div>
```

**Step 3: Add cycling data fetch function**

Find the `<script>` section in `ace-dashboard.html`. Add this function:

```js
async function loadCyclingData() {
  try {
    const res  = await fetch('/api/strava/summary');
    const data = await res.json();

    document.getElementById('cycling-loading').style.display = 'none';

    if (data.error) {
      document.getElementById('cycling-error').style.display = 'block';
      return;
    }

    // Weekly progress
    const pct = Math.min(100, Math.round((data.week.distance_km / data.weekly_target_km) * 100));
    document.getElementById('cycling-week-dist').textContent = `${data.week.distance_km} km`;
    document.getElementById('cycling-week-bar').style.width  = `${pct}%`;
    const hrs = Math.floor(data.week.time_minutes / 60);
    const min = data.week.time_minutes % 60;
    document.getElementById('cycling-week-meta').textContent =
      `${data.week.ride_count} rides · ${hrs}h ${min}m · ${data.week.elevation_m.toLocaleString()}m ↑`;

    // Last ride
    const lr = data.last_ride;
    if (lr) {
      const lrHrs = Math.floor(lr.time_minutes / 60);
      const lrMin = lr.time_minutes % 60;
      document.getElementById('cycling-last-ride').innerHTML = `
        <div style="font-weight:600;margin-bottom:0.25rem">${lr.name}</div>
        <div style="color:#888;font-size:0.85rem">${lr.date}</div>
        <div style="margin-top:0.5rem;display:flex;gap:1rem;flex-wrap:wrap;font-size:0.9rem">
          <span>📍 ${lr.distance_km} km</span>
          <span>⏱ ${lrHrs}h ${lrMin}m</span>
          <span>⛰ ${lr.elevation_m}m</span>
          <span>⚡ ${lr.avg_speed_kmh} km/h</span>
        </div>`;
    }

    // Season vs last year
    const diff = Math.round(data.season.distance_km - data.last_year_same_period.distance_km);
    const diffLabel = diff >= 0
      ? `<span style="color:#4ade80">↑ ${diff} km ahead of last year's pace</span>`
      : `<span style="color:#f87171">↓ ${Math.abs(diff)} km behind last year's pace</span>`;
    document.getElementById('cycling-season').innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-bottom:0.75rem">
        <div>
          <div style="font-size:1.3rem;font-weight:700">${data.season.distance_km.toLocaleString()} km</div>
          <div style="color:#888;font-size:0.8rem">2026 season · ${data.season.ride_count} rides</div>
        </div>
        <div>
          <div style="font-size:1.3rem;font-weight:700">${data.last_year_same_period.distance_km.toLocaleString()} km</div>
          <div style="color:#888;font-size:0.8rem">2025 at this point · ${data.last_year_same_period.ride_count} rides</div>
        </div>
      </div>
      <div style="font-size:0.9rem">${diffLabel}</div>`;

    document.getElementById('cycling-content').style.display = 'block';
  } catch (e) {
    document.getElementById('cycling-loading').style.display = 'none';
    document.getElementById('cycling-error').style.display   = 'block';
  }
}
```

**Step 4: Wire up tab to trigger load**

Find the `showTab` function in the script. Add a case so cycling data loads when the tab is opened:

```js
// Inside showTab function, after showing the panel:
if (tab === 'cycling') loadCyclingData();
```

**Step 5: Commit**

```bash
git add ace-dashboard.html
git commit -m "feat: add cycling tab with Strava progress, last ride, and season comparison"
```

---

## Task 5: Deploy and verify

**Step 1: Push to GitHub**

```bash
git push origin main
```

Railway auto-deploys on push (watch the Railway dashboard for the deploy to complete — usually ~60 seconds).

**Step 2: Open Craig's Dash and click the Cycling tab**

Visit `https://craigs-dash.up.railway.app`, click the Cycling tab.

Expected:
- Progress bar showing this week's distance toward 175 km
- Last ride details
- Season total vs last year comparison

**Step 3: If data shows "Strava data unavailable"**

Check Railway logs for the error message. Common issues:
- `STRAVA_REFRESH_TOKEN` expired or wrong — go back to strava.com/settings/api, copy fresh token, update Railway env var
- `STRAVA_CLIENT_SECRET` wrong — verify against Strava app settings

**Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: resolve Strava integration issues"
git push origin main
```
