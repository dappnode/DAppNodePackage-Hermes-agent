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
const HTML_FILE = path.join(__dirname, "index.html");

const OLLAMA_CANDIDATES = [
  "http://ollama.ollama-nvidia-openwebui.dappnode:11434",
  "http://ollama.ollama-amd-openwebui.dappnode:11434",
  "http://ollama.ollama-cpu-openwebui.dappnode:11434",
];

// In-memory cache for OpenRouter models (refresh every 6 hours)
let openRouterCache = { models: [], ts: 0 };
const CACHE_TTL = 6 * 60 * 60 * 1000;

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
 * Run `hermes status` and return the output.
 */
function getHermesStatus() {
  return new Promise((resolve) => {
    execFile("hermes", ["status"], { timeout: 15000, env: { ...process.env, HERMES_HOME } }, (err, stdout, stderr) => {
      resolve({ ok: !err, output: (stdout || "") + (stderr || "") });
    });
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);

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

  // Fetch OpenRouter models (public API, cached)
  if (req.method === "GET" && url.pathname === "/api/models/openrouter") {
    const models = await fetchOpenRouterModels();
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
