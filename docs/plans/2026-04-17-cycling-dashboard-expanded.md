# Expanded Cycling Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expand the Cycling tab on Craig's Dash into a full cycling dashboard with Chart.js charts, HR trend, personal bests, and a full season ride log.

**Architecture:** The existing `buildStravaSummary` function in `server.js` is replaced with an expanded version that computes 6 new data shapes from the same 3 ride arrays already fetched (no new API calls). The frontend cycling tab HTML is replaced with a multi-section layout, Chart.js loaded via CDN, and `loadCyclingData` replaced with a comprehensive renderer.

**Tech Stack:** Node.js (raw http), Chart.js 4 (CDN), vanilla JS, HTML/CSS in single ace-dashboard.html file.

---

## Context

- Server: `C:/Users/cyoun/craigs-dash/server.js`
- Frontend: `C:/Users/cyoun/craigs-dash/ace-dashboard.html`
- Cycling tab panel ID: `pane-cycling` (uses `switchTab` / `nav-tab` pattern)
- Chart.js: load via `<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>`
- Deploy: `git push origin main` → Railway auto-deploys

---

## Task 1: Replace `buildStravaSummary` in server.js

**Files:**
- Modify: `C:/Users/cyoun/craigs-dash/server.js`

Read the file first. Find `function buildStravaSummary(weekRides, seasonRides, lastYearRides)` and replace the entire function with this expanded version:

```js
function getISOWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function buildStravaSummary(weekRides, seasonRides, lastYearRides) {
  const now = new Date();
  const sum = (rides, field) => rides.reduce((acc, r) => acc + (r[field] || 0), 0);

  // ── Week ──
  const weekDistKm  = Math.round(sum(weekRides, 'distance') / 10) / 100;
  const weekTimeMin = Math.round(sum(weekRides, 'moving_time') / 60);
  const weekElevM   = Math.round(sum(weekRides, 'total_elevation_gain'));

  // ── Last ride (most recent across week + season) ──
  const last = seasonRides
    .concat(weekRides)
    .sort((a, b) => new Date(b.start_date) - new Date(a.start_date))[0];

  // ── Season stats ──
  const seasonTotalHours = Math.round(sum(seasonRides, 'moving_time') / 360) / 10;

  // ── Weekly volumes (last 12 weeks) ──
  const weeklyVolumes = [];
  for (let i = 11; i >= 0; i--) {
    const wStart = new Date(now);
    wStart.setDate(now.getDate() - ((now.getDay() + 6) % 7) - (i * 7));
    wStart.setHours(0, 0, 0, 0);
    const wEnd = new Date(wStart);
    wEnd.setDate(wStart.getDate() + 7);
    const wRides = seasonRides.filter(r => {
      const d = new Date(r.start_date);
      return d >= wStart && d < wEnd;
    });
    weeklyVolumes.push({
      label: wStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      km:    Math.round(sum(wRides, 'distance') / 10) / 100,
      rides: wRides.length,
    });
  }

  // ── Cumulative by ISO week (this year vs last year) ──
  const currentWeek = getISOWeek(now);
  const thisYearByWeek = {}, lastYearByWeek = {};
  seasonRides.forEach(r => {
    const w = getISOWeek(new Date(r.start_date));
    thisYearByWeek[w] = (thisYearByWeek[w] || 0) + (r.distance || 0);
  });
  lastYearRides.forEach(r => {
    const w = getISOWeek(new Date(r.start_date));
    lastYearByWeek[w] = (lastYearByWeek[w] || 0) + (r.distance || 0);
  });
  let cumThis = 0, cumLast = 0;
  const cumulativeByWeek = [];
  for (let w = 1; w <= currentWeek; w++) {
    cumThis += (thisYearByWeek[w] || 0);
    cumLast += (lastYearByWeek[w] || 0);
    cumulativeByWeek.push({
      week:      w,
      this_year: Math.round(cumThis / 10) / 100,
      last_year: Math.round(cumLast / 10) / 100,
    });
  }

  // ── HR trend (last 10 rides with HR data) ──
  const hrTrend = seasonRides
    .filter(r => r.average_heartrate)
    .sort((a, b) => new Date(a.start_date) - new Date(b.start_date))
    .slice(-10)
    .map(r => ({
      date:   r.start_date.split('T')[0],
      avg_hr: Math.round(r.average_heartrate),
    }));

  // ── Personal bests ──
  const longestRide  = seasonRides.reduce((best, r) => r.distance > (best?.distance || 0) ? r : best, null);
  const mostElevRide = seasonRides.reduce((best, r) => r.total_elevation_gain > (best?.total_elevation_gain || 0) ? r : best, null);
  const fastestRide  = seasonRides.reduce((best, r) => r.average_speed > (best?.average_speed || 0) ? r : best, null);
  const rideDates    = [...new Set(seasonRides.map(r => r.start_date.split('T')[0]))].sort();
  let maxStreak = rideDates.length > 0 ? 1 : 0, streak = 1;
  for (let i = 1; i < rideDates.length; i++) {
    const diff = (new Date(rideDates[i]) - new Date(rideDates[i - 1])) / 86400000;
    if (diff === 1) { streak++; if (streak > maxStreak) maxStreak = streak; }
    else streak = 1;
  }

  // ── All season rides (newest first) ──
  const allRides = seasonRides
    .sort((a, b) => new Date(b.start_date) - new Date(a.start_date))
    .map(r => ({
      date:          r.start_date.split('T')[0],
      name:          r.name,
      distance_km:   Math.round(r.distance / 10) / 100,
      time_minutes:  Math.round(r.moving_time / 60),
      elevation_m:   Math.round(r.total_elevation_gain),
      avg_hr:        r.average_heartrate ? Math.round(r.average_heartrate) : null,
      avg_speed_kmh: Math.round((r.average_speed * 3.6) * 10) / 10,
    }));

  return {
    week: {
      distance_km:  weekDistKm,
      time_minutes: weekTimeMin,
      elevation_m:  weekElevM,
      ride_count:   weekRides.length,
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
      distance_km:  Math.round(sum(seasonRides, 'distance') / 10) / 100,
      ride_count:   seasonRides.length,
      elevation_m:  Math.round(sum(seasonRides, 'total_elevation_gain')),
      total_hours:  seasonTotalHours,
    },
    last_year_same_period: {
      distance_km: Math.round(sum(lastYearRides, 'distance') / 10) / 100,
      ride_count:  lastYearRides.length,
    },
    weekly_target_km:   175,
    weekly_volumes:     weeklyVolumes,
    cumulative_by_week: cumulativeByWeek,
    hr_trend:           hrTrend,
    personal_bests: {
      longest_ride_km:    longestRide  ? Math.round(longestRide.distance / 10) / 100 : 0,
      most_elevation_m:   mostElevRide ? Math.round(mostElevRide.total_elevation_gain) : 0,
      best_avg_speed_kmh: fastestRide  ? Math.round((fastestRide.average_speed * 3.6) * 10) / 10 : 0,
      longest_streak_days: maxStreak,
    },
    all_rides: allRides,
  };
}
```

**Commit:**
```bash
git -C "C:/Users/cyoun/craigs-dash" add server.js
git -C "C:/Users/cyoun/craigs-dash" commit -m "feat: expand buildStravaSummary with charts data, HR trend, personal bests, all rides"
```

---

## Task 2: Replace cycling tab HTML in ace-dashboard.html

**Files:**
- Modify: `C:/Users/cyoun/craigs-dash/ace-dashboard.html`

Read the file. Find the cycling tab panel — it has `id="pane-cycling"`. Replace the entire content INSIDE that div (everything between the opening `<div id="pane-cycling"...>` and its closing `</div>`) with:

```html
  <div id="cycling-loading" style="text-align:center;padding:2rem;color:#888">Loading Strava data…</div>
  <div id="cycling-error" style="display:none;text-align:center;padding:2rem;color:#888">Strava data unavailable</div>
  <div id="cycling-content" style="display:none">

    <!-- Season Stats Bar -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0.5rem;margin-bottom:1rem">
      <div class="card" style="text-align:center;padding:0.75rem 0.5rem">
        <div id="cs-km" style="font-size:1.1rem;font-weight:700;color:#f97316"></div>
        <div style="font-size:0.7rem;color:#888;margin-top:0.2rem">km</div>
      </div>
      <div class="card" style="text-align:center;padding:0.75rem 0.5rem">
        <div id="cs-hrs" style="font-size:1.1rem;font-weight:700;color:#f97316"></div>
        <div style="font-size:0.7rem;color:#888;margin-top:0.2rem">hours</div>
      </div>
      <div class="card" style="text-align:center;padding:0.75rem 0.5rem">
        <div id="cs-elev" style="font-size:1.1rem;font-weight:700;color:#f97316"></div>
        <div style="font-size:0.7rem;color:#888;margin-top:0.2rem">elev (m)</div>
      </div>
      <div class="card" style="text-align:center;padding:0.75rem 0.5rem">
        <div id="cs-rides" style="font-size:1.1rem;font-weight:700;color:#f97316"></div>
        <div style="font-size:0.7rem;color:#888;margin-top:0.2rem">rides</div>
      </div>
    </div>

    <!-- Weekly Progress -->
    <div class="card" style="margin-bottom:1rem">
      <h3 style="margin:0 0 0.75rem;font-size:0.85rem;text-transform:uppercase;letter-spacing:0.05em;color:#888">This Week</h3>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem">
        <span id="cycling-week-dist" style="font-size:1.4rem;font-weight:700"></span>
        <span style="color:#888;font-size:0.85rem">/ 175 km target</span>
      </div>
      <div style="background:#1e1e2e;border-radius:6px;height:10px;overflow:hidden">
        <div id="cycling-week-bar" style="height:100%;background:linear-gradient(90deg,#f97316,#fb923c);border-radius:6px;transition:width 0.6s ease;width:0%"></div>
      </div>
      <div id="cycling-week-meta" style="margin-top:0.5rem;font-size:0.8rem;color:#888"></div>
    </div>

    <!-- Weekly Volume Chart -->
    <div class="card" style="margin-bottom:1rem">
      <h3 style="margin:0 0 0.75rem;font-size:0.85rem;text-transform:uppercase;letter-spacing:0.05em;color:#888">Weekly Volume — Last 12 Weeks</h3>
      <canvas id="cycling-volume-chart" height="180"></canvas>
    </div>

    <!-- Season vs Last Year -->
    <div class="card" style="margin-bottom:1rem">
      <h3 style="margin:0 0 0.75rem;font-size:0.85rem;text-transform:uppercase;letter-spacing:0.05em;color:#888">Season Cumulative — 2026 vs 2025</h3>
      <canvas id="cycling-cumulative-chart" height="180"></canvas>
    </div>

    <!-- HR Trend -->
    <div class="card" id="cycling-hr-card" style="margin-bottom:1rem;display:none">
      <h3 style="margin:0 0 0.25rem;font-size:0.85rem;text-transform:uppercase;letter-spacing:0.05em;color:#888">HR Trend — Last 10 Rides</h3>
      <p style="margin:0 0 0.75rem;font-size:0.75rem;color:#666">Downward trend = getting fitter</p>
      <canvas id="cycling-hr-chart" height="140"></canvas>
    </div>

    <!-- Personal Bests -->
    <div class="card" style="margin-bottom:1rem">
      <h3 style="margin:0 0 0.75rem;font-size:0.85rem;text-transform:uppercase;letter-spacing:0.05em;color:#888">Season Bests</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
        <div style="background:#1e1e2e;border-radius:8px;padding:0.75rem">
          <div style="font-size:0.7rem;color:#888;margin-bottom:0.25rem">🏅 Longest Ride</div>
          <div id="pb-longest" style="font-size:1.1rem;font-weight:700"></div>
        </div>
        <div style="background:#1e1e2e;border-radius:8px;padding:0.75rem">
          <div style="font-size:0.7rem;color:#888;margin-bottom:0.25rem">⛰ Most Elevation</div>
          <div id="pb-elev" style="font-size:1.1rem;font-weight:700"></div>
        </div>
        <div style="background:#1e1e2e;border-radius:8px;padding:0.75rem">
          <div style="font-size:0.7rem;color:#888;margin-bottom:0.25rem">⚡ Best Avg Speed</div>
          <div id="pb-speed" style="font-size:1.1rem;font-weight:700"></div>
        </div>
        <div style="background:#1e1e2e;border-radius:8px;padding:0.75rem">
          <div style="font-size:0.7rem;color:#888;margin-bottom:0.25rem">🔥 Best Streak</div>
          <div id="pb-streak" style="font-size:1.1rem;font-weight:700"></div>
        </div>
      </div>
    </div>

    <!-- All Season Rides -->
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem">
        <h3 style="margin:0;font-size:0.85rem;text-transform:uppercase;letter-spacing:0.05em;color:#888">All Season Rides</h3>
        <button id="rides-toggle" onclick="toggleRidesList()" style="background:#1e1e2e;border:none;color:#888;font-size:0.8rem;padding:0.3rem 0.6rem;border-radius:4px;cursor:pointer"></button>
      </div>
      <div id="rides-list" style="display:none"></div>
    </div>

  </div>
```

