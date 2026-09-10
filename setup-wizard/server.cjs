#!/usr/bin/env node
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");

const PORT = Number(process.env.PORT || 8080);
function getHermesHome() {
  return process.env.HERMES_HOME || "/opt/data";
}
function getConfigFile() {
  return path.join(getHermesHome(), "config.yaml");
}
function getEnvFile() {
  return path.join(getHermesHome(), ".env");
}
function getDashboardLoginFile() {
  return path.join(getHermesHome(), "dashboard-login.txt");
}

const HTML_FILE = path.join(__dirname, "index.html");
const DASHBOARD_INTERNAL_PORT = Number(process.env.HERMES_DASHBOARD_PORT || 8081);
const DASHBOARD_PUBLIC_URL = process.env.DAPPNODE_DASHBOARD_URL
  || "http://hermes-agent.dappnode:8081/";
const NEXUS_AUTHGEAR_ENDPOINT = (process.env.NEXUS_AUTHGEAR_ENDPOINT || "https://nexus-auth.dappnode.com").replace(/\/+$/, "");
const NEXUS_AUTHGEAR_CLIENT_ID = process.env.NEXUS_AUTHGEAR_CLIENT_ID || "986265c5bcad52f7";
const NEXUS_CONTROL_PLANE_URL = (process.env.NEXUS_CONTROL_PLANE_URL || "https://nexus-cp.dappnode.com").replace(/\/+$/, "");
const NEXUS_API_KEY_NAME = process.env.NEXUS_API_KEY_NAME || "Hermes Agent";
const NEXUS_AUTH_RESULT_TTL = 10 * 60 * 1000;

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
const nexusAuthStates = new Map();
const nexusAuthResults = new Map();

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

function base64Url(buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomBase64Url(bytes) {
  return base64Url(crypto.randomBytes(bytes));
}

function firstHeaderValue(value) {
  return String(value || "").split(",")[0].trim();
}

function requestOrigin(req) {
  const forwardedProto = firstHeaderValue(req.headers["x-forwarded-proto"]);
  const proto = forwardedProto === "https" || forwardedProto === "http" ? forwardedProto : "http";
  const host = firstHeaderValue(req.headers["x-forwarded-host"]) || req.headers.host || "hermes-agent.dappnode:8080";
  return `${proto}://${host}`;
}

function nexusRedirectUri(req) {
  return process.env.NEXUS_AUTH_REDIRECT_URI || `${requestOrigin(req)}/nexus/auth/callback`;
}

function sanitizeReturnTo(value) {
  if (!value || value.length > 2000 || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

function withReturnParams(returnTo, params) {
  const out = new URL(sanitizeReturnTo(returnTo), "http://hermes-agent.dappnode");
  for (const [key, value] of Object.entries(params)) {
    if (value) out.searchParams.set(key, value);
  }
  return `${out.pathname}${out.search}${out.hash}`;
}

function pruneNexusAuthMaps() {
  const now = Date.now();
  for (const [id, value] of nexusAuthStates) {
    if (value.expiresAt < now) nexusAuthStates.delete(id);
  }
  for (const [id, value] of nexusAuthResults) {
    if (value.expiresAt < now) nexusAuthResults.delete(id);
  }
}

async function exchangeNexusCode(code, state) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: NEXUS_AUTHGEAR_CLIENT_ID,
    code,
    redirect_uri: state.redirectUri,
    code_verifier: state.codeVerifier,
  });

  const resp = await fetch(`${NEXUS_AUTHGEAR_ENDPOINT}/oauth2/token`, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    signal: AbortSignal.timeout(15000),
  });
  const text = await resp.text();
  let data = {};
  try { data = JSON.parse(text); } catch {}
  if (!resp.ok) {
    throw new Error(data.error_description || data.error || `Authgear token exchange failed (${resp.status})`);
  }
  if (!data.access_token) throw new Error("Authgear did not return an access token");
  return data.access_token;
}

async function createNexusApiKey(accessToken) {
  const resp = await fetch(`${NEXUS_CONTROL_PLANE_URL}/user/apikeys`, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: NEXUS_API_KEY_NAME,
      pii_mode: "none",
    }),
    signal: AbortSignal.timeout(15000),
  });
  const text = await resp.text();
  let data = {};
  try { data = JSON.parse(text); } catch {}
  if (!resp.ok) {
    throw new Error(data.error?.message || data.message || `Nexus API key creation failed (${resp.status})`);
  }
  if (!data.raw_key) throw new Error("Nexus did not return a raw API key");
  return data.raw_key;
}

