#!/usr/bin/env node
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");

const PORT = 8080;
const HERMES_HOME = process.env.HERMES_HOME || "/opt/data";
const CONFIG_FILE = path.join(HERMES_HOME, "config.yaml");
const ENV_FILE = path.join(HERMES_HOME, ".env");
const DASHBOARD_LOGIN_FILE = path.join(HERMES_HOME, "dashboard-login.txt");
const HTML_FILE = path.join(__dirname, "index.html");
const DASHBOARD_INTERNAL_PORT = Number(process.env.HERMES_DASHBOARD_PORT || 8081);
const DASHBOARD_PUBLIC_URL = process.env.DAPPNODE_DASHBOARD_URL
  || "http://hermes-agent.dappnode:8081/";
const DASHBOARD_LOGIN_URL = new URL("login?next=%2F", DASHBOARD_PUBLIC_URL).toString();

const OLLAMA_CANDIDATES = [
  "http://ollama-cpu.dappnode:11434",
  "http://ollama-nvidia.dappnode:11434",
  "http://ollama-amd.dappnode:11434",
  "http://ollama.dappnode:11434",
  "http://ollama.ollama-nvidia-openwebui.dappnode:11434",
  "http://ollama.ollama-amd-openwebui.dappnode:11434",
  "http://ollama.ollama-cpu-openwebui.dappnode:11434",
];

// In-memory cache for OpenRouter models (refresh every 6 hours)
let openRouterCache = { models: [], ts: 0 };
const CACHE_TTL = 6 * 60 * 60 * 1000;

// In-memory cache for Nexus models (refresh every 1 hour — models change less often)
let nexusCache = { models: [], ts: 0 };
const NEXUS_CACHE_TTL = 60 * 60 * 1000;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

/**
 * Parse a simple .env file into an object.
 */
function parseEnvFile(content) {
  const env = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

/**
 * Serialize env object back to .env format, preserving comments.
 */
function serializeEnv(env) {
  let lines = [];
  try {
    const existing = fs.readFileSync(ENV_FILE, "utf-8");
    const existingLines = existing.split("\n");
    const written = new Set();
    for (const line of existingLines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) { lines.push(line); continue; }
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 1) { lines.push(line); continue; }
      const key = trimmed.slice(0, eqIdx).trim();
      if (key in env) { lines.push(`${key}=${env[key]}`); written.add(key); }
      else { lines.push(line); }
    }
    for (const [key, val] of Object.entries(env)) {
      if (!written.has(key)) lines.push(`${key}=${val}`);
    }
  } catch {
    for (const [key, val] of Object.entries(env)) lines.push(`${key}=${val}`);
  }
  return lines.join("\n");
}

function readConfig() {
  try { return { raw: fs.readFileSync(CONFIG_FILE, "utf-8") }; }
  catch { return { raw: "" }; }
}

function readEnv() {
  try { return parseEnvFile(fs.readFileSync(ENV_FILE, "utf-8")); }
  catch { return {}; }
}

function readDashboardCredentials() {
  try {
    const values = {};
    const content = fs.readFileSync(DASHBOARD_LOGIN_FILE, "utf-8");
    for (const line of content.split("\n")) {
      const colon = line.indexOf(":");
      if (colon < 1) continue;
      const key = line.slice(0, colon).trim().toLowerCase();
      values[key] = line.slice(colon + 1).trim();
    }
    const username = values.username || "";
    const password = values.password || "";
    return {
      available: Boolean(username && password),
      username,
      password,
    };
  } catch {
    return { available: false, username: "", password: "" };
  }
}

function hasDashboardSession(cookieHeader) {
  return /(?:^|;\s*)(?:__Host-|__Secure-)?hermes_session_(?:at|rt)=/.test(cookieHeader || "");
}