**Commit:**
```bash
git -C "C:/Users/cyoun/craigs-dash" add ace-dashboard.html
git -C "C:/Users/cyoun/craigs-dash" commit -m "feat: replace cycling tab HTML with expanded multi-section layout"
```

---

## Task 3: Add Chart.js CDN and replace loadCyclingData in ace-dashboard.html

**Files:**
- Modify: `C:/Users/cyoun/craigs-dash/ace-dashboard.html`

**Step 1: Add Chart.js CDN script tag**

Find the `</head>` tag in ace-dashboard.html. Add this line immediately before it:
```html
<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
```

**Step 2: Replace `loadCyclingData` function**

Find the existing `async function loadCyclingData()` in the `<script>` section. Replace the entire function (from `async function loadCyclingData()` through its closing `}`) with:

```js
// Chart instances — stored so we can destroy before recreating
let _volChart = null, _cumChart = null, _hrChart = null;

function destroyCyclingCharts() {
  if (_volChart) { _volChart.destroy(); _volChart = null; }
  if (_cumChart) { _cumChart.destroy(); _cumChart = null; }
  if (_hrChart)  { _hrChart.destroy();  _hrChart = null; }
}

function toggleRidesList() {
  const list = document.getElementById('rides-list');
  const btn  = document.getElementById('rides-toggle');
  const open = list.style.display === 'none';
  list.style.display = open ? 'block' : 'none';
  btn.textContent    = open ? 'Hide ↑' : (btn.dataset.label || 'Show ↓');
}

async function loadCyclingData() {
  destroyCyclingCharts();
  document.getElementById('cycling-loading').style.display = 'block';
  document.getElementById('cycling-content').style.display = 'none';
  document.getElementById('cycling-error').style.display   = 'none';

  try {
    const res  = await fetch('/api/strava/summary');
    const data = await res.json();

    document.getElementById('cycling-loading').style.display = 'none';

    if (data.error || !data.week || !data.season || !data.last_year_same_period) {
      document.getElementById('cycling-error').style.display = 'block';
      return;
    }

    // ── Season Stats Bar ──
    document.getElementById('cs-km').textContent    = data.season.distance_km.toLocaleString();
    document.getElementById('cs-hrs').textContent   = data.season.total_hours;
    document.getElementById('cs-elev').textContent  = data.season.elevation_m.toLocaleString();
    document.getElementById('cs-rides').textContent = data.season.ride_count;

    // ── Weekly Progress ──
    const pct = Math.min(100, Math.round((data.week.distance_km / data.weekly_target_km) * 100));
    document.getElementById('cycling-week-dist').textContent = `${data.week.distance_km} km`;
    document.getElementById('cycling-week-bar').style.width  = `${pct}%`;
    const hrs = Math.floor(data.week.time_minutes / 60);
    const min = data.week.time_minutes % 60;
    document.getElementById('cycling-week-meta').textContent =
      `${data.week.ride_count} rides · ${hrs}h ${min}m · ${data.week.elevation_m.toLocaleString()}m ↑`;

    // ── Weekly Volume Chart ──
    const chartDefaults = {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#666', font: { size: 10 } }, grid: { color: '#1e1e2e' } },
        y: { ticks: { color: '#666', font: { size: 10 } }, grid: { color: '#1e1e2e' } },
      },
    };

    _volChart = new Chart(document.getElementById('cycling-volume-chart'), {
      type: 'bar',
      data: {
        labels:   data.weekly_volumes.map(w => w.label),
        datasets: [{
          data:            data.weekly_volumes.map(w => w.km),
          backgroundColor: data.weekly_volumes.map((_, i) =>
            i === data.weekly_volumes.length - 1 ? '#f97316' : '#2dd4bf44'),
          borderColor: data.weekly_volumes.map((_, i) =>
            i === data.weekly_volumes.length - 1 ? '#f97316' : '#2dd4bf'),
          borderWidth: 1,
          borderRadius: 4,
        }],
      },
      options: {
        ...chartDefaults,
        scales: {
          ...chartDefaults.scales,
          y: { ...chartDefaults.scales.y, title: { display: true, text: 'km', color: '#666' } },
        },
      },
    });

    // ── Season Cumulative Chart ──
    _cumChart = new Chart(document.getElementById('cycling-cumulative-chart'), {
      type: 'line',
      data: {
        labels:   data.cumulative_by_week.map(w => `W${w.week}`),
        datasets: [
          {
            label:       '2026',
            data:        data.cumulative_by_week.map(w => w.this_year),
            borderColor: '#f97316',
            backgroundColor: 'rgba(249,115,22,0.08)',
            borderWidth: 2,
            fill: true,
            tension: 0.3,
            pointRadius: 2,
          },
          {
            label:       '2025',
            data:        data.cumulative_by_week.map(w => w.last_year),
            borderColor: '#666',
            borderDash:  [4, 4],
            borderWidth: 1.5,
            fill: false,
            tension: 0.3,
            pointRadius: 2,
          },
        ],
      },
      options: {
        ...chartDefaults,
        plugins: {
          legend: {
            display: true,
            labels: { color: '#888', boxWidth: 20, font: { size: 11 } },
          },
        },
        scales: {
          ...chartDefaults.scales,
          y: { ...chartDefaults.scales.y, title: { display: true, text: 'cumulative km', color: '#666' } },
        },
      },
    });

    // ── HR Trend ──
    if (data.hr_trend && data.hr_trend.length >= 3) {
      document.getElementById('cycling-hr-card').style.display = 'block';
      _hrChart = new Chart(document.getElementById('cycling-hr-chart'), {
        type: 'line',
        data: {
          labels:   data.hr_trend.map(r => r.date.slice(5)),
          datasets: [{
            data:        data.hr_trend.map(r => r.avg_hr),
            borderColor: '#f97316',
            borderWidth: 2,
            tension: 0.3,
            pointRadius: 3,
            pointBackgroundColor: '#f97316',
            fill: false,
          }],
        },
        options: {
          ...chartDefaults,
          scales: {
            ...chartDefaults.scales,
            y: {
              ...chartDefaults.scales.y,
              title: { display: true, text: 'avg HR (bpm)', color: '#666' },
              suggestedMin: Math.min(...data.hr_trend.map(r => r.avg_hr)) - 10,
            },
          },
        },
      });
    }

    // ── Personal Bests ──
    const pb = data.personal_bests;
    document.getElementById('pb-longest').textContent = `${pb.longest_ride_km} km`;
    document.getElementById('pb-elev').textContent    = `${pb.most_elevation_m.toLocaleString()} m`;
    document.getElementById('pb-speed').textContent   = `${pb.best_avg_speed_kmh} km/h`;
    document.getElementById('pb-streak').textContent  = `${pb.longest_streak_days} day${pb.longest_streak_days !== 1 ? 's' : ''}`;

    // ── All Season Rides ──
    const toggleBtn = document.getElementById('rides-toggle');
    toggleBtn.textContent = `Show all ${data.all_rides.length} rides ↓`;
    toggleBtn.dataset.label = `Show all ${data.all_rides.length} rides ↓`;

    const ridesList = document.getElementById('rides-list');
    const safeName = s => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    ridesList.innerHTML = data.all_rides.map(r => {
      const rHrs = Math.floor(r.time_minutes / 60);
      const rMin = r.time_minutes % 60;
      const hrStr = r.avg_hr ? ` · ♥ ${r.avg_hr}` : '';
      return `<div style="padding:0.6rem 0;border-bottom:1px solid #1e1e2e;font-size:0.82rem">
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <span style="font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${safeName(r.name)}</span>
          <span style="color:#f97316;margin-left:0.5rem;white-space:nowrap">${r.distance_km} km</span>
        </div>
        <div style="color:#666;margin-top:0.15rem">${r.date} · ${rHrs}h ${rMin}m · ${r.elevation_m}m ↑ · ${r.avg_speed_kmh} km/h${hrStr}</div>
      </div>`;
    }).join('');

    document.getElementById('cycling-content').style.display = 'block';
  } catch (e) {
    document.getElementById('cycling-loading').style.display = 'none';
    document.getElementById('cycling-error').style.display   = 'block';
  }
}
```