function parseEnvLine(line) {
  let trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return [null, null];
  if (trimmed.startsWith("export ")) trimmed = trimmed.slice(7).trimStart();
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx < 1) return [null, null];
  const key = trimmed.slice(0, eqIdx).trim();
  let val = trimmed.slice(eqIdx + 1).trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  return [key, val];
}

/**
 * Parse a simple .env file into an object.
 */
function parseEnvFile(content) {
  const env = {};
  for (const line of (content || "").split("\n")) {
    const [key, val] = parseEnvLine(line);
    if (key) env[key] = val;
  }
  return env;
}

/**
 * Serialize env object back to .env format, preserving comments.
 */
function serializeEnv(env) {
  const envFile = getEnvFile();
  let lines = [];
  try {
    const existing = fs.readFileSync(envFile, "utf-8");
    const existingLines = existing.split("\n");
    const written = new Set();
    for (const line of existingLines) {
      const [key] = parseEnvLine(line);
      if (key && key in env) {
        lines.push(`${key}=${env[key]}`);
        written.add(key);
      } else {
        lines.push(line);
      }
    }
    for (const [key, val] of Object.entries(env)) {
      if (!written.has(key)) lines.push(`${key}=${val}`);
    }
  } catch {
    for (const [key, val] of Object.entries(env)) lines.push(`${key}=${val}`);
  }
  return lines.join("\n").replace(/\n+$/, "") + "\n";
}

function readConfig() {
  try { return { raw: fs.readFileSync(getConfigFile(), "utf-8") }; }
  catch { return { raw: "" }; }
}

function readEnv() {
  try { return parseEnvFile(fs.readFileSync(getEnvFile(), "utf-8")); }
  catch { return {}; }
}

