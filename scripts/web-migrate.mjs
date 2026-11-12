#!/usr/bin/env node
/**
 * Applies apps/web/migrations to the MediTract Web D1 database.
 *
 *     pnpm web:migrate                      # local D1 (apps/web/.wrangler/state), the default
 *     pnpm web:migrate --remote             # the D1 database in apps/web/wrangler.toml
 *     pnpm web:migrate --remote --env preview      # the preview database
 *     pnpm web:migrate --remote --env production   # the production block's database
 *
 * This wraps `wrangler d1 migrations apply DB`, run from apps/web so wrangler
 * finds wrangler.toml (binding, database id, `migrations_dir`). Migrations are
 * forward-only: wrangler records applied files in the `d1_migrations` table and
 * never re-runs them.
 *
 * The local state directory must match the one `scripts/web-dev.mjs` passes to
 * `wrangler pages dev --persist-to`, otherwise dev would see an empty database.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const WEB_DIR = join(REPO_ROOT, "apps", "web");
const WRANGLER_TOML = join(WEB_DIR, "wrangler.toml");
const LOCAL_STATE = ".wrangler/state";
const BINDING = "DB";
const ID_PLACEHOLDER = "REPLACE_WITH_D1_ID";

const LINE_BREAK = /\r?\n/u;
const TABLE_HEADER = /^\s*\[\[?\s*([^\]\s]+)\s*\]\]?\s*(?:#.*)?$/u;
const DATABASE_ID_LINE = /^\s*database_id\s*=\s*"([^"]*)"/u;
const ENV_NAME = /^[a-z][a-z0-9_-]*$/iu;

const USAGE = `Usage: node scripts/web-migrate.mjs [--local | --remote] [--env <preview|production>]
  --local        apply to wrangler's local D1 in apps/web/.wrangler/state (default)
  --remote       apply to the Cloudflare D1 database from apps/web/wrangler.toml
  --env <name>   use the [env.<name>] D1 binding (preview | production)`;

function fail(message) {
  process.stderr.write(`\n${message}\n`);
  process.exit(1);
}

/**
 * @param {string[]} argv
 * @returns {{ env: string | undefined, remote: boolean }}
 */
function parseArgs(argv) {
  const flags = new Set();
  /** @type {string | undefined} */
  let env;
  // One shared iterator: `--env <name>` consumes the following argument.
  const args = argv[Symbol.iterator]();
  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(`${USAGE}\n`);
      process.exit(0);
    } else if (arg === "--local" || arg === "--remote") {
      flags.add(arg);
    } else if (arg === "--env" || arg === "-e") {
      env = args.next().value;
    } else if (arg.startsWith("--env=")) {
      env = arg.slice("--env=".length);
    } else {
      fail(`Unknown argument: ${arg}\n\n${USAGE}`);
    }
  }
  if (flags.size > 1) {
    fail(`--local and --remote are mutually exclusive.\n\n${USAGE}`);
  }
  if (env !== undefined && !ENV_NAME.test(env)) {
    fail(`--env needs a name such as "preview" or "production".\n\n${USAGE}`);
  }
  return { env, remote: flags.has("--remote") };
}

/** Reads `database_id` from the `[[d1_databases]]` / `[[env.<name>.d1_databases]]` table. */
function readDatabaseId(toml, env) {
  const target = env ? `env.${env}.d1_databases` : "d1_databases";
  let current = "";
  for (const line of toml.split(LINE_BREAK)) {
    const header = TABLE_HEADER.exec(line);
    if (header) {
      [, current] = header;
      continue;
    }
    const id = current === target ? DATABASE_ID_LINE.exec(line) : null;
    if (id) {
      return id[1];
    }
  }
}

function assertRemoteConfigured(env) {
  const where = env ? `[[env.${env}.d1_databases]]` : "[[d1_databases]]";
  const id = readDatabaseId(readFileSync(WRANGLER_TOML, "utf8"), env);
  if (id === undefined) {
    fail(
      `No ${where} block with a database_id in apps/web/wrangler.toml${
        env
          ? ` (is "${env}" a valid environment? Pages knows "preview" and "production".)`
          : "."
      }`
    );
  }
  if (id === "" || id === ID_PLACEHOLDER) {
    fail(
      `database_id in ${where} of apps/web/wrangler.toml is still the placeholder (${ID_PLACEHOLDER}).\n` +
        "Create the database and paste the id it prints:\n" +
        `  cd apps/web && pnpm exec wrangler d1 create ${
          env === "preview" ? "meditract-preview" : "meditract"
        }`
    );
  }
}

/** The wrangler entry script, run with this Node binary: no .cmd shim, no shell, no quoting. */
function resolveWranglerEntry() {
  try {
    const require = createRequire(join(WEB_DIR, "package.json"));
    const pkgPath = require.resolve("wrangler/package.json");
    const entry = join(dirname(pkgPath), "bin", "wrangler.js");
    if (existsSync(entry)) {
      return entry;
    }
  } catch {
    // fall through to the error below
  }
  return fail(
    "wrangler is not installed for apps/web. Run `pnpm install` first."
  );
}

const options = parseArgs(process.argv.slice(2));
if (options.remote) {
  assertRemoteConfigured(options.env);
}

const wranglerArgs = [
  resolveWranglerEntry(),
  "d1",
  "migrations",
  "apply",
  BINDING,
  options.remote ? "--remote" : "--local",
];
if (!options.remote) {
  wranglerArgs.push("--persist-to", LOCAL_STATE);
}
if (options.env) {
  wranglerArgs.push("--env", options.env);
}

process.stdout.write(
  `\n$ wrangler ${wranglerArgs.slice(1).join(" ")}   (in apps/web)\n`
);
// Local runs close stdin so wrangler takes its "non-interactive: yes" path instead of
// waiting on a confirmation prompt (web-dev runs this unattended). Remote runs keep the
// terminal so a human sees and confirms what is about to change production.
const result = spawnSync(process.execPath, wranglerArgs, {
  cwd: WEB_DIR,
  stdio: [options.remote ? "inherit" : "ignore", "inherit", "inherit"],
});

if (result.error) {
  fail(`Could not start wrangler: ${result.error.message}`);
}
process.exit(result.status ?? 1);
