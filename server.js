// server.js

import express from "express";
import session from "express-session";
import fs from "fs/promises";
import path from "path";
import bcrypt from "bcrypt";
import cors from "cors";
import bodyParser from "body-parser";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const USERS_FILE = path.join(__dirname, "users.json");
const SALT_ROUNDS = 12;

// Open-Meteo endpoints
const WX_BASE = "https://api.open-meteo.com/v1/forecast";
const GEO_BASE = "https://geocoding-api.open-meteo.com/v1/search";
const AQ_BASE = "https://air-quality-api.open-meteo.com/v1/air-quality";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: true, credentials: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

app.use(
    session({
        secret: process.env.SESSION_SECRET || "change_this_in_prod",
        resave: false,
        saveUninitialized: false,
        cookie: { httpOnly: true, sameSite: "lax" },
    })
);

// ============================================================================
// File System Helpers
// ============================================================================

async function ensureUsersFile() {
    try {
        await fs.access(USERS_FILE);
    } catch {
        await fs.writeFile(USERS_FILE, JSON.stringify({ users: [] }, null, 2), "utf-8");
    }
}

async function readUsers() {
    await ensureUsersFile();
    const raw = await fs.readFile(USERS_FILE, "utf-8");
    const data = JSON.parse(raw || "{}");
    if (!Array.isArray(data.users)) data.users = [];
    return data.users;
}

async function writeUsers(users) {
    await fs.writeFile(USERS_FILE, JSON.stringify({ users }, null, 2), "utf-8");
}

function sanitizeId(id) {
    return String(id || "").trim();
}

// ============================================================================
// Weather API Helpers
// ============================================================================

async function resolveLocation({ city, lat, lon }) {
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
        return { lat, lon, label: `Latitude: ${lat}, Longitude: ${lon}` };
    }
    if (city) {
        const url = `${GEO_BASE}?name=${encodeURIComponent(city)}&count=1&language=en&format=json`;
        const r = await fetch(url);
        if (!r.ok) throw new Error(`Geocoding failed: ${r.status}`);
        const data = await r.json();
        if (!data.results?.length) throw new Error(`City not found: ${city}`);
        const x = data.results[0];
        return {
            lat: x.latitude,
            lon: x.longitude,
            label: [x.name, x.admin1, x.country].filter(Boolean).join(", "),
        };
    }
    // Default: Austin, TX
    return { lat: 30.2672, lon: -97.7431, label: "Austin, TX, United States" };
}

async function fetchWeather(lat, lon, timezone = "auto") {
    const params = new URLSearchParams({
        latitude: lat,
        longitude: lon,
        timezone,
        hourly: [
            "temperature_2m",
            "relative_humidity_2m",
            "visibility",
            "uv_index",
            "precipitation_probability",
        ].join(","),
        daily: [
            "temperature_2m_min",
            "temperature_2m_max",
            "precipitation_probability_max",
            "sunrise",
            "sunset",
            "uv_index_max",
        ].join(","),
        current: ["temperature_2m", "relative_humidity_2m", "uv_index"].join(","),
    });
    const r = await fetch(`${WX_BASE}?${params.toString()}`);
    if (!r.ok) throw new Error(`Forecast failed: ${r.status} ${r.statusText}`);
    return r.json();
}

async function fetchAirQuality(lat, lon, timezone = "auto") {
    const params = new URLSearchParams({
        latitude: lat,
        longitude: lon,
        timezone,
        hourly: ["us_aqi", "pm2_5"].join(","),
    });
    const r = await fetch(`${AQ_BASE}?${params.toString()}`);
    if (!r.ok) throw new Error(`Air quality failed: ${r.status} ${r.statusText}`);
    return r.json();
}

function currentLocalHourKey(timezone) {
    try {
        const fmt = new Intl.DateTimeFormat("en-CA", {
            timeZone: timezone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            hour12: false,
        });
        const parts = fmt.formatToParts(new Date());
        const get = type => parts.find(p => p.type === type)?.value.padStart(2, "0");
        const y = get("year");
        const m = get("month");
        const d = get("day");
        const h = get("hour");
        if (!y || !m || !d || !h) return null;
        return `${y}-${m}-${d}T${h}`;
    } catch {
        return null;
    }
}

