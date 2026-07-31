#!/usr/bin/env node
// Local dev convenience: poll the dashboard until it responds, then open it in
// the default browser. Used by `npm run up`. Cross-platform (win/mac/linux).
import { spawn } from "node:child_process";

const PORT = process.env.OMNIROUTE_PORT || process.env.PORT || "20128";
const URL = `http://localhost:${PORT}`;
const TIMEOUT_MS = 180_000; // give WASM cold-compile plenty of headroom
const POLL_MS = 1_000;

function openBrowser(url) {
  const platform = process.platform;
  if (platform === "win32") {
    // `start` is a cmd builtin; the empty "" is the (ignored) window title.
    spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true }).unref();
  } else if (platform === "darwin") {
    spawn("open", [url], { stdio: "ignore", detached: true }).unref();
  } else {
    spawn("xdg-open", [url], { stdio: "ignore", detached: true }).unref();
  }
}

async function waitForServer() {
  const deadline = Date.now() + TIMEOUT_MS;
  process.stdout.write(`[up] waiting for ${URL} ...\n`);
  while (Date.now() < deadline) {
    try {
      const res = await fetch(URL, { redirect: "manual" });
      // Any HTTP response (200/307/401/...) means the server is up.
      if (res.status > 0) {
        process.stdout.write(`[up] server is up (status ${res.status}); opening browser\n`);
        openBrowser(URL);
        return;
      }
    } catch {
      // not listening yet — keep polling
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  process.stderr.write(`[up] timed out waiting for ${URL} after ${TIMEOUT_MS / 1000}s\n`);
}

waitForServer();