function requestDashboardSession(credentials) {
  const body = Buffer.from(JSON.stringify({
    provider: "basic",
    username: credentials.username,
    password: credentials.password,
    next: "/",
  }));

  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: "127.0.0.1",
      port: DASHBOARD_INTERNAL_PORT,
      path: "/auth/password-login",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": body.length,
      },
    }, (response) => {
      const cookies = response.headers["set-cookie"] || [];
      response.resume();
      response.on("end", () => {
        if (response.statusCode === 200 && cookies.length > 0) {
          resolve(cookies);
          return;
        }
        const error = new Error(`dashboard login returned HTTP ${response.statusCode}`);
        error.dashboardResponded = true;
        error.statusCode = response.statusCode;
        reject(error);
      });
    });

    request.setTimeout(2000, () => request.destroy(new Error("dashboard login timed out")));
    request.on("error", reject);
    request.end(body);
  });
}

async function createDashboardSession(credentials) {
  let lastError;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      return await requestDashboardSession(credentials);
    } catch (error) {
      lastError = error;
      if (error.dashboardResponded) throw error;
      if (attempt < 19) await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError;
}

async function probeOllama() {
  for (const url of OLLAMA_CANDIDATES) {
    try {
      const resp = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (resp.ok) {
        const data = await resp.json();
        const models = (data.models || []).map((m) => m.name);
        return { reachable: true, url, models };
      }
    } catch {}
  }
  return { reachable: false, url: null, models: [] };
}

/**
 * Fetch models from OpenRouter's public API (no key required for listing).
 * Returns sorted array of { id, name, context_length, pricing }.
 */
