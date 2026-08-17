"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const serverMod = require("../setup-wizard/server.cjs");

test("parseEnvFile parses key-value lines correctly", () => {
  const input = `
# Comment
KEY1=value1
export KEY2="quoted-value"
KEY3='single-quoted'
EMPTY=
`;
  const parsed = serverMod.parseEnvFile(input);
  assert.equal(parsed.KEY1, "value1");
  assert.equal(parsed.KEY2, "quoted-value");
  assert.equal(parsed.KEY3, "single-quoted");
  assert.equal(parsed.EMPTY, "");
});

test("sanitizeReturnTo handles safe and unsafe paths", () => {
  assert.equal(serverMod.sanitizeReturnTo("/setup"), "/setup");
  assert.equal(serverMod.sanitizeReturnTo("/nexus/auth"), "/nexus/auth");
  assert.equal(serverMod.sanitizeReturnTo("https://evil.com"), "/");
  assert.equal(serverMod.sanitizeReturnTo("//evil.com"), "/");
  assert.equal(serverMod.sanitizeReturnTo(""), "/");
});

test("withReturnParams appends query parameters safely", () => {
  const res = serverMod.withReturnParams("/setup", { status: "ok", code: "123" });
  assert.equal(res, "/setup?status=ok&code=123");
});

test("readDashboardCredentials reads from env or dashboard-login.txt", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-creds-test-"));
  const origHome = process.env.HERMES_HOME;
  process.env.HERMES_HOME = tmpDir;

  try {
    // 1. Initial state: not configured
    let creds = serverMod.readDashboardCredentials();
    assert.equal(creds.available, false);

    // 2. State with dashboard-login.txt
    fs.writeFileSync(
      path.join(tmpDir, "dashboard-login.txt"),
      "Hermes dashboard login\nUsername: dappnode\nPassword: file-password-xyz\n"
    );
    creds = serverMod.readDashboardCredentials();
    assert.equal(creds.available, true);
    assert.equal(creds.username, "dappnode");
    assert.equal(creds.password, "file-password-xyz");

    // 3. State with .env overriding
    fs.writeFileSync(
      path.join(tmpDir, ".env"),
      "HERMES_DASHBOARD_BASIC_AUTH_USERNAME=admin\nHERMES_DASHBOARD_BASIC_AUTH_PASSWORD=env-password-123\n"
    );
    creds = serverMod.readDashboardCredentials();
    assert.equal(creds.available, true);
    assert.equal(creds.username, "admin");
    assert.equal(creds.password, "env-password-123");
  } finally {
    process.env.HERMES_HOME = origHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("serializeEnv preserves comments and updates keys", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-serialize-test-"));
  const origHome = process.env.HERMES_HOME;
  process.env.HERMES_HOME = tmpDir;

  try {
    fs.writeFileSync(
      path.join(tmpDir, ".env"),
      "# System settings\nKEY_A=val_a\n# Integration\nKEY_B=old_b\n"
    );
    const serialized = serverMod.serializeEnv({ KEY_B: "new_b", KEY_C: "val_c" });
    assert.match(serialized, /# System settings/);
    assert.match(serialized, /KEY_A=val_a/);
    assert.match(serialized, /KEY_B=new_b/);
    assert.match(serialized, /KEY_C=val_c/);
  } finally {
    process.env.HERMES_HOME = origHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("HTTP Server endpoints handle requests", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-test-"));
  process.env.HERMES_HOME = tmpDir;

  const server = serverMod.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(() => {
    server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await t.test("GET / serves index.html", async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.match(text, /Hermes Agent/);
    assert.match(text, /Groq/);
    assert.match(text, /Mistral/);
  });

  await t.test("GET /api/config returns default config and env", async () => {
    const res = await fetch(`${baseUrl}/api/config`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(typeof data.config === "string");
    assert.ok(typeof data.env === "object");
  });

  await t.test("POST /api/config writes config and env files", async () => {
    const res = await fetch(`${baseUrl}/api/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        env: { OPENROUTER_API_KEY: "sk-or-test-key-12345", HERMES_DASHBOARD_BASIC_AUTH_USERNAME: "dappnode" },
        configYaml: "model:\n  default: openrouter/anthropic/claude-3.7-sonnet\n",
      }),
    });
    assert.equal(res.status, 200);
    const result = await res.json();
    assert.equal(result.ok, true);

    const savedEnv = fs.readFileSync(path.join(tmpDir, ".env"), "utf-8");
    assert.match(savedEnv, /OPENROUTER_API_KEY=sk-or-test-key-12345/);
    const savedConfig = fs.readFileSync(path.join(tmpDir, "config.yaml"), "utf-8");
    assert.match(savedConfig, /claude-3.7-sonnet/);
  });

  await t.test("GET /api/doctor returns status", async () => {
    const res = await fetch(`${baseUrl}/api/doctor`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok("ok" in data);
    assert.ok("output" in data);
  });
});