function normalizeData(wx, aq, meta) {
    const nowMs = Date.now();

    const hourlyTimes = wx.hourly?.time || [];
    const hourlyTemp = wx.hourly?.temperature_2m || [];
    const hourlyHum = wx.hourly?.relative_humidity_2m || [];
    const hourlyVis = wx.hourly?.visibility || [];
    const hourlyUv = wx.hourly?.uv_index || [];
    const hourlyProb = wx.hourly?.precipitation_probability || [];

    let nowIndex = 0;
    if (hourlyTimes.length) {
        const keyNow = currentLocalHourKey(wx.timezone);
        if (keyNow) {
            const i = hourlyTimes.findIndex(t => String(t).slice(0, 13) === keyNow);
            if (i !== -1) nowIndex = i;
        }
    }

    const hourly24 = [];
    for (let k = 0; k < 24 && nowIndex + k < hourlyTimes.length; k++) {
        const i = nowIndex + k;
        hourly24.push({
            time: hourlyTimes[i],
            temp_c: num(hourlyTemp[i]),
            humidity: num(hourlyHum[i]),
            visibility_m: num(hourlyVis[i]),
            uv_index: num(hourlyUv[i]),
            precip_prob: num(hourlyProb[i]),
        });
    }

    const dTimes = wx.daily?.time || [];
    const tmin = wx.daily?.temperature_2m_min || [];
    const tmax = wx.daily?.temperature_2m_max || [];
    const dProb = wx.daily?.precipitation_probability_max || [];
    const dSunrise = wx.daily?.sunrise || [];
    const dSunset = wx.daily?.sunset || [];
    const dUvMax = wx.daily?.uv_index_max || [];

    const daily7 = [];
    for (let i = 0; i < Math.min(7, dTimes.length); i++) {
        daily7.push({
            date: dTimes[i],
            min_c: num(tmin[i]),
            max_c: num(tmax[i]),
            precip_prob_max: num(dProb[i]),
            sunrise: dSunrise[i] || null,
            sunset: dSunset[i] || null,
            uv_index_max: num(dUvMax[i]),
        });
    }

    const idx = hourlyTimes.length ? nowIndex : null;
    const current = {
        humidity: idx != null ? num(hourlyHum[idx]) : null,
        visibility_m: idx != null ? num(hourlyVis[idx]) : null,
        uv_index: idx != null ? num(hourlyUv[idx]) : null,
        sunrise: daily7[0]?.sunrise || null,
        sunset: daily7[0]?.sunset || null,
        air_quality: nearestAirQuality(aq, nowMs),
    };

    return {
        location: meta.label,
        latitude: meta.lat,
        longitude: meta.lon,
        timezone: wx.timezone,
        generated_at: new Date().toISOString(),
        current,
        hourly24,
        daily7,
    };
}

function nearestTimeIndex(times, nowMs) {
    if (!times?.length) return null;
    let best = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < times.length; i++) {
        const t = new Date(times[i]).getTime();
        const diff = Math.abs(t - nowMs);
        if (diff < bestDiff) {
            best = i;
            bestDiff = diff;
        }
    }
    return best;
}

function nearestAirQuality(aq, nowMs) {
    try {
        const times = aq?.hourly?.time || [];
        const us = aq?.hourly?.us_aqi || [];
        const pm25 = aq?.hourly?.pm2_5 || [];
        if (!times.length) return null;
        const idx = nearestTimeIndex(times, nowMs);
        return {
            us_aqi: num(us[idx]),
            pm2_5: num(pm25[idx]),
        };
    } catch {
        return null;
    }
}

function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

// ============================================================================
// Ollama AI Helpers
// ============================================================================

async function askOllama(prompt) {
    const body = {
        model: "llama3",
        prompt,
        stream: false,
        options: { temperature: 0.3, top_p: 0.9 }
    };

    const res = await fetch("http://127.0.0.1:11434/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Ollama error ${res.status}: ${text}`);
    }

    const data = await res.json();
    return data.response || "";
}

// ============================================================================
// Authentication API Endpoints
// ============================================================================

app.get("/api/me", (req, res) => {
    if (req.session.userId) {
        return res.json({ signedIn: true, userId: req.session.userId });
    }
    res.json({ signedIn: false });
});

app.post("/api/signup", async(req, res) => {
    try {
        const { userId, password } = req.body || {};
        const id = sanitizeId(userId);
        if (!id || !password || password.length < 6) {
            return res.status(400).json({ error: "Invalid input. Password must be at least 6 chars." });
        }

        const users = await readUsers();
        if (users.find(u => u.userId.toLowerCase() === id.toLowerCase())) {
            return res.status(409).json({ error: "User already exists" });
        }

        const hash = await bcrypt.hash(password, SALT_ROUNDS);
        users.push({ userId: id, passwordHash: hash, createdAt: new Date().toISOString() });
        await writeUsers(users);

        res.json({ ok: true, message: "Sign up successful. You can sign in now." });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Server error" });
    }
});

