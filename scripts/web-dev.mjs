#!/usr/bin/env node
/**
 * MediTract Web dev loop: Vite (the SPA) + `wrangler pages dev` (the Functions API + local D1).
 *
 *     pnpm web:dev
 *
 *   http://localhost:3002   open this one: Vite with HMR; it proxies /api/* to the API
 *   http://127.0.0.1:8788   wrangler pages dev: the Functions API (a stub page for everything else)
 *
 * What it does, in order:
 *   1. creates apps/web/.dev.vars from .dev.vars.example (random SESSION_PEPPER) if missing;
 *   2. applies pending local D1 migrations (scripts/web-migrate.mjs) into apps/web/.wrangler/state;
 *   3. starts both servers with prefixed output and stops both on Ctrl+C (Windows included).
 *
 * Both children are plain Node scripts (wrangler.js and vite-plus's `vp`) started with this Node
 * binary, so there is no `.cmd` shim, no shell and no quoting to get wrong on Windows. `taskkill
 * /T /F` is still used to stop them because wrangler leaves a `workerd.exe` grandchild behind
 * when only its parent is killed.
 */

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const WEB_DIR = join(REPO_ROOT, "apps", "web");
const IS_WINDOWS = process.platform === "win32";

const VITE_PORT = 3002;
const API_PORT = 8788;
const API_HOST = "127.0.0.1";
const LOCAL_STATE = ".wrangler/state";
const KILL_GRACE_MS = 4000;

const STUB_ASSETS = join(WEB_DIR, ".wrangler", "dev-assets");
const STUB_INDEX = `<!doctype html>
<meta charset="utf-8">
<title>MediTract API (dev)</title>
<p>This is the API server (<code>wrangler pages dev</code>). Open the app at
<a href="http://localhost:${VITE_PORT}/">http://localhost:${VITE_PORT}/</a>.</p>
`;

const DEV_VARS = join(WEB_DIR, ".dev.vars");
const DEV_VARS_EXAMPLE = join(WEB_DIR, ".dev.vars.example");
const PEPPER_LINE = /^SESSION_PEPPER=.*$/mu;
const COMPAT_DATE_LINE = /^compatibility_date\s*=\s*"([^"]+)"/mu;
const PEPPER_BYTES = 32;

function fail(message) {
  process.stderr.write(`\n[dev] ${message}\n`);
  process.exit(1);
}

function ensureDevVars() {
  if (existsSync(DEV_VARS)) {
    return;
  }
  if (!existsSync(DEV_VARS_EXAMPLE)) {
    fail("apps/web/.dev.vars is missing and so is apps/web/.dev.vars.example.");
  }
  copyFileSync(DEV_VARS_EXAMPLE, DEV_VARS);
  const pepper = randomBytes(PEPPER_BYTES).toString("base64url");
  const text = readFileSync(DEV_VARS, "utf8");
  writeFileSync(
    DEV_VARS,
    text.replace(PEPPER_LINE, `SESSION_PEPPER=${pepper}`)
  );
  process.stdout.write(
    "[dev] apps/web/.dev.vars was missing: created it from .dev.vars.example with a random SESSION_PEPPER.\n" +
      "[dev] It is gitignored. Changing SESSION_PEPPER later signs everybody out.\n"
  );
}

function compatibilityDate() {
  const toml = readFileSync(join(WEB_DIR, "wrangler.toml"), "utf8");
  const match = COMPAT_DATE_LINE.exec(toml);
  if (!match) {
    return fail("No compatibility_date in apps/web/wrangler.toml.");
  }
  return match[1];
}

/**
 * `wrangler pages dev` needs a static-assets directory, and wrangler.toml's
 * `pages_build_output_dir` (./dist) would otherwise win: a stale or missing build. A stub
 * directory keeps the API server independent of any build; Vite serves the real SPA.
 */
function ensureStubAssets() {
  mkdirSync(STUB_ASSETS, { recursive: true });
  writeFileSync(join(STUB_ASSETS, "index.html"), STUB_INDEX);
}