**Commit:**
```bash
git -C "C:/Users/cyoun/craigs-dash" add ace-dashboard.html
git -C "C:/Users/cyoun/craigs-dash" commit -m "feat: add Chart.js charts, HR trend, personal bests, all rides to cycling tab"
```

---

## Task 4: Deploy and verify

**Step 1: Push to GitHub**
```bash
git -C "C:/Users/cyoun/craigs-dash" push origin main
```
Railway auto-deploys on push (~60 seconds).

**Step 2: Open Craig's Dash and click the 🚴 Cycling tab**

Expected sections visible:
- Season stats bar (4 numbers in a row)
- Weekly progress bar
- Weekly volume bar chart (12 bars, current week orange)
- Season cumulative line chart (2026 orange solid, 2025 gray dashed)
- HR trend chart (if rides have HR data — should appear since Craig has HR monitor)
- Personal bests (4 stat cards)
- All season rides collapsed, button showing "Show all X rides ↓"

**Step 3: Tap "Show all X rides"**

Expected: full scrollable list of season rides, each showing date, name, distance, time, elevation, HR, speed.

**Step 4: If charts don't render**

Check browser console for errors. Common issues:
- Chart.js CDN blocked → verify `<script>` tag is in `<head>` before `</head>`
- Canvas element not found → verify IDs match between HTML and JS

**Step 5: Commit any fixes**
```bash
git -C "C:/Users/cyoun/craigs-dash" add ace-dashboard.html
git -C "C:/Users/cyoun/craigs-dash" commit -m "fix: cycling dashboard rendering issues"
git -C "C:/Users/cyoun/craigs-dash" push origin main
```
