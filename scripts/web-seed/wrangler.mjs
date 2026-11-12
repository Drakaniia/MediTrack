/**
 * Shared plumbing of the seed scripts: where wrangler is, which D1 block a target means, and
 * how SQL reaches it.
 *
 * SQL always travels through a temp `--file` in the OS temp dir (deleted in `finally`): it can
 * contain a password hash, and nothing secret may appear on a command line. Wrangler is run the
 * way `scripts/web-dev.mjs` and `scripts/web-migrate.mjs` run it: its `bin/wrangler.js` with this
 * Node binary, no `.cmd` shim, no shell, no quoting to get wrong on Windows. The local state
 * directory is the one `web-dev` and `web-migrate` use.
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SeedError } from "./errors.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, "..", "..");
export const WEB_DIR = join(REPO_ROOT, "apps", "web");
export const WRANGLER_TOML = join(WEB_DIR, "wrangler.toml");
export const LOCAL_STATE = ".wrangler/state";
export const BINDING = "DB";
export const ID_PLACEHOLDER = "REPLACE_WITH_D1_ID";

const LINE_BREAK = /\r?\n/u;
const TABLE_HEADER = /^\s*\[\[?\s*([^\]\s]+)\s*\]\]?\s*(?:#.*)?$/u;
const DATABASE_ID_LINE = /^\s*database_id\s*=\s*"([^"]*)"/u;
const DATABASE_NAME_LINE = /^\s*database_name\s*=\s*"([^"]*)"/u;
const ENV_TABLE = /^env\.([^.]+)\.d1_databases$/u;
const SECRET_ENV_KEY = /^WEB_(?:ADMIN_|DEMO_PASSWORD$)/u;
const MAX_OUTPUT_BYTES = 256 * 1024 * 1024;
const OUTPUT_TAIL_CHARS = 3000;
const JSON_START = /^\s*\[/mu;

/**
 * Every `[[d1_databases]]` / `[[env.<name>.d1_databases]]` block of a wrangler.toml.
 * @param {string} toml
 * @returns {{ env: string | undefined, id: string, name: string }[]}
 */
export function readD1Blocks(toml) {
  /** @type {{ env: string | undefined, id: string, name: string }[]} */
  const blocks = [];
  /** @type {{ env: string | undefined, id: string, name: string } | undefined} */
  let current;
  for (const line of toml.split(LINE_BREAK)) {
    const header = TABLE_HEADER.exec(line);
    if (header) {
      const table = header[1];
      const envMatch = ENV_TABLE.exec(table);
      if (table === "d1_databases" || envMatch) {
        current = { env: envMatch?.[1], id: "", name: "" };
        blocks.push(current);
      } else {
        current = undefined;
      }
      continue;
    }
    if (!current) {
      continue;
    }
    const name = DATABASE_NAME_LINE.exec(line);
    if (name) {
      current.name = name[1];
    }
    const id = DATABASE_ID_LINE.exec(line);
    if (id) {
      current.id = id[1];
    }
  }
  return blocks;
}

/** @returns {{ env: string | undefined, id: string, name: string }[]} */
export function readConfiguredD1Blocks() {
  return readD1Blocks(readFileSync(WRANGLER_TOML, "utf8"));
}

/**
 * The D1 block a remote target resolves to, or a `SeedError` explaining what to fix (not
 * configured, or `database_id` still the placeholder).
 * @param {{ blocks?: { env: string | undefined, id: string, name: string }[], database?: string, env?: string }} target
 */
export function resolveRemoteBlock({
  blocks = readConfiguredD1Blocks(),
  database,
  env,
}) {
  const block = blocks.find((candidate) =>
    env === undefined
      ? candidate.name === database
      : candidate.env === env
  );
  if (!block) {
    throw new SeedError(
      env === undefined
        ? `No [[d1_databases]] block named "${database}" in apps/web/wrangler.toml.`
        : `No [[env.${env}.d1_databases]] block in apps/web/wrangler.toml (Pages knows "preview" and "production").`
    );
  }
  if (block.id === "" || block.id === ID_PLACEHOLDER) {
    throw new SeedError(
      `database_id of "${block.name}" in apps/web/wrangler.toml is still the placeholder (${ID_PLACEHOLDER}).\n` +
        "Create the database and paste the id it prints:\n" +
        `  cd apps/web && pnpm exec wrangler d1 create ${block.name}`
    );
  }
  return block;
}

/** The wrangler entry script, run with this Node binary. */
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
  throw new SeedError(
    "wrangler is not installed for apps/web. Run `pnpm install` first."
  );
}

