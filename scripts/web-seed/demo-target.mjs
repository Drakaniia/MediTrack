/**
 * Arguments and safety guards of `pnpm web:seed-demo` (spec §9: "targets local D1 or a named
 * remote database only with an explicit flag; refuse to run against production without a
 * confirmation flag"). Pure, so the guards are unit-tested (`apps/web/test/seed-demo.test.ts`).
 */

import { isIsoDate } from "./dates.mjs";
import { SeedError } from "./errors.mjs";

/** Database names that mean production, besides `--env production`. */
export const PRODUCTION_DATABASE_NAMES = ["meditract"];
const PREVIEW_ENV = "preview";
const PRODUCTION_ENV = "production";

export const DEMO_USAGE = `Usage: pnpm web:seed-demo [options]

Replaces ALL inventory data (categories, items, batches, stock movements, requests, dispensing,
disposals, notifications and their alert state) with the demo dataset, and upserts the five demo
users. Users, sessions and settings you created are kept. audit_log is append-only (database
triggers): the seed never deletes from it, it only appends a few rows.

Target (default: the LOCAL D1 of \`pnpm web:dev\`, apps/web/.wrangler/state):
  --remote --env preview --yes-i-know      the preview database (meditract-preview)
  --remote --database <name> --yes-i-know  a named remote database from wrangler.toml
  The production database ("meditract" / --env production) is refused unless you ALSO pass
  --confirm-production.

Options:
  --today YYYY-MM-DD   base date (default: today in the facility timezone, settings
                       "facility.timezone", fallback Asia/Manila)
  --dry-run            print the summary only, write nothing. Local: reads the timezone from the
                       local database when it can. With --remote nothing is contacted: pass
                       --today to be exact (timezone fallback Asia/Manila).
  -h, --help           show this text

Environment:
  WEB_DEMO_PASSWORD    password of the demo users (10-128 chars; default Demo-Password-2026)`;

/**
 * @typedef {{
 *   confirmProduction: boolean,
 *   database: string | undefined,
 *   dryRun: boolean,
 *   env: string | undefined,
 *   help: boolean,
 *   remote: boolean,
 *   today: string | undefined,
 *   yesIKnow: boolean,
 * }} DemoOptions
 */

/**
 * @param {readonly string[]} argv
 * @returns {DemoOptions}
 */
export function parseDemoArgs(argv) {
  /** @type {DemoOptions} */
  const options = {
    confirmProduction: false,
    database: undefined,
    dryRun: false,
    env: undefined,
    help: false,
    remote: false,
    today: undefined,
    yesIKnow: false,
  };
  const args = argv[Symbol.iterator]();
  /** @param {string} flag */
  const valueOf = (flag) => {
    const next = args.next();
    if (next.done || next.value.startsWith("--")) {
      throw new SeedError(`${flag} needs a value.`);
    }
    return next.value;
  };
  for (const arg of args) {
    applyDemoArg(options, arg, valueOf);
  }
  if (options.today !== undefined && !isIsoDate(options.today)) {
    throw new SeedError("--today must be a real date as YYYY-MM-DD.");
  }
  return options;
}

/**
 * @param {DemoOptions} options
 * @param {string} arg
 * @param {(flag: string) => string} valueOf
 */
function applyDemoArg(options, arg, valueOf) {
  const [flag, inline] = arg.split(/=(.*)/su);
  /** @param {string} name */
  const value = (name) => inline ?? valueOf(name);
  switch (flag) {
    case "--help":
    case "-h":
      options.help = true;
      break;
    case "--dry-run":
      options.dryRun = true;
      break;
    case "--remote":
      options.remote = true;
      break;
    case "--local":
      break;
    case "--yes-i-know":
      options.yesIKnow = true;
      break;
    case "--confirm-production":
      options.confirmProduction = true;
      break;
    case "--today":
      options.today = value("--today");
      break;
    case "--database":
      options.database = value("--database");
      break;
    case "--env":
      options.env = value("--env");
      break;
    default:
      throw new SeedError(`Unknown argument: ${arg}\n\n${DEMO_USAGE}`);
  }
}

/**
 * @param {{ database?: string, env?: string }} target
 * @param {readonly string[]} productionNames
 * @returns {boolean}
 */
export function isProductionTarget(
  target,
  productionNames = PRODUCTION_DATABASE_NAMES
) {
  if (target.env === PRODUCTION_ENV) {
    return true;
  }
  const name = target.database?.trim().toLowerCase();
  return name !== undefined && productionNames.includes(name);
}

/**
 * Validates the flags and returns where the seed goes, or throws a `SeedError`:
 *  - local is the default and needs no confirmation;
 *  - remote needs `--yes-i-know` and either `--env preview|production` or `--database <name>`;
 *  - production (`--env production`, or database `meditract`) also needs `--confirm-production`.
 * @param {DemoOptions} options
 * @param {readonly string[]} [productionNames]
 * @returns {{ database: string | undefined, env: string | undefined, production: boolean, remote: boolean }}
 */
export function resolveDemoTarget(
  options,
  productionNames = PRODUCTION_DATABASE_NAMES
) {
  if (!options.remote) {
    if (options.database !== undefined || options.env !== undefined) {
      throw new SeedError(
        "--database and --env only apply together with --remote. Without --remote the seed goes to the local D1."
      );
    }
    return { database: undefined, env: undefined, production: false, remote: false };
  }
  if (options.env !== undefined && options.database !== undefined) {
    throw new SeedError("Use --env or --database, not both.");
  }
  if (options.env === undefined && options.database === undefined) {
    throw new SeedError(
      "--remote needs a target: --env preview, or --database <name>."
    );
  }
  if (
    options.env !== undefined &&
    options.env !== PREVIEW_ENV &&
    options.env !== PRODUCTION_ENV
  ) {
    throw new SeedError('--env must be "preview" or "production".');
  }
  if (!options.yesIKnow) {
    throw new SeedError(
      "Seeding a remote database REPLACES its inventory data. Add --yes-i-know if that is what you want."
    );
  }
  const production = isProductionTarget(options, productionNames);
  if (production && !options.confirmProduction) {
    throw new SeedError(
      "Refusing to seed the PRODUCTION database with demo data: it would replace the real inventory.\n" +
        "If you are absolutely sure (a throwaway deployment, say), add --confirm-production."
    );
  }
  return {
    database: options.database,
    env: options.env,
    production,
    remote: true,
  };
}
