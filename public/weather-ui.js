// weather-ui.js - Handles all UI interactions for the Travel Explorer app

import { 
  api,
  renderUserBadge,
  callWeatherApi,
  setStatus,
  maybeConvert,
  unitLabel,
  toDateLabel,
  fmt,
  formatHourLabel,
  formatDistance,
  getMinutesOfDayFromIso,
  currentLocalHourKey,
  normalizeWeather
} from './app.js';

// ============================================================================
// AUTHENTICATION CHECK
// ============================================================================

async function checkAuth() {
  try {
    const me = await api("/api/me");
    if (!me.signedIn) {
      window.location.href = "/";
      return null;
    }
    renderUserBadge(me);
    return me;
  } catch (e) {
    window.location.href = "/";
    return null;
  }
}

const me = await checkAuth();
if (!me) throw new Error("Not authenticated");

// ============================================================================
// TAB SWITCHING
// ============================================================================

const tabs = document.querySelectorAll('.tab');
const tabContents = document.querySelectorAll('.tab-content');

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const targetTab = tab.dataset.tab;
    
    tabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    
    tabContents.forEach(content => content.classList.remove('active'));
    document.getElementById(`${targetTab}-content`).classList.add('active');
  });
});

// Sign Out
document.getElementById('signoutBtn').onclick = async () => {
  try {
    await api("/api/signout", "POST");
  } finally {
    window.location.href = "/";
  }
};

// ============================================================================
// TRIP PLANNING
// ============================================================================

document.getElementById('planTrip').onclick = async () => {
  const btn = document.getElementById('planTrip');
  btn.disabled = true;
  const outDiv = document.getElementById('out');
  outDiv.innerHTML = '<div class="empty-state"><span style="font-size: 3rem;">🔄</span><p>Planning your trip...</p></div>';

  try {
    const destination = document.getElementById('destination').value.trim();
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;

    if (!destination || !startDate || !endDate) {
      alert('Please fill in all fields');
      btn.disabled = false;
      return;
    }

    const data = await api("/api/travel-plan", "POST", { destination, startDate, endDate });

    if (data.error) {
      outDiv.innerHTML = '<div class="empty-state"><span style="font-size: 3rem;">❌</span><p>Error: ' + data.error + '</p></div>';
    } else {
      formatTravelPlan(outDiv, data);
    }
  } catch (e) {
    outDiv.innerHTML = '<div class="empty-state"><span style="font-size: 3rem;">❌</span><p>Request failed: ' + e.message + '</p></div>';
  } finally {
    btn.disabled = false;
  }
};

function formatTravelPlan(container, data) {
  container.innerHTML = '';
  
  const header = document.createElement('div');
  header.style.cssText = 'background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; margin-bottom: 16px;';
  header.innerHTML = `
    <div style="font-size: 1.5rem; font-weight: bold; margin-bottom: 8px;">📍 ${data.destination}</div>
    <div style="font-size: 1rem; opacity: 0.9;">📅 ${data.startDate} → ${data.endDate}</div>
  `;
  container.appendChild(header);

  const answer = data.answer;
  const sections = parseResponseIntoSections(answer);

  if (sections.mustVisit) {
    container.appendChild(createSectionCard('🏛️ Must Visit', sections.mustVisit, '#667eea'));
  }
  if (sections.packingList) {
    container.appendChild(createSectionCard('🎒 Packing List', sections.packingList, '#10b981'));
  }
  if (sections.precautions) {
    container.appendChild(createSectionCard('⚠️ Precautions & Tips', sections.precautions, '#f59e0b'));
  }

  if (!sections.mustVisit && !sections.packingList && !sections.precautions) {
    const fallbackCard = document.createElement('div');
    fallbackCard.className = 'section-card';
    fallbackCard.innerHTML = `
      <div class="section-title">📋 Travel Information</div>
      <div class="section-content" style="white-space: pre-wrap;">${answer}</div>
    `;
    container.appendChild(fallbackCard);
  }
}