/**
 * Where a SQL file goes.
 * @typedef {{ database?: string, env?: string, remote: boolean }} D1Target
 */

/**
 * `wrangler d1 execute` arguments (without the entry script and the --file part).
 * @param {D1Target} target
 * @returns {string[]}
 */
export function d1ExecuteArgs(target) {
  const args = ["d1", "execute"];
  if (target.remote && target.database !== undefined && target.env === undefined) {
    args.push(target.database, "--remote");
  } else if (target.remote) {
    args.push(BINDING, "--remote");
  } else {
    args.push(BINDING, "--local", "--persist-to", LOCAL_STATE);
  }
  if (target.env !== undefined) {
    args.push("--env", target.env);
  }
  return args;
}

/**
 * @param {D1Target} target
 * @returns {string}
 */
export function describeTarget(target) {
  if (!target.remote) {
    return `local D1 (apps/web/${LOCAL_STATE})`;
  }
  if (target.env !== undefined) {
    return `REMOTE D1, environment "${target.env}"`;
  }
  return `REMOTE D1 database "${target.database}"`;
}

/**
 * @param {string} text
 * @param {readonly string[]} secrets
 */
function redact(text, secrets) {
  let result = text;
  for (const secret of secrets) {
    if (secret !== "") {
      result = result.split(secret).join("[redacted]");
    }
  }
  return result;
}

function childEnvironment() {
  /** @type {Record<string, string>} */
  const env = { FORCE_COLOR: "0", NO_COLOR: "1" };
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !SECRET_ENV_KEY.test(key)) {
      env[key] = value;
    }
  }
  return env;
}

/**
 * Runs `sql` against `target` with `wrangler d1 execute --file`. The file lives in a private temp
 * directory and is removed afterwards; `secrets` are scrubbed from the returned output.
 * @param {{ json?: boolean, secrets?: readonly string[], sql: string, target: D1Target }} request
 * @returns {{ status: number, stderr: string, stdout: string }}
 */
export function runD1Sql({ json = false, secrets = [], sql, target }) {
  const entry = resolveWranglerEntry();
  const directory = mkdtempSync(join(tmpdir(), "meditract-seed-"));
  const file = join(directory, "seed.sql");
  try {
    writeFileSync(file, sql, { encoding: "utf8", mode: 0o600 });
    // Remote `--file` runs return only a summary, never SELECT rows: send reads as `--command`.
    const source = json && target.remote ? ["--command", sql] : ["--file", file];
    const args = [entry, ...d1ExecuteArgs(target), ...source, "--yes"];
    if (json) {
      args.push("--json");
    }
    const result = spawnSync(process.execPath, args, {
      cwd: WEB_DIR,
      encoding: "utf8",
      env: childEnvironment(),
      maxBuffer: MAX_OUTPUT_BYTES,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    if (result.error) {
      throw new SeedError(
        `Could not start wrangler: ${redact(result.error.message, secrets)}`
      );
    }
    return {
      status: result.status ?? 1,
      stderr: redact(result.stderr ?? "", secrets),
      stdout: redact(result.stdout ?? "", secrets),
    };
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

/**
 * Like `runD1Sql`, but a non-zero exit becomes a `SeedError` carrying the tail of the output.
 * @param {{ json?: boolean, secrets?: readonly string[], sql: string, target: D1Target }} request
 */
export function runD1SqlOrThrow(request) {
  const result = runD1Sql(request);
  if (result.status !== 0) {
    const output = `${result.stdout}\n${result.stderr}`.trim();
    throw new SeedError(
      `wrangler d1 execute failed (exit ${result.status}).\n${output.slice(-OUTPUT_TAIL_CHARS)}`
    );
  }
  return result;
}

/**
 * Parses the JSON array `wrangler d1 execute --json` prints (tolerating banner lines before it).
 * @param {string} stdout
 * @returns {{ results?: Record<string, unknown>[] }[]}
 */
export function parseWranglerJson(stdout) {
  const text = stdout.trim();
  /** @param {string} candidate */
  const attempt = (candidate) => {
    try {
      const parsed = JSON.parse(candidate);
      return Array.isArray(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  };
  const whole = attempt(text);
  if (whole) {
    return whole;
  }
  const start = JSON_START.exec(text);
  const fromBracket = start ? attempt(text.slice(start.index)) : undefined;
  if (fromBracket) {
    return fromBracket;
  }
  throw new SeedError(
    `Could not read wrangler's JSON output:\n${text.slice(-OUTPUT_TAIL_CHARS)}`
  );
}