app.post("/api/signin", async(req, res) => {
    try {
        const { userId, password } = req.body || {};
        const id = sanitizeId(userId);
        if (!id || !password) return res.status(400).json({ error: "Missing credentials" });

        const users = await readUsers();
        const user = users.find(u => u.userId.toLowerCase() === id.toLowerCase());
        if (!user) return res.status(401).json({ error: "Invalid user or password" });

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return res.status(401).json({ error: "Invalid user or password" });

        req.session.userId = user.userId;
        res.json({ ok: true, message: "Signed in", userId: user.userId });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Server error" });
    }
});

app.post("/api/change-password", async(req, res) => {
    try {
        if (!req.session.userId) return res.status(401).json({ error: "Not signed in" });

        const { currentPassword, newPassword } = req.body || {};
        if (!currentPassword || !newPassword || newPassword.length < 6) {
            return res.status(400).json({ error: "Invalid input. New password must be at least 6 chars." });
        }

        const users = await readUsers();
        const idx = users.findIndex(u => u.userId === req.session.userId);
        if (idx === -1) return res.status(401).json({ error: "Not signed in" });

        const ok = await bcrypt.compare(currentPassword, users[idx].passwordHash);
        if (!ok) return res.status(401).json({ error: "Current password incorrect" });

        users[idx].passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
        users[idx].updatedAt = new Date().toISOString();
        await writeUsers(users);

        res.json({ ok: true, message: "Password updated" });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Server error" });
    }
});

app.post("/api/delete-account", async(req, res) => {
    try {
        if (!req.session.userId) return res.status(401).json({ error: "Not signed in" });

        const { password } = req.body || {};
        if (!password) return res.status(400).json({ error: "Password required" });

        const users = await readUsers();
        const idx = users.findIndex(u => u.userId === req.session.userId);
        if (idx === -1) return res.status(401).json({ error: "Not signed in" });

        const ok = await bcrypt.compare(password, users[idx].passwordHash);
        if (!ok) return res.status(401).json({ error: "Password incorrect" });

        users.splice(idx, 1);
        await writeUsers(users);

        // Destroy session
        req.session.destroy(() => {});
        res.json({ ok: true, message: "Account deleted" });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Server error" });
    }
});

app.post("/api/signout", (req, res) => {
    req.session.destroy(() => res.json({ ok: true, message: "Signed out" }));
});

// ============================================================================
// Weather API Endpoints
// ============================================================================

app.get("/api/weather", async (req, res) => {
    try {
        let { city = "", lat, lon, tz } = req.query;
        city = String(city || "").trim();
        lat = lat !== undefined ? Number(lat) : undefined;
        lon = lon !== undefined ? Number(lon) : undefined;

        const meta = await resolveLocation({ city, lat, lon });

        const [wx, aq] = await Promise.all([
            fetchWeather(meta.lat, meta.lon, tz || "auto"),
            fetchAirQuality(meta.lat, meta.lon, tz || "auto").catch(() => null),
        ]);

        const normalized = normalizeData(wx, aq, meta);

        res.json(normalized);
    } catch (err) {
        console.error("Weather API error:", err);
        res.status(400).json({ error: err?.message || "Bad Request" });
    }
});

// ============================================================================
// Travel Planning Endpoints
// ============================================================================

app.post("/api/travel-plan", async(req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({ error: "Not signed in" });
        }

        const { destination, startDate, endDate } = req.body || {};
        if (!destination || !startDate || !endDate) {
            return res.status(400).json({ error: "Missing trip information" });
        }

        const prompt = `I'm planning a trip to ${destination}, from ${startDate} to ${endDate}.

        Please provide travel recommendations in the following format:

        MUST VISIT:
        - List 5-7 must-visit attractions or places
        - Include a brief description for each

        PACKING LIST:
        - List essential items to pack
        - Categorize by: clothing, electronics, documents, toiletries, others

        PRECAUTIONS:
        - Safety tips
        - Cultural customs to be aware of
        - Health recommendations
        - Transportation tips
        - Any seasonal considerations

        Please be specific and practical. Use clear sections with the exact headers: "MUST VISIT:", "PACKING LIST:", and "PRECAUTIONS:".`;

        const answer = await askOllama(prompt);

        res.json({
            ok: true,
            destination,
            startDate,
            endDate,
            answer
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

// ============================================================================
// Server Start
// ============================================================================

app.get("/", (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, async() => {
    await ensureUsersFile();
    console.log(`Server running at http://localhost:${PORT}`);
});