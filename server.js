const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;
const DB_FILE = path.join(__dirname, 'database.json');
const DB_TMP = path.join(__dirname, `.database.json.${process.pid}.tmp`);
const CHECK_INTERVAL = 30_000;
const FETCH_TIMEOUT = 15_000;

const SZKOPUL_START = '2026-03-31T12:00:00Z';
const CODEFORCES_START = '2026-04-12T12:00:00Z';

const DEFAULT_SITE_DATA = (start) => ({
    isUp: true,
    lastCrashTime: start,
    lastRecoveryTime: start,
    uptimeRankings: [],
    downtimeRankings: [],
    trackingStart: start,
});

const DEFAULT_DB = {
    sites: {
        szkopul: DEFAULT_SITE_DATA(SZKOPUL_START),
        codeforces: DEFAULT_SITE_DATA(CODEFORCES_START),
    },
    visitors: 1320,
};

let db;
try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    // Migration: if it's the old format, convert to new format
    if (!db.sites) {
        const oldDB = db;
        db = {
            sites: {
                szkopul: {
                    isUp: oldDB.isUp ?? true,
                    lastCrashTime: oldDB.lastCrashTime ?? SZKOPUL_START,
                    lastRecoveryTime: oldDB.lastRecoveryTime ?? SZKOPUL_START,
                    uptimeRankings: oldDB.uptimeRankings ?? [],
                    downtimeRankings: oldDB.downtimeRankings ?? [],
                    trackingStart: SZKOPUL_START,
                },
                codeforces: DEFAULT_SITE_DATA(CODEFORCES_START),
            },
            visitors: oldDB.visitors ?? 1320,
        };
        saveDB();
    }
} catch {
    db = { ...DEFAULT_DB };
    saveDB();
}

function saveDB() {
    const data = JSON.stringify(db, null, 2);
    fs.writeFileSync(DB_TMP, data);
    fs.renameSync(DB_TMP, DB_FILE);
}

function getUptimePercent(siteKey) {
    const site = db.sites[siteKey];
    if (!site) return 0;

    const now = Date.now();
    const totalMs = now - new Date(site.trackingStart).getTime();
    if (totalMs <= 0) return 100;

    let downtimeMs = 0;
    for (const d of site.downtimeRankings) {
        downtimeMs += d.durationMs;
    }

    if (!site.isUp) {
        downtimeMs += now - new Date(site.lastCrashTime).getTime();
    }

    const pct = ((totalMs - downtimeMs) / totalMs) * 100;
    return Math.max(0, Math.min(100, pct));
}

async function isHealthy(siteKey) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    try {
        let url, checkString;
        if (siteKey === 'szkopul') {
            url = 'https://szkopul.edu.pl/problemset/';
            checkString = 'problemset';
        } else if (siteKey === 'codeforces') {
            url = 'https://codeforces.com/';
            checkString = 'Codeforces';
        } else {
            return false;
        }

        const res = await fetch(url, {
            signal: controller.signal,
            headers: { 'User-Agent': 'Status-Tracker/2.0' },
        });

        if (!res.ok) return false;

        const body = await res.text();
        return body.includes(checkString);
    } catch {
        return false;
    } finally {
        clearTimeout(timeout);
    }
}

async function checkSite(siteKey) {
    const up = await isHealthy(siteKey);
    const site = db.sites[siteKey];
    const now = new Date();

    if (up && !site.isUp) {
        site.isUp = true;
        site.downtimeRankings.push({
            durationMs: now - new Date(site.lastCrashTime),
            start: site.lastCrashTime,
            end: now.toISOString(),
        });
        site.downtimeRankings.sort((a, b) => b.durationMs - a.durationMs);
        site.lastRecoveryTime = now.toISOString();
        saveDB();
    } else if (!up && site.isUp) {
        site.isUp = false;
        site.uptimeRankings.push({
            durationMs: now - new Date(site.lastRecoveryTime),
            start: site.lastRecoveryTime,
            end: now.toISOString(),
        });
        site.uptimeRankings.sort((a, b) => b.durationMs - a.durationMs);
        site.lastCrashTime = now.toISOString();
        saveDB();
    }
}

async function checkAll() {
    await checkSite('szkopul');
    await checkSite('codeforces');
}

setInterval(checkAll, CHECK_INTERVAL);
checkAll();

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

app.get('/api/status', (req, res) => {
    const siteKey = req.query.site || 'szkopul';
    const site = db.sites[siteKey];
    if (!site) return res.status(404).json({ error: 'Site not found' });

    res.json({
        isUp: site.isUp,
        lastCrashTime: site.lastCrashTime,
        lastRecoveryTime: site.lastRecoveryTime,
        downtimeCount: site.downtimeRankings.length,
        uptimePercent: getUptimePercent(siteKey),
    });
});

app.get('/api/uptime-rankings', (req, res) => {
    const siteKey = req.query.site || 'szkopul';
    const site = db.sites[siteKey];
    if (!site) return res.status(404).json({ error: 'Site not found' });

    const rankings = [...site.uptimeRankings];

    if (site.isUp) {
        const now = new Date();
        rankings.push({
            durationMs: now.getTime() - new Date(site.lastRecoveryTime).getTime(),
            start: site.lastRecoveryTime,
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

app.get('/api/cloudflare-incidents', async (req, res) => {
    const siteKey = req.query.site || 'szkopul';
    const site = db.sites[siteKey];
    if (!site) return res.status(404).json({ error: 'Site not found' });

    if (Date.now() - cfLastFetch > CF_CACHE_TTL) {
        await fetchCloudflareIncidents();
    }

    const downtimes = site.downtimeRankings.map(d => ({
        start: new Date(d.start).getTime(),
        end: new Date(d.end).getTime(),
    }));
    if (!site.isUp) {
        downtimes.push({
            start: new Date(site.lastCrashTime).getTime(),
            end: Date.now(),
        });
    }

    const filtered = cfIncidentsCache.filter(inc => {
        const incStart = new Date(inc.startedAt).getTime();
        const incEnd = inc.resolvedAt ? new Date(inc.resolvedAt).getTime() : Date.now();
        return downtimes.some(d => incStart < d.end && incEnd > d.start);
    });

    res.json(filtered);
});

app.get('/api/history', (req, res) => {
    const siteKey = req.query.site || 'szkopul';
    const site = db.sites[siteKey];
    if (!site) return res.status(404).json({ error: 'Site not found' });

    const start = new Date(site.trackingStart);
    const now = new Date();
    const MS_PER_DAY = 86400000;

    const downtimes = site.downtimeRankings.map(d => ({
        start: new Date(d.start).getTime(),
        end: new Date(d.end).getTime(),
    }));

    if (!site.isUp) {
        downtimes.push({
            start: new Date(site.lastCrashTime).getTime(),
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
    setTimeout(() => process.exit(0), 5000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
