#!/usr/bin/env node

/**
 * API Router — `npm run api`
 *
 * One command to get the app running and open in the browser:
 *
 *   1. Verify the current Node satisfies package.json `engines`. A too-old Node
 *      does not fail cleanly here — better-sqlite3 loads and then segfaults on
 *      open (ACCESS_VIOLATION), so check up front rather than debug a crash.
 *   2. Make sure the native SQLite driver is actually usable. npm 11 blocks
 *      install scripts by default, and better-sqlite3 is an optionalDependency,
 *      so it can be silently absent. Reuses the existing ABI guard for the
 *      mismatch case and installs it when missing entirely.
 *   3. Start the dev server (`npm run dev`).
 *   4. Poll the port and open the default browser once it answers.
 *
 * Ctrl+C stops the server; the exit code is forwarded.
 */

import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { ensureNativeSqlite } from "./ensure-native-sqlite.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const require = createRequire(import.meta.url);

const NPM = process.platform === "win32" ? "npm.cmd" : "npm";
const READY_TIMEOUT_MS = 300_000;
const POLL_INTERVAL_MS = 1_000;

/**
 * Windows needs `shell: true` to launch npm, because npm ships as npm.cmd and
 * Node refuses to spawn .cmd/.bat directly since the CVE-2024-27980 fix
 * (spawn EINVAL). Every argument here is a static literal, never user input,
 * so enabling the shell introduces no injection surface.
 */
const NPM_SPAWN_OPTS = { shell: process.platform === "win32" };

function log(msg) {
  console.log(`[api] ${msg}`);
}

// ── 1. Node engine check ────────────────────────────────────────────────────

/** Minimal semver compare: -1 | 0 | 1. */
function cmp(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * Evaluate a range of the exact shape package.json uses:
 * ">=22.22.2 <23 || >=24.0.0 <27". Deliberately not a full semver
 * implementation — it only has to understand this project's own range.
 */
function satisfies(version, range) {
  return range.split("||").some((group) =>
    group
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .every((part) => {
        const m = part.match(/^(>=|<=|>|<)?(.+)$/);
        if (!m) return false;
        const [, op = ">=", target] = m;
        const c = cmp(version, target);
        if (op === ">=") return c >= 0;
        if (op === ">") return c > 0;
        if (op === "<=") return c <= 0;
        if (op === "<") return c < 0;
        return false;
      })
  );
}

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const required = pkg.engines?.node;
const current = process.versions.node;

if (required && !satisfies(current, required)) {
  console.error(
    [
      "",
      `[api] Node ${current} is not supported by this project.`,
      `[api]   required: ${required}`,
      "",
      "[api] This matters more than it looks: on an unsupported Node the native",
      "[api] SQLite driver loads and then crashes the process on first query",
      "[api] (ACCESS_VIOLATION / segfault) rather than failing with a clear error.",
      "",
      "[api] The repo pins the right version in .nvmrc and .node-version:",
      "[api]   nvm install && nvm use      (or: fnm use / volta pin)",
      "",
    ].join("\n")
  );
  process.exit(1);
}
log(`Node ${current} satisfies engines "${required}"`);

// ── 2. Native SQLite driver ─────────────────────────────────────────────────

function sqliteUsable() {
  try {
    const Database = require("better-sqlite3");
    const db = new Database(":memory:");
    db.exec("CREATE TABLE probe (a INTEGER)");
    db.close();
    return true;
  } catch {
    return false;
  }
}

// Handles the "built for another Node ABI" case (no-op when healthy).
const guard = ensureNativeSqlite();
if (!guard.ok && guard.error) {
  console.error("[api] better-sqlite3 failed to load:", guard.error);
  process.exit(1);
}

if (!sqliteUsable()) {
  log("native SQLite driver unavailable — installing better-sqlite3 (one-time)…");
  log("  (npm 11 blocks install scripts by default, and it is an optionalDependency)");
  const install = spawnSync(
    NPM,
    ["install", "better-sqlite3", "--no-save", "--no-audit", "--no-fund"],
    { cwd: ROOT, stdio: "inherit", ...NPM_SPAWN_OPTS }
  );
  if (install.status !== 0 || !sqliteUsable()) {
    console.error(
      [
        "",
        "[api] Could not prepare the native SQLite driver.",
        "[api] Try manually:",
        "[api]   npm install better-sqlite3",
        "[api]   npm approve-scripts --allow-scripts-pending   (npm 11+)",
        "",
      ].join("\n")
    );
    process.exit(1);
  }
}
log("native SQLite driver OK");

// ── 3. Start the dev server ─────────────────────────────────────────────────

const port = Number(process.env.DASHBOARD_PORT || process.env.PORT || 20128);
const url = `http://localhost:${port}`;

log(`starting dev server on ${url} …`);
const server = spawn(NPM, ["run", "dev"], {
  cwd: ROOT,
  stdio: "inherit",
  env: process.env,
  ...NPM_SPAWN_OPTS,
});

let stopping = false;
const stop = (signal) => {
  if (stopping) return;
  stopping = true;
  if (!server.killed) server.kill(signal);
};
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

server.on("exit", (code, signal) => {
  process.exit(typeof code === "number" ? code : signal ? 1 : 0);
});

// ── 4. Wait for readiness, then open the browser ─────────────────────────────

function openBrowser(target) {
  // The URL is built from our own port, never from user input.
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", target], { detached: true, stdio: "ignore" }).unref();
  } else if (process.platform === "darwin") {
    spawn("open", [target], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("xdg-open", [target], { detached: true, stdio: "ignore" }).unref();
  }
}

async function waitForReady() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline && !stopping) {
    try {
      // Any HTTP answer means the server is listening; 401 is a perfectly good
      // signal here, so status is not checked.
      await fetch(`http://127.0.0.1:${port}/api/auth/status`, {
        signal: AbortSignal.timeout(4000),
      });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }
  return false;
}

const ready = await waitForReady();
if (ready) {
  log(`ready — opening ${url}`);
  openBrowser(url);
  log("press Ctrl+C to stop");
} else if (!stopping) {
  log(`server did not answer within ${READY_TIMEOUT_MS / 1000}s — open ${url} manually`);
}