function readDashboardCredentials() {
  const env = readEnv();
  const envUsername = env.HERMES_DASHBOARD_BASIC_AUTH_USERNAME || "";
  const envPassword = env.HERMES_DASHBOARD_BASIC_AUTH_PASSWORD || "";
  if (envUsername && envPassword) {
    return {
      available: true,
      username: envUsername,
      password: envPassword,
    };
  }

  try {
    const values = {};
    const content = fs.readFileSync(getDashboardLoginFile(), "utf-8");
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

function dashboardBootstrapHelp(res, status, reason) {
  res.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "text/plain; charset=utf-8",
  });
  res.end([
    "Hermes dashboard auto-login is not ready.",
    "",
    reason,
    "",
    "Use the setup wizard at http://hermes-agent.dappnode:8080 to set a dashboard username and password.",
    "Save the configuration, restart the Hermes Agent package, then open:",
    "http://hermes-agent.dappnode:8080/dashboard",
    "",
    "The raw dashboard on port 8081 is intentionally password protected.",
  ].join("\n"));
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
      .filter((m) => m.id && m.kind !== "router")
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

function getExecutionEnv() {
  const venvPath = "/opt/hermes/.venv/bin";
  const pathVal = process.env.PATH ? `${venvPath}:${process.env.PATH}` : `${venvPath}:/usr/local/bin:/usr/bin:/bin`;
  return { ...process.env, HERMES_HOME: getHermesHome(), PATH: pathVal };
}

/**
 * Run `hermes status` and return the output.
 */
function getHermesStatus() {
  return new Promise((resolve) => {
    const [cmd, args] =
      process.getuid && process.getuid() === 0
        ? ["s6-setuidgid", ["hermes", "hermes", "status"]]
        : ["hermes", ["status"]];
    execFile(cmd, args, { timeout: 15000, env: getExecutionEnv() }, (err, stdout, stderr) => {
      resolve({ ok: !err, output: (stdout || "") + (stderr || "") });
    });
  });
}

/**
 * Run `hermes doctor` and return the diagnostics output.
 */
function getHermesDoctor() {
  return new Promise((resolve) => {
    const [cmd, args] =
      process.getuid && process.getuid() === 0
        ? ["s6-setuidgid", ["hermes", "hermes", "doctor"]]
        : ["hermes", ["doctor"]];
    execFile(cmd, args, { timeout: 30000, env: getExecutionEnv() }, (err, stdout, stderr) => {
      resolve({ ok: !err, output: (stdout || "") + (stderr || "") });
    });
  });
}

function handleRequest(req, res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Start Nexus Authgear login.
  if (req.method === "GET" && url.pathname === "/nexus/auth/start") {
    pruneNexusAuthMaps();
    const stateId = randomBase64Url(32);
    const codeVerifier = randomBase64Url(64);
    const codeChallenge = base64Url(crypto.createHash("sha256").update(codeVerifier).digest());
    const redirectUri = nexusRedirectUri(req);
    const returnTo = sanitizeReturnTo(url.searchParams.get("returnTo") || "/");

    nexusAuthStates.set(stateId, {
      codeVerifier,
      redirectUri,
      returnTo,
      expiresAt: Date.now() + NEXUS_AUTH_RESULT_TTL,
    });

    const authUrl = new URL(`${NEXUS_AUTHGEAR_ENDPOINT}/oauth2/authorize`);
    authUrl.searchParams.set("client_id", NEXUS_AUTHGEAR_CLIENT_ID);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("scope", "openid email profile offline_access");
    authUrl.searchParams.set("state", stateId);
    authUrl.searchParams.set("code_challenge", codeChallenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
    authUrl.searchParams.set("prompt", "login");

    res.writeHead(302, { "Location": authUrl.toString() });
    res.end();
    return;
  }

  // Finish Nexus Authgear login.
  if (req.method === "GET" && url.pathname === "/nexus/auth/callback") {
    pruneNexusAuthMaps();
    const stateId = url.searchParams.get("state") || "";
    const state = nexusAuthStates.get(stateId);
    const fallbackReturnTo = state ? state.returnTo : "/";
    const fail = (message) => {
      res.writeHead(302, { "Location": withReturnParams(fallbackReturnTo, { nexus_auth: "error", nexus_message: message }) });
      res.end();
    };

    if (url.searchParams.get("error")) {
      fail(url.searchParams.get("error_description") || "Nexus login was cancelled");
      return;
    }
    if (!state || state.expiresAt < Date.now()) {
      fail("Nexus login expired. Please try again.");
      return;
    }
    nexusAuthStates.delete(stateId);

    const code = url.searchParams.get("code") || "";
    if (!code) {
      fail("Nexus login did not return an authorization code.");
      return;
    }

    exchangeNexusCode(code, state)
      .then((accessToken) => createNexusApiKey(accessToken))
      .then((apiKey) => {
        const resultId = randomBase64Url(24);
        nexusAuthResults.set(resultId, {
          apiKey,
          expiresAt: Date.now() + NEXUS_AUTH_RESULT_TTL,
        });
        res.writeHead(302, { "Location": withReturnParams(state.returnTo, { nexus_auth: "connected", nexus_result: resultId }) });
        res.end();
      })
      .catch((error) => {
        console.error("Nexus login failed:", error.message);
        fail(error.message || "Nexus login failed");
      });
    return;
  }

  // Create a dashboard session server-side and redirect to dashboard port.
  if (req.method === "GET" && url.pathname === "/dashboard") {
    res.setHeader("Cache-Control", "no-store");
    if (hasDashboardSession(req.headers.cookie)) {
      res.writeHead(302, { "Location": DASHBOARD_PUBLIC_URL });
      res.end();
      return;
    }

    const credentials = readDashboardCredentials();
    if (!credentials.available) {
      dashboardBootstrapHelp(
        res,
        503,
        "Dashboard credentials are not configured yet."
      );
      return;
    }

    createDashboardSession(credentials)
      .then((cookies) => {
        res.writeHead(302, {
          "Location": DASHBOARD_PUBLIC_URL,
          "Set-Cookie": cookies,
        });
        res.end();
      })
      .catch((error) => {
        console.error("Dashboard session bootstrap failed:", error.message);
        if (error.statusCode === 401 || error.statusCode === 404) {
          dashboardBootstrapHelp(
            res,
            502,
            "The saved dashboard credentials were rejected. Set a fresh dashboard password in the setup wizard."
          );
          return;
        }
        res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Hermes dashboard is not ready yet. Try again shortly.");
      });
    return;
  }

  // Serve the main HTML
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/nexus" || url.pathname === "/nexus/")) {
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

  // Consume the one-time Nexus API key result generated by /nexus/auth/callback.
  if (req.method === "POST" && url.pathname === "/api/nexus/auth/result") {
    readBody(req)
      .then((body) => {
        pruneNexusAuthMaps();
        const incoming = JSON.parse(body || "{}");
        const id = typeof incoming.id === "string" ? incoming.id : "";
        const result = id ? nexusAuthResults.get(id) : null;
        if (!result || result.expiresAt < Date.now()) {
          json(res, 404, { error: "Nexus login result expired. Please log in again." });
          return;
        }
        nexusAuthResults.delete(id);
        json(res, 200, { apiKey: result.apiKey });
      })
      .catch((err) => json(res, 400, { error: err.message }));
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
    readBody(req)
      .then((body) => {
        const incoming = JSON.parse(body);
        const hermesHome = getHermesHome();
        const envFile = getEnvFile();
        const configFile = getConfigFile();

        if (incoming.env && typeof incoming.env === "object") {
          const currentEnv = readEnv();
          if (
            (incoming.env.HERMES_DASHBOARD_BASIC_AUTH_USERNAME || incoming.env.HERMES_DASHBOARD_BASIC_AUTH_PASSWORD)
            && !currentEnv.HERMES_DASHBOARD_BASIC_AUTH_SECRET
            && !incoming.env.HERMES_DASHBOARD_BASIC_AUTH_SECRET
          ) {
            incoming.env.HERMES_DASHBOARD_BASIC_AUTH_SECRET = crypto.randomBytes(32).toString("base64");
          }
          const merged = Object.assign(currentEnv, incoming.env);
          fs.mkdirSync(hermesHome, { recursive: true });
          fs.writeFileSync(envFile, serializeEnv(merged), { encoding: "utf-8", mode: 0o600 });
          try { fs.chmodSync(envFile, 0o600); } catch {}
        }
        if (incoming.configYaml && typeof incoming.configYaml === "string") {
          fs.mkdirSync(hermesHome, { recursive: true });
          fs.writeFileSync(configFile, incoming.configYaml, { encoding: "utf-8", mode: 0o644 });
          try { fs.chmodSync(configFile, 0o644); } catch {}
        }
        json(res, 200, { ok: true });
      })
      .catch((err) => json(res, 400, { error: err.message }));
    return;
  }

  // Probe Ollama
  if (req.method === "GET" && url.pathname === "/api/ollama/probe") {
    probeOllama().then((result) => json(res, 200, result));
    return;
  }

  // Restart the package (kills PID 1 — Docker restart policy brings it back)
  if (req.method === "POST" && url.pathname === "/api/restart") {
    json(res, 200, { ok: true, message: "Restart triggered. Container will be back in ~5–10 seconds." });
    setTimeout(() => {
      try {
        process.kill(1, "SIGTERM");
      } catch (e) {
        console.error("Failed to kill PID 1:", e.message);
        try { process.exit(0); } catch {}
      }
    }, 250);
    return;
  }

  // Fetch OpenRouter models (public API, cached)
  if (req.method === "GET" && url.pathname === "/api/models/openrouter") {
    fetchOpenRouterModels().then((models) => json(res, 200, { models }));
    return;
  }

  // Fetch Nexus models (public API, cached)
  if (req.method === "GET" && url.pathname === "/api/models/nexus") {
    fetchNexusModels().then((models) => json(res, 200, { models }));
    return;
  }

  // Hermes status
  if (req.method === "GET" && url.pathname === "/api/status") {
    getHermesStatus().then((status) => json(res, 200, status));
    return;
  }

  // Hermes doctor / diagnostics
  if (req.method === "GET" && url.pathname === "/api/doctor") {
    getHermesDoctor().then((doctor) => json(res, 200, doctor));
    return;
  }

  // Health check for the API server
  if (req.method === "GET" && url.pathname === "/api/health") {
    fetch("http://localhost:3000/health", { signal: AbortSignal.timeout(5000) })
      .then((resp) => resp.json())
      .then((data) => json(res, 200, { apiServer: true, ...data }))
      .catch(() => json(res, 200, { apiServer: false }));
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
}

function createServer() {
  return http.createServer(handleRequest);
}

if (require.main === module) {
  const server = createServer();
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Hermes Agent UI running at http://0.0.0.0:${PORT}`);
  });
}

module.exports = {
  createServer,
  handleRequest,
  parseEnvLine,
  parseEnvFile,
  serializeEnv,
  readConfig,
  readEnv,
  readDashboardCredentials,
  sanitizeReturnTo,
  withReturnParams,
  getHermesStatus,
  getHermesDoctor,
  probeOllama,
  fetchOpenRouterModels,
  fetchNexusModels,
};
