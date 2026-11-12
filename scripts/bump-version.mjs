#!/usr/bin/env node
/**
 * Bump the app version in every package.json that carries it, so they never drift.
 * Usage:
 *   node scripts/bump-version.mjs 1.5.0
 *   node scripts/bump-version.mjs --help
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

const VERSION_RE = /^\d+\.\d+\.\d+$/;
const VERSION_PREFIX_RE = /^v/;
const VERSIONED_FILES = ["package.json", "apps/web/package.json"];

function usage() {
  console.log(`Usage: node scripts/bump-version.mjs <x.y.z>
Bumps version in:
${VERSIONED_FILES.map((path) => `  - ${path}`).join("\n")}

Example: node scripts/bump-version.mjs 1.5.0`);
}

const [, , rawArg] = process.argv;
if (!rawArg || rawArg === "--help" || rawArg === "-h") {
  usage();
  process.exit(rawArg ? 0 : 1);
}
const nextVersion = rawArg.replace(VERSION_PREFIX_RE, "");
if (!VERSION_RE.test(nextVersion)) {
  console.error(`Invalid version "${rawArg}" — expected x.y.z (e.g. 1.5.0)`);
  process.exit(1);
}

function bumpJson(path, newVersion) {
  const full = join(root, path);
  const json = JSON.parse(readFileSync(full, "utf8"));
  const prev = json.version;
  json.version = newVersion;
  // preserve trailing newline
  writeFileSync(full, `${JSON.stringify(json, null, 2)}\n`, "utf8");
  console.log(`  ${path}: ${prev} → ${newVersion}`);
}

console.log(`Bumping to ${nextVersion}…`);
for (const path of VERSIONED_FILES) {
  bumpJson(path, nextVersion);
}
console.log(`Done. Commit the ${VERSIONED_FILES.length} files.`);