function applyLocalMigrations() {
  const result = spawnSync(
    process.execPath,
    [join(HERE, "web-migrate.mjs"), "--local"],
    { cwd: REPO_ROOT, stdio: "inherit" }
  );
  if (result.status !== 0) {
    fail("Applying local D1 migrations failed; not starting the servers.");
  }
}

function resolveWranglerEntry() {
  try {
    const require = createRequire(join(WEB_DIR, "package.json"));
    const pkg = require.resolve("wrangler/package.json");
    const entry = join(dirname(pkg), "bin", "wrangler.js");
    if (existsSync(entry)) {
      return entry;
    }
  } catch {
    // fall through to the error below
  }
  return fail("Cannot find wrangler. Run `pnpm install` first.");
}

function resolveVpEntry() {
  const entry = join(REPO_ROOT, "node_modules", "vite-plus", "bin", "vp");
  return existsSync(entry)
    ? entry
    : fail("Cannot find vite-plus (vp). Run `pnpm install` first.");
}

function prefixLines(stream, prefix, target) {
  const lines = createInterface({ input: stream });
  lines.on("line", (line) => {
    target.write(`${prefix} ${line}\n`);
  });
}

const children = [];
let shuttingDown = false;

function start(label, args) {
  const child = spawn(process.execPath, args, {
    cwd: WEB_DIR,
    // POSIX: own process group so `kill(-pid)` reaches workerd too. Windows: taskkill /T.
    detached: !IS_WINDOWS,
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  prefixLines(child.stdout, `[${label}]`, process.stdout);
  prefixLines(child.stderr, `[${label}]`, process.stderr);
  child.on("error", (error) => {
    process.stderr.write(`[${label}] failed to start: ${error.message}\n`);
    shutdown(1);
  });
  child.on("exit", (code, signal) => {
    child.exited = true;
    if (!shuttingDown) {
      process.stderr.write(
        `[dev] ${label} exited (${signal ?? `code ${code}`}); stopping the other server.\n`
      );
      shutdown(code ?? 1);
    }
  });
  children.push(child);
}

function killTree(child) {
  if (child.exited || child.pid === undefined) {
    return;
  }
  if (IS_WINDOWS) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    });
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    // already gone
  }
}

function shutdown(exitCode) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  for (const child of children) {
    killTree(child);
  }
  // Give the children a moment to flush, then leave regardless.
  const timer = setTimeout(() => process.exit(exitCode), KILL_GRACE_MS);
  const waitForExit = () => {
    if (children.every((child) => child.exited)) {
      clearTimeout(timer);
      process.exit(exitCode);
    }
  };
  for (const child of children) {
    child.on("exit", waitForExit);
  }
  waitForExit();
}

ensureDevVars();
ensureStubAssets();
applyLocalMigrations();

process.stdout.write(
  `\n[dev] SPA  http://localhost:${VITE_PORT}   <- open this\n` +
    `[dev] API  http://${API_HOST}:${API_PORT}   (wrangler pages dev, local D1 in apps/web/${LOCAL_STATE})\n` +
    "[dev] Ctrl+C stops both.\n\n"
);

// The API. The D1 binding, vars and `.dev.vars` come from wrangler.toml / apps/web/.dev.vars.
// Do NOT pass `--d1=DB` here: that would create a database called "DB" and bypass the
// database_id that web-migrate applied the migrations to.
start("api", [
  resolveWranglerEntry(),
  "pages",
  "dev",
  STUB_ASSETS,
  "--ip",
  API_HOST,
  "--port",
  String(API_PORT),
  "--persist-to",
  LOCAL_STATE,
  "--compatibility-date",
  compatibilityDate(),
  "--show-interactive-dev-session=false",
]);

// The SPA. strictPort: a busy 3002 must be an error, not a silent hop to 3003 that the
// CSRF Origin check and your bookmarks would not expect.
start("web", [
  resolveVpEntry(),
  "dev",
  "--port",
  String(VITE_PORT),
  "--strictPort",
]);

for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"]) {
  process.on(signal, () => shutdown(0));
}
