const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;
const DB_FILE = path.join(__dirname, 'database.json');
const DB_TMP = path.join(__dirname, `.database.json.${process.pid}.tmp`);
const CHECK_INTERVAL = 30_000;
const FETCH_TIMEOUT = 15_000;
const TRACKING_START = '2026-03-31T12:00:00Z';

const DEFAULT_DB = {
    isUp: true,
    lastCrashTime: TRACKING_START,
    lastRecoveryTime: TRACKING_START,
    uptimeRankings: [],
    downtimeRankings: [],
    visitors: 1320,
};

let db;
try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
} catch {
    db = { ...DEFAULT_DB };
    saveDB();
}

function saveDB() {
    const data = JSON.stringify(db, null, 2);
    fs.writeFileSync(DB_TMP, data);
    fs.renameSync(DB_TMP, DB_FILE);
}

function getUptimePercent() {
    const now = Date.now();
    const totalMs = now - new Date(TRACKING_START).getTime();
    if (totalMs <= 0) return 100;

    let downtimeMs = 0;
    for (const d of db.downtimeRankings) {
        downtimeMs += d.durationMs;
    }

    // if currently down, add ongoing downtime
    if (!db.isUp) {
        downtimeMs += now - new Date(db.lastCrashTime).getTime();
    }

    const pct = ((totalMs - downtimeMs) / totalMs) * 100;
    return Math.max(0, Math.min(100, pct));
}

async function isHealthy() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    try {
        const res = await fetch('https://szkopul.edu.pl/problemset/', {
            signal: controller.signal,
            headers: { 'User-Agent': 'Szkopul-Uptime-Tracker/2.0' },
        });

        if (!res.ok) return false;

        const body = await res.text();
        return body.includes('problemset') || body.includes('Szkopuł');
    } catch {
        return false;
    } finally {
        clearTimeout(timeout);
    }
}

async function checkSzkopul() {
    const up = await isHealthy();
    const now = new Date();

    if (up && !db.isUp) {
        db.isUp = true;
        db.downtimeRankings.push({
            durationMs: now - new Date(db.lastCrashTime),
            start: db.lastCrashTime,
            end: now.toISOString(),
        });
        db.downtimeRankings.sort((a, b) => b.durationMs - a.durationMs);
        db.lastRecoveryTime = now.toISOString();
        saveDB();
    } else if (!up && db.isUp) {
        db.isUp = false;
        db.uptimeRankings.push({
            durationMs: now - new Date(db.lastRecoveryTime),
            start: db.lastRecoveryTime,
            end: now.toISOString(),
        });
        db.uptimeRankings.sort((a, b) => b.durationMs - a.durationMs);
        db.lastCrashTime = now.toISOString();
        saveDB();
    }
}

setInterval(checkSzkopul, CHECK_INTERVAL);
checkSzkopul();


// Ensure visitors field exists for older databases
if (db.visitors === undefined) db.visitors = 1320;

// --- Cloudflare incidents cache ---
let cfIncidentsCache = [];
let cfLastFetch = 0;
const CF_CACHE_TTL = 5 * 60 * 1000; // 5 min

async function fetchCloudflareIncidents() {
    try {
        const res = await fetch('https://www.cloudflarestatus.com/api/v2/incidents.json');
        const data = await res.json();
        cfIncidentsCache = (data.incidents || []).map(inc => ({
            name: inc.name,
            impact: inc.impact,
            status: inc.status,
            startedAt: inc.started_at,
            resolvedAt: inc.resolved_at,
        }));
        cfLastFetch = Date.now();
    } catch { /* keep stale cache */ }
}

fetchCloudflareIncidents();

const API_KEY = process.env.API_KEY || 'APIKEY';

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/database', (req, res) => {
    const key = req.headers['x-api-key'] || req.query.key;
    if (!key || key.trim() !== API_KEY.trim()) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    res.json(db);
});

