// server.js
// Simple auth server with JSON "database" and bcrypt password hashing

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

const app = express();
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

// Ensure users.json exists
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

// Helpers
function sanitizeId(id) {
  return String(id || "").trim();
}

app.get("/api/me", (req, res) => {
  if (req.session.userId) {
    return res.json({ signedIn: true, userId: req.session.userId });
  }
  res.json({ signedIn: false });
});

// Sign up
app.post("/api/signup", async (req, res) => {
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

// Sign in
app.post("/api/signin", async (req, res) => {
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

// Change password
app.post("/api/change-password", async (req, res) => {
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

// Delete account
app.post("/api/delete-account", async (req, res) => {
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

// Sign out (optional)
app.post("/api/signout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true, message: "Signed out" }));
});

// Fallback to index.html for root
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  await ensureUsersFile();
  console.log(`Server running at http://localhost:${PORT}`);
});
