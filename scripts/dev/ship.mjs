#!/usr/bin/env node
/**
 * ship.mjs — reliable, issue-free commit + push.
 *
 * Runs the fast HARD gates that the CI "main-green" validator enforces (the
 * ones that have actually turned main red — typecheck, lint, db-rules,
 * env/doc sync, any-budget, tracked-artifacts, docs-sync), auto-formats staged
 * files, then commits and pushes.
 *
 * Why not just `git commit`? On this Windows checkout husky's lint-staged step
 * fails intermittently (its internal git-stash/apply dance chokes on CRLF and
 * on tracked-but-gitignored files such as the generated `.source/*`). This
 * script runs the equivalent checks directly and commits with the hook shim
 * disabled — quality is preserved, but the flaky shim can't block you.
 *
 * Usage:
 *   npm run ship -- "commit message"
 *   npm run ship -- "commit message" --remote <name>      (default: upstream = online-falconova)
 *   npm run ship -- "commit message" --no-push            (commit only)
 *   SHIP_SKIP_TESTS is implied — full test suites run in CI, not per commit.
 */
import { execSync, spawnSync } from "node:child_process";
import process from "node:process";

const rawArgs = process.argv.slice(2);
let remote = "upstream";
let doPush = true;
const msgParts = [];
for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i];
  if (a === "--remote") remote = rawArgs[++i];
  else if (a === "--no-push") doPush = false;
  else msgParts.push(a);
}
const message = msgParts.join(" ").trim();

if (!message) {
  console.error('Usage: npm run ship -- "commit message" [--remote <name>] [--no-push]');
  process.exit(1);
}

// Disable the flaky husky hook shim for our own git writes (gates run below).
// `nul` is the Windows null device; git finds no hooks there and runs none.
const HOOKLESS = `-c core.hooksPath=${process.platform === "win32" ? "nul" : "/dev/null"}`;

function sh(cmd) {
  return execSync(cmd, { encoding: "utf8" }).toString();
}
function run(cmd, label) {
  const name = label || cmd;
  console.log(`\n\u25B6 ${name}`);
  const r = spawnSync(cmd, { shell: true, stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`\n\u2717 FAILED: ${name}\n  Fix the above, then re-run \`npm run ship\`.`);
    process.exit(r.status || 1);
  }
}

// 0. Anything to commit?
if (!sh("git status --porcelain").trim()) {
  console.log("Nothing to commit \u2014 working tree is clean.");
  process.exit(0);
}

// 1. Stage everything (honors .gitignore).
run("git add -A", "stage changes");

// 1b. Unstage tracked-but-gitignored files (generated artifacts like .source/*).
//     These are what break lint-staged/commit tooling when accidentally staged.
const trackedIgnored = sh("git ls-files -c -i --exclude-standard")
  .split(/\r?\n/)
  .map((s) => s.trim())
  .filter(Boolean);
const stagedNow = new Set(
  sh("git diff --cached --name-only")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
);
const toUnstage = trackedIgnored.filter((f) => stagedNow.has(f));
if (toUnstage.length) {
  console.log(`Unstaging ${toUnstage.length} gitignored file(s): ${toUnstage.join(", ")}`);
  // `git reset HEAD --` (not `git restore --staged`, which exits 127 under this
  // machine's Application Control policy) reliably unstages without untracking.
  run(
    `git reset -q HEAD -- ${toUnstage.map((f) => JSON.stringify(f)).join(" ")}`,
    "unstage ignored"
  );
}

// 2. Auto-format staged text files with Prettier, then re-stage.
const staged = sh("git diff --cached --name-only --diff-filter=ACMR")
  .split(/\r?\n/)
  .map((s) => s.trim())
  .filter(Boolean);
const prettierTargets = staged.filter((f) => /\.(m?[jt]sx?|json|css|md|ya?ml)$/.test(f));
const eslintTargets = staged.filter((f) => /\.(m?[jt]sx?)$/.test(f));
if (prettierTargets.length) {
  const list = prettierTargets.map((f) => JSON.stringify(f)).join(" ");
  run(`npx prettier --write ${list}`, "prettier --write (staged)");
}
if (eslintTargets.length) {
  const list = eslintTargets.map((f) => JSON.stringify(f)).join(" ");
  run(
    `npx eslint --fix --no-warn-ignored --no-error-on-unmatched-pattern --suppressions-location config/quality/eslint-suppressions.json ${list}`,
    "eslint --fix (staged)"
  );
}
run("git add -A", "re-stage formatted files");

// 3. Fast HARD gates (the ones that gate main-green). Full test suites run in CI.
run("npm run typecheck:core", "typecheck (core)");
run("node scripts/check/check-db-rules.mjs", "db rules");
run("node scripts/check/check-env-doc-sync.mjs", "env <-> doc sync");
run("node scripts/check/check-docs-sync.mjs", "docs version sync");
run("npm run check:any-budget:t11", "explicit-any budget");
run("node scripts/check/check-tracked-artifacts.mjs", "tracked artifacts");

// 4. Commit (hook shim disabled; gates already ran).
const escaped = message.replace(/"/g, '\\"');
run(`git ${HOOKLESS} commit -m "${escaped}"`, "commit");

// 5. Push (fast-forward; never force).
if (doPush) {
  run(`git ${HOOKLESS} push ${remote} HEAD`, `push -> ${remote}`);
  console.log(`\n\u2705 Shipped: committed and pushed to '${remote}'.`);
} else {
  console.log("\n\u2705 Committed (push skipped via --no-push).");
}