app.get('/api/status', (_req, res) => {
    res.json({
        isUp: db.isUp,
        lastCrashTime: db.lastCrashTime,
        lastRecoveryTime: db.lastRecoveryTime,
        downtimeCount: db.downtimeRankings.length,
        uptimePercent: getUptimePercent(),
    });
});

app.get('/api/uptime-rankings', (_req, res) => {
    const rankings = [...db.uptimeRankings];

    // If currently up, add the ongoing uptime streak
    if (db.isUp) {
        const now = new Date();
        rankings.push({
            durationMs: now.getTime() - new Date(db.lastRecoveryTime).getTime(),
            start: db.lastRecoveryTime,
            end: now.toISOString(),
            ongoing: true,
        });
    }

    rankings.sort((a, b) => b.durationMs - a.durationMs);
    res.json(rankings);
});

app.post('/api/visit', (_req, res) => {
    db.visitors++;
    saveDB();
    res.json({ visitors: db.visitors });
});

app.get('/api/visitors', (_req, res) => {
    res.json({ visitors: db.visitors });
});

app.get('/api/cloudflare-incidents', async (_req, res) => {
    if (Date.now() - cfLastFetch > CF_CACHE_TTL) {
        await fetchCloudflareIncidents();
    }

    // Build szkopul downtime intervals
    const downtimes = db.downtimeRankings.map(d => ({
        start: new Date(d.start).getTime(),
        end: new Date(d.end).getTime(),
    }));
    if (!db.isUp) {
        downtimes.push({
            start: new Date(db.lastCrashTime).getTime(),
            end: Date.now(),
        });
    }

    // Only return CF incidents that overlap with a szkopul downtime
    const filtered = cfIncidentsCache.filter(inc => {
        const incStart = new Date(inc.startedAt).getTime();
        const incEnd = inc.resolvedAt ? new Date(inc.resolvedAt).getTime() : Date.now();
        return downtimes.some(d => incStart < d.end && incEnd > d.start);
    });

    res.json(filtered);
});

app.get('/api/history', (_req, res) => {
    const start = new Date(TRACKING_START);
    const now = new Date();
    const MS_PER_DAY = 86400000;

    // Build sorted list of downtime intervals
    const downtimes = db.downtimeRankings.map(d => ({
        start: new Date(d.start).getTime(),
        end: new Date(d.end).getTime(),
    }));

    // If currently down, add ongoing downtime
    if (!db.isUp) {
        downtimes.push({
            start: new Date(db.lastCrashTime).getTime(),
            end: now.getTime(),
        });
    }

    downtimes.sort((a, b) => a.start - b.start);

    const days = [];
    let dayStart = new Date(start);
    dayStart.setUTCHours(0, 0, 0, 0);

    while (dayStart.getTime() < now.getTime()) {
        const dayEnd = Math.min(dayStart.getTime() + MS_PER_DAY, now.getTime());
        const trackStart = Math.max(dayStart.getTime(), start.getTime());

        if (trackStart >= dayEnd) {
            dayStart = new Date(dayStart.getTime() + MS_PER_DAY);
            continue;
        }

        const dayDuration = dayEnd - trackStart;
        let downMs = 0;

        for (const d of downtimes) {
            const overlapStart = Math.max(d.start, trackStart);
            const overlapEnd = Math.min(d.end, dayEnd);
            if (overlapStart < overlapEnd) {
                downMs += overlapEnd - overlapStart;
            }
        }

        const uptimePct = ((dayDuration - downMs) / dayDuration) * 100;
        days.push({
            date: dayStart.toISOString().slice(0, 10),
            uptimePercent: Math.round(uptimePct * 100) / 100,
        });

        dayStart = new Date(dayStart.getTime() + MS_PER_DAY);
    }

    res.json(days);
});

const server = app.listen(PORT, () => console.log(`Running on http://localhost:${PORT}`));

function shutdown(signal) {
    console.log(`Received ${signal}, saving state and shutting down…`);
    server.close(() => {
        console.log('Server closed.');
        process.exit(0);
    });
    // Force exit if server hasn't closed within 5s
    setTimeout(() => process.exit(0), 5000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
