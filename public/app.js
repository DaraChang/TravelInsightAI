// public/app.js
// Merged: Authentication + Full Weather functionality with all features

// ============================================================================
// API HELPERS
// ============================================================================

export async function api(path, method = "GET", body) {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error || `Request failed: ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

export function setStatus(el, msg, isError = false) {
  el.textContent = msg;
  el.style.color = isError ? "#b00020" : "#0a7a0a";
}

// ============================================================================
// AUTHENTICATION
// ============================================================================

export async function getMe() {
  try {
    return await api("/api/me");
  } catch {
    return { signedIn: false };
  }
}

export function renderUserBadge(user) {
  const badge = document.getElementById("userBadge");
  if (!badge) return;
  if (user?.signedIn && user.userId) {
    badge.textContent = user.userId;
    badge.style.display = "inline-flex";
  } else {
    badge.textContent = "Guest";
    badge.style.display = "inline-flex";
  }
}

export function toggleDisplay(selector, show) {
  document.querySelectorAll(selector).forEach(el => {
    el.style.display = show ? "" : "none";
  });
}

export async function requireSignInOrRedirect() {
  const me = await getMe();
  if (!me.signedIn) {
    window.location.href = "/";
    return null;
  }
  return me;
}

export async function signOutAndRedirect() {
  try { await api("/api/signout", "POST"); }
  finally { window.location.href = "/"; }
}

// ============================================================================
// WEATHER API
// ============================================================================

export async function callWeatherApi(params) {
  const u = new URLSearchParams(params);
  const r = await fetch(`/api/weather?${u.toString()}`);

  const text = await r.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }

  if (!r.ok) {
    const msg =
      payload.error ||
      payload.message ||
      `API failed: ${r.status} ${r.statusText}`;
    throw new Error(msg);
  }

  return payload;
}

// ============================================================================
// WEATHER FORMATTING HELPERS
// ============================================================================

export const cToF = c => (c * 9) / 5 + 32;
export const maybeConvert = (val, unit) =>
  val == null ? val : unit === "f" ? cToF(val) : val;
export const unitLabel = unit => (unit === "f" ? "°F" : "°C");

export const toDateLabel = iso => {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
};

export const fmt = v => (v == null || Number.isNaN(v) ? "—" : String(v));

export const formatDistance = m => {
  if (m == null) return "—";
  if (m >= 1000) return `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km`;
  return `${Math.round(m)} m`;
};

export function getHourFromIso(iso) {
  if (!iso) return null;
  const s = String(iso);
  const h = Number(s.slice(11, 13));
  return Number.isFinite(h) ? h : null;
}

export function formatHourLabel(iso) {
  const h = getHourFromIso(iso);
  if (h == null) return "—";
  return String(h).padStart(2, "0");
}

export function getMinutesOfDayFromIso(iso) {
  if (!iso) return null;
  const s = String(iso);
  const h = Number(s.slice(11, 13));
  const m = Number(s.slice(14, 16));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

export function currentLocalHourKey(timezone) {
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
    const get = type =>
      parts.find(p => p.type === type)?.value.padStart(2, "0");
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

// ============================================================================
// WEATHER DATA NORMALIZATION
// ============================================================================

export function normalizeWeather(apiData) {
  console.log("Raw API response:", apiData);
  
  // Server returns: { location, latitude, longitude, timezone, current, hourly24, daily7 }
  return {
    location: apiData.location || "Unknown",
    latitude: apiData.latitude,
    longitude: apiData.longitude,
    timezone: apiData.timezone || "UTC",
    generated_at: apiData.generated_at,
    current: apiData.current || {},
    hourly24: apiData.hourly24 || [],
    daily7: apiData.daily7 || []
  };
}