async function fetchOpenRouterModels() {
  const now = Date.now();
  if (openRouterCache.models.length && (now - openRouterCache.ts) < CACHE_TTL) {
    return openRouterCache.models;
  }
  try {
    const resp = await fetch("https://openrouter.ai/api/v1/models", {
      signal: AbortSignal.timeout(10000),
      headers: { "Accept": "application/json" },
    });
    if (!resp.ok) return openRouterCache.models;
    const data = await resp.json();
    const models = (data.data || [])
      .filter((m) => m.id && !m.id.includes(":free"))
      .map((m) => ({
        id: m.id,
        name: m.name || m.id,
        context_length: m.context_length || 0,
        pricing: m.pricing ? { prompt: m.pricing.prompt, completion: m.pricing.completion } : null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    openRouterCache = { models, ts: now };
    return models;
  } catch {
    return openRouterCache.models;
  }
}

/**
 * Fetch models from Nexus public API.
 * Returns sorted array of { id, name, context_length }.
 */
async function fetchNexusModels() {
  const now = Date.now();
  if (nexusCache.models.length && (now - nexusCache.ts) < NEXUS_CACHE_TTL) {
    return nexusCache.models;
  }
  try {
    const resp = await fetch("https://nexus-api.dappnode.com/v1/models", {
      signal: AbortSignal.timeout(10000),
      headers: { "Accept": "application/json" },
    });
    if (!resp.ok) return nexusCache.models;
    const data = await resp.json();
    const models = (data.data || [])
      .filter((m) => m.id && m.kind !== "router") // exclude nexus/auto router
      .map((m) => ({
        id: m.id,
        name: m.display_name || m.id,
        context_length: m.context_size || 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    nexusCache = { models, ts: now };
    return models;
  } catch {
    return nexusCache.models;
  }
}

/**
 * Run `hermes status` and return the output.
 */
function getHermesStatus() {
  return new Promise((resolve) => {
    // This server runs as root (so /api/restart can SIGTERM PID 1 under
    // s6-overlay), but the hermes CLI must run as the unprivileged hermes
    // user — otherwise it writes root-owned files into HERMES_HOME and the
    // gateway can no longer read/write them. Drop privileges via s6-setuidgid.
    const [cmd, args] =
      process.getuid && process.getuid() === 0
        ? ["s6-setuidgid", ["hermes", "hermes", "status"]]
        : ["hermes", ["status"]];
    execFile(cmd, args, { timeout: 15000, env: { ...process.env, HERMES_HOME } }, (err, stdout, stderr) => {
      resolve({ ok: !err, output: (stdout || "") + (stderr || "") });
    });
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Create a dashboard session server-side and hand its HttpOnly cookies to
  // the browser. Cookies are scoped to the hostname, not the port, so they are
  // valid when the browser follows the redirect from :8080 to :8081.
  if (req.method === "GET" && url.pathname === "/dashboard") {
    res.setHeader("Cache-Control", "no-store");
    if (hasDashboardSession(req.headers.cookie)) {
      res.writeHead(302, { "Location": DASHBOARD_PUBLIC_URL });
      res.end();
      return;
    }

    const credentials = readDashboardCredentials();
    if (!credentials.available) {
      res.writeHead(302, { "Location": DASHBOARD_LOGIN_URL });
      res.end();
      return;
    }

    try {
      const cookies = await createDashboardSession(credentials);
      res.writeHead(302, {
        "Location": DASHBOARD_PUBLIC_URL,
        "Set-Cookie": cookies,
      });
      res.end();
    } catch (error) {
      console.error("Dashboard session bootstrap failed:", error.message);
      if (error.statusCode === 401 || error.statusCode === 404) {
        res.writeHead(302, { "Location": DASHBOARD_LOGIN_URL });
        res.end();
        return;
      }
      res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Hermes dashboard is not ready yet. Try again shortly.");
    }
    return;
  }

  // Serve the main HTML
  if (req.method === "GET" && url.pathname === "/") {
    try {
      const html = fs.readFileSync(HTML_FILE, "utf-8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    } catch {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Failed to load page");
    }
    return;
  }

  // Read existing config + env
  if (req.method === "GET" && url.pathname === "/api/config") {
    const config = readConfig();
    const env = readEnv();
    json(res, 200, { config: config.raw, env });
    return;
  }

  // Save config
  if (req.method === "POST" && url.pathname === "/api/config") {
    try {
      const body = await readBody(req);
      const incoming = JSON.parse(body);
      if (incoming.env && typeof incoming.env === "object") {
        const currentEnv = readEnv();
        const merged = Object.assign(currentEnv, incoming.env);
        fs.mkdirSync(HERMES_HOME, { recursive: true });
        fs.writeFileSync(ENV_FILE, serializeEnv(merged), "utf-8");
      }
      if (incoming.configYaml && typeof incoming.configYaml === "string") {
        fs.mkdirSync(HERMES_HOME, { recursive: true });
        fs.writeFileSync(CONFIG_FILE, incoming.configYaml, "utf-8");
      }
      json(res, 200, { ok: true });
    } catch (err) {
      json(res, 400, { error: err.message });
    }
    return;
  }

  // Probe Ollama
  if (req.method === "GET" && url.pathname === "/api/ollama/probe") {
    const result = await probeOllama();
    json(res, 200, result);
    return;
  }

  // Restart the package (kills PID 1 — Docker restart policy brings it back)
  if (req.method === "POST" && url.pathname === "/api/restart") {
    json(res, 200, { ok: true, message: "Restart triggered. Container will be back in ~5–10 seconds." });
    // Defer the kill so the response is flushed first
    setTimeout(() => {
      try {
        // Kill PID 1 (the hermes gateway) — docker-compose restart policy will recreate the container
        process.kill(1, "SIGTERM");
      } catch (e) {
        console.error("Failed to kill PID 1:", e.message);
        // Fallback: kill ourselves so at least the wizard process restarts (won't pick up new env though)
        try { process.exit(0); } catch {}
      }
    }, 250);
    return;
  }

  // Fetch OpenRouter models (public API, cached)
  if (req.method === "GET" && url.pathname === "/api/models/openrouter") {
    const models = await fetchOpenRouterModels();
    json(res, 200, { models });
    return;
  }

  // Fetch Nexus models (public API, cached)
  if (req.method === "GET" && url.pathname === "/api/models/nexus") {
    const models = await fetchNexusModels();
    json(res, 200, { models });
    return;
  }

  // Hermes status
  if (req.method === "GET" && url.pathname === "/api/status") {
    const status = await getHermesStatus();
    json(res, 200, status);
    return;
  }

  // Health check for the API server
  if (req.method === "GET" && url.pathname === "/api/health") {
    try {
      const resp = await fetch("http://localhost:3000/health", { signal: AbortSignal.timeout(5000) });
      const data = await resp.json();
      json(res, 200, { apiServer: true, ...data });
    } catch {
      json(res, 200, { apiServer: false });
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Hermes Agent UI running at http://0.0.0.0:${PORT}`);
});
