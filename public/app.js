// public/app.js
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

// Get current session user
export async function getMe() {
  try {
    return await api("/api/me");
  } catch {
    return { signedIn: false };
  }
}

// Render the top-right user badge
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

// NEW: show or hide elements by a selector
export function toggleDisplay(selector, show) {
  document.querySelectorAll(selector).forEach(el => {
    el.style.display = show ? "" : "none";
  });
}

// NEW: require sign-in; if not signed in, redirect to /
export async function requireSignInOrRedirect() {
  const me = await getMe();
  if (!me.signedIn) {
    window.location.href = "/";
    return null;
  }
  return me;
}

// NEW: signout handler with immediate redirect
export async function signOutAndRedirect() {
  try { await api("/api/signout", "POST"); }
  finally { window.location.href = "/"; }
}