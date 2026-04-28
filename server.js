'use strict';

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const { createClient } = require('@supabase/supabase-js');

const PORT         = process.env.PORT || 3001;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_KEY are required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function readSyncData() {
  const { data, error } = await supabase
    .from('ace_sync')
    .select('data')
    .eq('id', 1)
    .maybeSingle();
  if (error) { console.error('Supabase read error:', error.message); return {}; }
  return data?.data || {};
}

async function writeSyncData(updates) {
  const current = await readSyncData();
  const merged = Object.assign({}, current, updates);
  const { error } = await supabase
    .from('ace_sync')
    .upsert({ id: 1, data: merged, updated_at: new Date().toISOString() });
  if (error) console.error('Supabase write error:', error.message);
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

const _activityCache = new Map();

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
      id:            r.id,
      date:          r.start_date.split('T')[0],
      name:          r.name,
      distance_km:   Math.round(r.distance / 10) / 100,
      time_minutes:  Math.round(r.moving_time / 60),
      elevation_m:   Math.round(r.total_elevation_gain),
      avg_hr:        r.average_heartrate ? Math.round(r.average_heartrate) : null,
      max_hr:        r.max_heartrate     ? Math.round(r.max_heartrate)     : null,
      avg_speed_kmh: Math.round((r.average_speed * 3.6) * 10) / 10,
      max_speed_kmh: r.max_speed         ? Math.round(r.max_speed * 3.6 * 10) / 10 : null,
      suffer_score:  r.suffer_score      || null,
      achievements:  r.achievement_count || 0,
      kudos:         r.kudos_count       || 0,
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
      longest_ride_km:     longestRide  ? Math.round(longestRide.distance / 10) / 100 : 0,
      most_elevation_m:    mostElevRide ? Math.round(mostElevRide.total_elevation_gain) : 0,
      best_avg_speed_kmh:  fastestRide  ? Math.round((fastestRide.average_speed * 3.6) * 10) / 10 : 0,
      longest_streak_days: maxStreak,
    },
    all_rides: allRides,
  };
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  cors(res);

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // ── PWA manifest ──
  if (req.url === '/manifest.json') {
    const manifest = {
      name: 'ACE Dashboard',
      short_name: 'ACE',
      description: "Craig's personal ACE system",
      start_url: '/',
      display: 'standalone',
      background_color: '#0c0b14',
      theme_color: '#0c0b14',
      orientation: 'portrait-primary',
      icons: [
        { src: '/icon-192.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any maskable' },
        { src: '/icon-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' },
      ],
    };
    res.writeHead(200, { 'Content-Type': 'application/manifest+json' });
    res.end(JSON.stringify(manifest));
    return;
  }

  // ── PWA icons ──
  if (req.url === '/icon-192.svg' || req.url === '/icon-512.svg') {
    const size = req.url === '/icon-192.svg' ? 192 : 512;
    const fontSize = Math.round(size * 0.52);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">
      <rect width="${size}" height="${size}" rx="${size * 0.22}" fill="#0c0b14"/>
      <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle"
        font-size="${fontSize}" font-family="system-ui">⚡</text>
    </svg>`;
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public,max-age=86400' });
    res.end(svg);
    return;
  }

  // ── PWA service worker ──
  if (req.url === '/sw.js') {
    const sw = `self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => clients.claim());
self.addEventListener('fetch', e => e.respondWith(fetch(e.request).catch(() => new Response('Offline'))));`;
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    res.end(sw);
    return;
  }

  // ── Serve dashboard ──
  if (req.url === '/' || req.url === '/index.html') {
    try {
      const html = fs.readFileSync(path.join(__dirname, 'ace-dashboard.html'), 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch (e) {
      res.writeHead(404); res.end('ace-dashboard.html not found');
    }
    return;
  }

  // ── API: sync GET ──
  if (req.url === '/api/ace-sync' && req.method === 'GET') {
    const data = await readSyncData();
    json(res, 200, data);
    return;
  }

  // ── API: sync POST ──
  if (req.url === '/api/ace-sync' && req.method === 'POST') {
    try {
      const updates = await readBody(req);
      await writeSyncData(updates);
      json(res, 200, { ok: true });
    } catch (e) {
      json(res, 400, { error: e.message });
    }
    return;
  }

  // ── Health check ──
  if (req.url === '/health') {
    const { data, error } = await supabase.from('ace_sync').select('id').eq('id', 1).maybeSingle();
    json(res, 200, {
      ok: true,
      service: 'ace-world',
      supabase: error ? 'ERROR: ' + error.message : 'connected',
      supabase_row: data ? 'row exists' : 'row missing',
    });
    return;
  }

  // ── Strava activity detail (cached) ──
  const activityMatch = req.url.match(/^\/api\/strava\/activity\/(\d+)$/);
  if (activityMatch && req.method === 'GET') {
    try {
      const id  = activityMatch[1];
      const now = Date.now();
      const TTL = 60 * 60 * 1000; // 1 hour
      if (_activityCache.has(id) && (now - _activityCache.get(id).ts) < TTL) {
        return json(res, 200, _activityCache.get(id).data);
      }
      const accessToken = await getStravaAccessToken();
      const activity = await stravaRequest({
        hostname: 'www.strava.com',
        path:     `/api/v3/activities/${id}`,
        method:   'GET',
        headers:  { Authorization: `Bearer ${accessToken}` },
      });
      _activityCache.set(id, { data: activity, ts: now });
      json(res, 200, activity);
    } catch (e) {
      console.error('Strava activity detail error:', e.message);
      json(res, 500, { error: e.message });
    }
    return;
  }

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

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => console.log(`ACE World server running on port ${PORT}`));