function parseResponseIntoSections(text) {
  const sections = { mustVisit: '', packingList: '', precautions: '' };
  const mustVisitMatch = text.match(/MUST VISIT:?\s*([\s\S]*?)(?=PACKING LIST:|PRECAUTIONS:|$)/i);
  const packingMatch = text.match(/PACKING LIST:?\s*([\s\S]*?)(?=MUST VISIT:|PRECAUTIONS:|$)/i);
  const precautionsMatch = text.match(/PRECAUTIONS:?\s*([\s\S]*?)(?=MUST VISIT:|PACKING LIST:|$)/i);

  if (mustVisitMatch) sections.mustVisit = mustVisitMatch[1].trim();
  if (packingMatch) sections.packingList = packingMatch[1].trim();
  if (precautionsMatch) sections.precautions = precautionsMatch[1].trim();

  return sections;
}

function createSectionCard(title, content, color) {
  const card = document.createElement('div');
  card.className = 'section-card';
  
  const titleDiv = document.createElement('div');
  titleDiv.className = 'section-title';
  titleDiv.style.borderBottomColor = color;
  titleDiv.textContent = title;
  
  const contentDiv = document.createElement('div');
  contentDiv.className = 'section-content';
  contentDiv.innerHTML = formatContent(content);
  
  card.appendChild(titleDiv);
  card.appendChild(contentDiv);
  return card;
}

function formatContent(text) {
  const lines = text.split('\n').filter(line => line.trim());
  let html = '<ul>';
  
  lines.forEach(line => {
    const trimmed = line.trim();
    if (trimmed.match(/^[-•*]\s/)) {
      const content = trimmed.replace(/^[-•*]\s/, '');
      html += `<li>${content}</li>`;
    } else if (trimmed) {
      html += '</ul><p>' + trimmed + '</p><ul>';
    }
  });
  
  html += '</ul>';
  html = html.replace(/<ul><\/ul>/g, '').replace(/<ul>\s*<\/ul>/g, '');
  return html;
}

// ============================================================================
// WEATHER FEATURE - COMPLETE VERSION
// ============================================================================

const el = {
  city: document.getElementById("city"),
  lat: document.getElementById("lat"),
  lon: document.getElementById("lon"),
  unit: document.getElementById("unit"),
  go: document.getElementById("go"),
  status: document.getElementById("status"),
  locTitle: document.getElementById("locTitle"),
  meta: document.getElementById("meta"),
  currentList: document.getElementById("currentList"),
  hourlyTableBody: document.querySelector("#hourlyTable tbody"),
  hourlyPrev: document.getElementById("hourlyPrev"),
  hourlyNext: document.getElementById("hourlyNext"),
  hourlyRangeLabel: document.getElementById("hourlyRangeLabel"),
  dailyTable: document.querySelector("#dailyTable tbody"),
  dailyMinHeader: document.getElementById("dailyMinHeader"),
  dailyMaxHeader: document.getElementById("dailyMaxHeader"),
};

const hourlyState = {
  rows: [],
  unit: "c",
  sunriseMin: null,
  sunsetMin: null,
  start: 0,
  windowSize: 8,
  nowIndex: 0,
  timezone: null,
};

// Fetch weather data
async function fetchWeather() {
  try {
    el.go.disabled = true;
    setStatus(el.status, "Loading…");

    const city = (el.city?.value || "").trim();
    const latRaw = (el.lat?.value || "").trim();
    const lonRaw = (el.lon?.value || "").trim();

    const params = {};
    if (city) {
      params.city = city;
    } else if (latRaw !== "" && lonRaw !== "" && isFinite(Number(latRaw)) && isFinite(Number(lonRaw))) {
      params.lat = Number(latRaw);
      params.lon = Number(lonRaw);
    }

    const raw = await callWeatherApi(params);
    const data = normalizeWeather(raw);
    const unit = el.unit.value === "f" ? "f" : "c";

    renderMeta(data);
    renderCurrent(data.current, unit);
    setupHourly(data.hourly24 || [], unit, data.current?.sunrise, data.current?.sunset, data.timezone);
    renderDaily(data.daily7 || [], unit);

    setStatus(el.status, "");
  } catch (err) {
    console.error(err);
    clearAllUI();
    setStatus(el.status, err?.message || String(err), true);
  } finally {
    el.go.disabled = false;
  }
}

function clearAllUI() {
  el.locTitle.textContent = "Location";
  el.meta.textContent = "";
  el.currentList.innerHTML = "";
  hourlyState.rows = [];
  hourlyState.start = 0;
  el.hourlyTableBody.innerHTML = "";
  el.dailyTable.innerHTML = "";
}

