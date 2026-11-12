#!/usr/bin/env node
/**
 * Creates the FIRST administrator of MediTract Web (spec §8.4).
 *
 *     set WEB_ADMIN_USERNAME=admin   (or put both in apps/web/.dev.vars; the shell wins)
 *     set WEB_ADMIN_PASSWORD=<10-128 characters>
 *     pnpm web:seed-admin                              # local D1 (the one `pnpm web:dev` uses)
 *     pnpm web:seed-admin --remote                     # production database
 *     pnpm web:seed-admin --remote --env preview       # preview database
 *     pnpm web:seed-admin --dry-run                    # show the plan, touch nothing
 *
 * Credentials are read from the environment only, are never put on a command line and are never
 * printed. The SQL (it contains the password hash) goes through a temp file that is deleted
 * afterwards. All the logic lives in `scripts/web-seed/admin.mjs`, which is unit-tested.
 */

import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

import {
  ADMIN_ACTOR_NAME,
  ADMIN_USAGE,
  adminWasWritten,
  buildAdminPreflightSql,
  buildAdminSql,
  buildAdminVerifySql,
  hashAdminPassword,
  parseAdminArgs,
  planAdminAction,
  readAdminCredentials,
  readAdminState,
} from "./web-seed/admin.mjs";
import { SeedError } from "./web-seed/errors.mjs";
import {
  describeTarget,
  parseWranglerJson,
  resolveRemoteBlock,
  runD1SqlOrThrow,
} from "./web-seed/wrangler.mjs";

const DEV_VARS = new URL("../apps/web/.dev.vars", import.meta.url);

/** WEB_ADMIN_* from apps/web/.dev.vars; variables already set in the shell win. */
function envWithDevVars() {
  if (!existsSync(DEV_VARS)) {
    return process.env;
  }
  const fromFile = Object.entries(parseEnv(readFileSync(DEV_VARS, "utf8"))).filter(
    ([key, value]) => key.startsWith("WEB_ADMIN_") && value !== ""
  );
  return { ...Object.fromEntries(fromFile), ...process.env };
}

/** @param {string} text */
function say(text) {
  process.stdout.write(`${text}\n`);
}

/**
 * @param {{ action: string, credentials: import("./web-seed/admin.mjs").AdminCredentials, dryRun: boolean, target: string }} summary
 */
function printSummary({ action, credentials, dryRun, target }) {
  say("");
  say(`MediTract Web: first administrator${dryRun ? " (dry run)" : ""}`);
  say(`  target    ${target}`);
  say(`  action    ${action}`);
  say(`  username  ${credentials.username}`);
  say(`  name      ${credentials.displayName}`);
  say(`  email     ${credentials.email ?? "(none)"}`);
  say("  role      admin, must change the password at first sign-in");
  say(`  audit     user.* row by "${ADMIN_ACTOR_NAME}" in the same SQL`);
  say("  password  (not shown)");
}

function main() {
  const options = parseAdminArgs(process.argv.slice(2));
  if (options.help) {
    say(ADMIN_USAGE);
    return;
  }
  const credentials = readAdminCredentials(envWithDevVars());
  const target = { env: options.env, remote: options.remote };
  if (options.remote) {
    resolveRemoteBlock({ env: options.env });
  }
  const label = describeTarget(target);

  if (options.dryRun) {
    printSummary({
      action: "create (or refuse, depending on the database; not checked in a dry run)",
      credentials,
      dryRun: true,
      target: label,
    });
    say("");
    say("Dry run: nothing was written, the database was not contacted.");
    say(
      `Checks at run time: no active admin exists${options.force ? " (skipped by --force)" : ""}, the username is free${options.resetPassword ? " or --reset-password is used" : ""}.`
    );
    return;
  }

  const secrets = [credentials.password];
  const preflight = runD1SqlOrThrow({
    json: true,
    secrets,
    sql: buildAdminPreflightSql(credentials.username),
    target,
  });
  const state = readAdminState(parseWranglerJson(preflight.stdout));
  const action = planAdminAction(state, options, credentials.username);

  const hash = hashAdminPassword(credentials.password);
  const { id, sql } = buildAdminSql({
    action,
    credentials,
    existingId: state.existing?.id,
    force: options.force,
    hash,
    now: new Date().toISOString(),
  });
  runD1SqlOrThrow({ secrets: [...secrets, hash], sql, target });

  const verify = runD1SqlOrThrow({
    json: true,
    secrets,
    sql: buildAdminVerifySql(id),
    target,
  });
  if (!adminWasWritten(parseWranglerJson(verify.stdout))) {
    throw new SeedError(
      "The administrator was not written: another change got in between the check and the write. Run the command again."
    );
  }
  printSummary({ action, credentials, dryRun: false, target: label });
  say("");
  say(
    "Done. Sign in with that username and the password you set; you will be asked to choose a new one."
  );
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
