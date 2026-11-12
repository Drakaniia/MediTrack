#!/usr/bin/env node
/**
 * Loads the MediTract Web demo dataset (spec §9).
 *
 *     pnpm web:seed-demo                                   # local D1 (the one `pnpm web:dev` uses)
 *     pnpm web:seed-demo --today 2026-11-12                # fixed base date
 *     pnpm web:seed-demo --dry-run                         # summary only
 *     pnpm web:seed-demo --remote --env preview --yes-i-know
 *     pnpm web:seed-demo --remote --database <name> --yes-i-know
 *     (the production database additionally needs --confirm-production)
 *
 * It REPLACES the inventory data (categories, items, batches, stock movements, requests,
 * dispensing, disposals, notifications and their alert state) with `apps/web/demo/demo-data.json`
 * shifted to the base date, and upserts the five demo users. Other users, sessions and settings
 * stay; `audit_log` is append-only and only ever gets rows appended. Reruns are idempotent.
 *
 * The SQL goes through one temp `--file` (it holds the demo password hashes), deleted afterwards.
 * All logic lives in `scripts/web-seed/`, which is unit-tested.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { todayInZone } from "./web-seed/dates.mjs";
import { DEFAULT_DEMO_PASSWORD } from "./web-seed/demo-context.mjs";
import { buildDemoPlan } from "./web-seed/demo-plan.mjs";
import { buildDemoSql } from "./web-seed/demo-sql.mjs";
import { formatDemoSummary } from "./web-seed/demo-summary.mjs";
import {
  DEMO_USAGE,
  parseDemoArgs,
  resolveDemoTarget,
} from "./web-seed/demo-target.mjs";
import { SeedError } from "./web-seed/errors.mjs";
import { DEFAULT_THRESHOLDS } from "./web-seed/expiry.mjs";
import {
  describeTarget,
  parseWranglerJson,
  resolveRemoteBlock,
  runD1SqlOrThrow,
  WEB_DIR,
} from "./web-seed/wrangler.mjs";

const FALLBACK_TIME_ZONE = "Asia/Manila";
const SETTINGS_SQL =
  "SELECT key, value FROM settings WHERE key IN ('facility.timezone', 'expiry.nearDays', 'expiry.urgentDays');";
const COUNTS_SQL =
  "SELECT (SELECT count(*) FROM items) AS items, (SELECT count(*) FROM batches) AS batches, (SELECT count(*) FROM requests) AS requests, (SELECT count(*) FROM dispensing_records) AS dispensing, (SELECT count(*) FROM notifications) AS notifications;";

/** @param {string} text */
function say(text) {
  process.stdout.write(`${text}\n`);
}

/** @param {string | undefined} text */
function parseJsonValue(text) {
  try {
    return text === undefined ? undefined : JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Facility timezone and expiry thresholds from the settings table (defaults when absent).
 * @param {{ results?: Record<string, unknown>[] }[]} parsed
 */
function readFacility(parsed) {
  /** @type {Record<string, string>} */
  const values = {};
  for (const row of parsed[0]?.results ?? []) {
    values[String(row.key)] = String(row.value);
  }
  const zone = parseJsonValue(values["facility.timezone"]);
  const near = parseJsonValue(values["expiry.nearDays"]);
  const urgent = parseJsonValue(values["expiry.urgentDays"]);
  const validThresholds =
    Number.isInteger(near) && Number.isInteger(urgent) && urgent >= 0 && urgent < near;
  return {
    thresholds: validThresholds
      ? { nearDays: near, urgentDays: urgent }
      : { ...DEFAULT_THRESHOLDS },
    timeZone: typeof zone === "string" && zone !== "" ? zone : FALLBACK_TIME_ZONE,
  };
}

/**
 * @param {import("./web-seed/wrangler.mjs").D1Target} target
 * @param {boolean} dryRun
 */
function loadFacility(target, dryRun) {
  if (dryRun && target.remote) {
    return { thresholds: { ...DEFAULT_THRESHOLDS }, timeZone: FALLBACK_TIME_ZONE };
  }
  try {
    const result = runD1SqlOrThrow({ json: true, sql: SETTINGS_SQL, target });
    return readFacility(parseWranglerJson(result.stdout));
  } catch (error) {
    if (dryRun) {
      return { thresholds: { ...DEFAULT_THRESHOLDS }, timeZone: FALLBACK_TIME_ZONE };
    }
    if (error instanceof SeedError) {
      throw new SeedError(
        `${error.message}\n\nCould not read the settings table. Has the database been migrated? Run \`pnpm web:migrate\` (add --remote --env ... for a deployed database).`
      );
    }
    throw error;
  }
}

/** @param {import("./web-seed/wrangler.mjs").D1Target} target */
function verifyCounts(target) {
  const result = runD1SqlOrThrow({ json: true, sql: COUNTS_SQL, target });
  return parseWranglerJson(result.stdout)[0]?.results?.[0] ?? {};
}

function main() {
  const options = parseDemoArgs(process.argv.slice(2));
  if (options.help) {
    say(DEMO_USAGE);
    return;
  }
  const resolved = resolveDemoTarget(options);
  const target = {
    database: resolved.database,
    env: resolved.env,
    remote: resolved.remote,
  };
  if (resolved.remote) {
    resolveRemoteBlock({ database: resolved.database, env: resolved.env });
  }

  const facility = loadFacility(target, options.dryRun);
  const today = options.today ?? todayInZone(new Date(), facility.timeZone);
  const dataset = JSON.parse(
    readFileSync(join(WEB_DIR, "demo", "demo-data.json"), "utf8")
  );
  const plan = buildDemoPlan(dataset, {
    password: process.env.WEB_DEMO_PASSWORD || undefined,
    thresholds: facility.thresholds,
    timeZone: facility.timeZone,
    today,
  });
  const summary = formatDemoSummary(plan, {
    defaultPassword: DEFAULT_DEMO_PASSWORD,
    target: describeTarget(target),
  });
  const sql = buildDemoSql(plan);

  if (options.dryRun) {
    say(summary);
    say("");
    say(
      `Dry run: nothing was written (${sql.split("\n").length - 1} SQL statements prepared).`
    );
    return;
  }

  if (resolved.production) {
    say("WARNING: seeding the PRODUCTION database (--confirm-production).");
  }
  const secrets = [
    process.env.WEB_DEMO_PASSWORD ?? "",
    ...plan.tables.users.map((user) => String(user.password_hash)),
  ];
  runD1SqlOrThrow({ secrets, sql, target });
  const found = verifyCounts(target);
  const { counts } = plan.summary;
  const matches =
    found.items === counts.items &&
    found.batches === counts.batches &&
    found.requests === counts.requests &&
    found.dispensing === counts.dispensingRecords &&
    found.notifications === counts.notifications;
  if (!matches) {
    throw new SeedError(
      `The database does not hold what was just written (found ${JSON.stringify(found)}); run the command again.`
    );
  }
  say(summary);
  say("");
  say("Done. Rerunning gives the same data; pass --today to pin the base date.");
}

try {
  main();
} catch (error) {
  if (error instanceof SeedError) {
    process.stderr.write(`\n${error.message}\n`);
    process.exit(1);
  }
  throw error;
}