function renderMeta(data) {
  el.locTitle.textContent = `Location — ${data.location}`;
  el.meta.textContent =
    `Latitude: ${Number(data.latitude).toFixed(4)}, ` +
    `Longitude: ${Number(data.longitude).toFixed(4)}\n` +
    `TimeZone: ${data.timezone} · Updated: ${new Date(data.generated_at).toLocaleString()}`;
}

function renderCurrent(current, unit) {
  const items = [];

  // Air quality
  if (current?.air_quality) {
    items.push(`Air Quality: ${fmt(current.air_quality.us_aqi)}`);
    if (current.air_quality.pm2_5 != null) {
      items.push(`PM2.5: ${Number(current.air_quality.pm2_5).toFixed(1)} µg/m³`);
    }
  } else {
    items.push("Air Quality: —");
  }

  // Visibility
  items.push(`Visibility: ${formatDistance(current?.visibility_m)}`);
  
  // Humidity
  items.push(`Humidity: ${current?.humidity != null ? current.humidity + '%' : '—'}`);
  
  // UV Index
  items.push(`UV Index: ${fmt(current?.uv_index)}`);
  
  // Sunrise/Sunset
  if (current?.sunrise) {
    items.push(`Sunrise: ${new Date(current.sunrise).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
  } else {
    items.push("Sunrise: —");
  }
  if (current?.sunset) {
    items.push(`Sunset: ${new Date(current.sunset).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
  } else {
    items.push("Sunset: —");
  }

  el.currentList.innerHTML = items.map(x => `<li>${x}</li>`).join("");
}

function setupHourly(hourly24, unit, sunriseIso, sunsetIso, timezone) {
  hourlyState.unit = unit;
  hourlyState.timezone = timezone || null;
  hourlyState.sunriseMin = getMinutesOfDayFromIso(sunriseIso);
  hourlyState.sunsetMin = getMinutesOfDayFromIso(sunsetIso);

  const rows = (hourly24 || []).map(h => ({
    timeIso: h.time,
    minutesOfDay: getMinutesOfDayFromIso(h.time),
    temp: maybeConvert(h.temp_c, unit),
    prob: h.precip_prob,
  }));

  const nowIdx = computeNowIndex(rows, timezone);
  let rotated = rows;
  if (rows.length && nowIdx > 0) {
    rotated = rows.slice(nowIdx).concat(rows.slice(0, nowIdx));
    hourlyState.nowIndex = 0;
  } else {
    hourlyState.nowIndex = nowIdx;
  }

  hourlyState.rows = rotated;
  hourlyState.start = 0;
  renderHourlyWindow();
}

function computeNowIndex(rows, timezone) {
  if (!rows?.length || !timezone) return 0;
  const keyNow = currentLocalHourKey(timezone);
  if (!keyNow) return 0;
  const idx = rows.findIndex(r => String(r.timeIso).slice(0, 13) === keyNow);
  return idx === -1 ? 0 : idx;
}

function hourLabel(globalIndex, iso) {
  if (globalIndex === hourlyState.nowIndex) return "Now";
  return formatHourLabel(iso);
}

function hourIcon(row) {
  const { prob, minutesOfDay } = row;
  const { sunriseMin, sunsetMin } = hourlyState;

  if (prob != null && prob >= 50) return "🌧️";
  if (minutesOfDay == null || sunriseMin == null || sunsetMin == null) return "-";

  const rowHour = Math.floor(minutesOfDay / 60);
  const sunriseHour = Math.floor(sunriseMin / 60);
  const sunsetHour = Math.floor(sunsetMin / 60);

  if (rowHour === sunriseHour) return "🌅";
  if (rowHour === sunsetHour) return "🌇";

  if (minutesOfDay > sunriseMin && minutesOfDay < sunsetMin) {
    return prob != null && prob >= 40 ? "⛅" : "☀️";
  }

  return prob != null && prob >= 40 ? "☁️🌙" : "🌙";
}

function renderHourlyWindow() {
  const { rows, start, windowSize, unit } = hourlyState;
  const slice = rows.slice(start, start + windowSize);
  const u = unitLabel(unit);

  if (!slice.length) {
    el.hourlyTableBody.innerHTML = "<tr><td>No hourly data.</td></tr>";
    return;
  }

  const timeCells = ['<th class="row-label">Time</th>'].concat(
    slice.map((row, i) => `<td>${hourLabel(start + i, row.timeIso)}</td>`)
  );

  const iconCells = ['<th class="row-label">Icon</th>'].concat(
    slice.map(row => `<td>${hourIcon(row)}</td>`)
  );

  const tempCells = [`<th class="row-label">Temp (${u})</th>`].concat(
    slice.map(row => `<td>${row.temp == null ? "—" : row.temp.toFixed(1)}</td>`)
  );

  const probCells = ['<th class="row-label">Rain (%)</th>'].concat(
    slice.map(row => `<td>${row.prob == null ? "—" : `${row.prob}%`}</td>`)
  );

  el.hourlyTableBody.innerHTML = `
    <tr>${timeCells.join("")}</tr>
    <tr>${iconCells.join("")}</tr>
    <tr>${tempCells.join("")}</tr>
    <tr>${probCells.join("")}</tr>
  `;

  el.hourlyPrev.disabled = start <= 0;
  const maxStart = Math.max(0, rows.length - windowSize);
  el.hourlyNext.disabled = start >= maxStart;
}

function renderDaily(daily7, unit) {
  const rows = (daily7 || []).map(d => ({
    label: toDateLabel(d.date),
    tmin: maybeConvert(d.min_c, unit),
    tmax: maybeConvert(d.max_c, unit),
    prob: d.precip_prob_max,
  }));

  el.dailyTable.innerHTML = rows
    .map(r => `
      <tr>
        <td>${r.label}</td>
        <td>${r.tmin == null ? "—" : r.tmin.toFixed(1)}</td>
        <td>${r.tmax == null ? "—" : r.tmax.toFixed(1)}</td>
        <td>${r.prob == null ? "—" : `${r.prob}%`}</td>
      </tr>
    `)
    .join("");

  const u = unitLabel(unit);
  el.dailyMinHeader.textContent = `Min (${u})`;
  el.dailyMaxHeader.textContent = `Max (${u})`;
}

// Weather event listeners
el.go?.addEventListener("click", fetchWeather);
el.unit?.addEventListener("change", fetchWeather);

el.hourlyPrev?.addEventListener("click", () => {
  if (hourlyState.start <= 0) return;
  hourlyState.start = Math.max(0, hourlyState.start - hourlyState.windowSize);
  renderHourlyWindow();
});

el.hourlyNext?.addEventListener("click", () => {
  const maxStart = Math.max(0, hourlyState.rows.length - hourlyState.windowSize);
  if (hourlyState.start >= maxStart) return;
  hourlyState.start = Math.min(maxStart, hourlyState.start + hourlyState.windowSize);
  renderHourlyWindow();
});

// ============================================================================
// ACCOUNT SETTINGS
// ============================================================================

document.getElementById('changeForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const statusEl = document.getElementById('changeStatus');
  const currentPassword = document.getElementById('currentPassword').value;
  const newPassword = document.getElementById('newPassword').value;

  try {
    setStatus(statusEl, 'Updating password...');
    await api("/api/change-password", "POST", { currentPassword, newPassword });

    try {
      await api("/api/signout", "POST");
    } catch (_) {}

    setStatus(statusEl, '✅ Password updated! Redirecting to sign in...', false);
    setTimeout(() => { window.location.href = "/"; }, 2000);
  } catch (err) {
    setStatus(statusEl, '❌ ' + err.message, true);
  }
});

document.getElementById('deleteForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  if (!confirm('Are you absolutely sure? This cannot be undone!')) {
    return;
  }

  const statusEl = document.getElementById('deleteStatus');
  const password = document.getElementById('deletePassword').value;

  try {
    setStatus(statusEl, 'Deleting account...');
    await api("/api/delete-account", "POST", { password });

    setStatus(statusEl, '✅ Account deleted. Redirecting...', false);
    renderUserBadge({ signedIn: false });
    setTimeout(() => { window.location.href = "/"; }, 2000);
  } catch (err) {
    setStatus(statusEl, '❌ ' + err.message, true);
  }
});