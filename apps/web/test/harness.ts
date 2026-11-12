/**
 * Test harness: a real SQLite database standing in for Cloudflare D1.
 *
 * The API tests must exercise the
 * SAME SQL the deployed Functions run — the CHECK constraints, partial unique
 * indexes, the append-only audit triggers and `DB.batch()` atomicity. A stub
 * returning canned rows would prove none of that. Real D1 *is* SQLite, so the
 * only difference between this and production is where the bytes live.
 *
 * It additionally enforces the D1 rules that bite in production but not in plain
 * SQLite, so a violation fails the test run instead of the deploy:
 *  - more than 100 bound parameters in one statement → error;
 *  - binding `undefined` → error (D1 cannot bind it); booleans → error too, so
 *    intent is explicit (`1` / `0`);
 *  - `batch()` is one transaction: a throwing statement rolls everything back.
 *
 * `workers/cron` tests import this file too (relative path), so keep it free of
 * anything but `node:*` and `../server/env` types.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import type {
  D1DatabaseLike,
  D1PreparedStatement,
  D1Result,
  D1ResultMeta,
} from "../server/env";

/** `apps/web/test` → `apps/web`. */
export const WEB_ROOT = resolve(import.meta.dirname, "..");
export const MIGRATIONS_DIR = join(WEB_ROOT, "migrations");

/** D1's per-statement bound-parameter ceiling. */
export const D1_MAX_BOUND_PARAMETERS = 100;

const READ_ONLY_SQL = /^\s*(?:select|pragma|explain)\b/i;

export interface FakeD1 extends D1DatabaseLike {
  /** The underlying database, for fixtures and assertions that bypass the API. */
  sqlite: DatabaseSync;
}

function toBindable(values: readonly unknown[]): SQLInputValue[] {
  if (values.length > D1_MAX_BOUND_PARAMETERS) {
    throw new Error(
      `D1_ERROR: too many SQL variables (${values.length} > ${D1_MAX_BOUND_PARAMETERS}). Chunk the list.`
    );
  }
  return values.map((value, index) => {
    if (value === undefined) {
      throw new Error(
        `D1_TYPE_ERROR: Type 'undefined' not supported (bind index ${index}). Use null.`
      );
    }
    if (typeof value === "boolean") {
      throw new Error(
        `D1_TYPE_ERROR: bind index ${index} is a boolean. Bind 1 or 0 explicitly.`
      );
    }
    const supported =
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      value instanceof Uint8Array;
    if (!supported) {
      throw new Error(
        `D1_TYPE_ERROR: unsupported value of type ${typeof value} at bind index ${index}.`
      );
    }
    return value as SQLInputValue;
  });
}

function plain<T>(rows: unknown[]): T[] {
  return rows.map((row) => ({ ...(row as object) })) as T[];
}

/** D1 surfaces every failure as a rejected promise, never a synchronous throw. */
function settle<T>(work: () => T): Promise<T> {
  try {
    return Promise.resolve(work());
  } catch (error) {
    return Promise.reject(error);
  }
}

class FakeStatement implements D1PreparedStatement {
  readonly #sqlite: DatabaseSync;
  readonly #sql: string;
  readonly #values: readonly unknown[];

  constructor(
    sqlite: DatabaseSync,
    sql: string,
    values: readonly unknown[] = []
  ) {
    this.#sqlite = sqlite;
    this.#sql = sql;
    this.#values = values;
  }

  bind(...values: unknown[]): D1PreparedStatement {
    return new FakeStatement(this.#sqlite, this.#sql, values);
  }

  /** Runs the statement once and reports rows plus D1-style `meta`. */
  execute<T>(): D1Result<T> {
    const bound = toBindable(this.#values);
    const statement = this.#sqlite.prepare(this.#sql);
    const rows = plain<T>(statement.all(...bound));
    return { meta: this.#meta(), results: rows, success: true };
  }

  #meta(): D1ResultMeta {
    if (READ_ONLY_SQL.test(this.#sql)) {
      return { changes: 0, last_row_id: 0 };
    }
    const counters = this.#sqlite
      .prepare("SELECT changes() AS changes, last_insert_rowid() AS id")
      .get() as { changes: number; id: number | bigint };
    return {
      changed_db: counters.changes > 0,
      changes: counters.changes,
      last_row_id: Number(counters.id),
    };
  }

  all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return settle(() => this.execute<T>());
  }

  first<T = Record<string, unknown>>(): Promise<T | null> {
    return settle(() => this.execute<T>().results[0] ?? null);
  }

  raw<T = unknown[]>(): Promise<T[]> {
    return settle(
      () =>
        this.execute<Record<string, unknown>>().results.map((row) =>
          Object.values(row)
        ) as T[]
    );
  }

  run(): Promise<D1Result> {
    return settle(() => ({
      ...this.execute<Record<string, unknown>>(),
      results: [],
    }));
  }
}

/** An empty database with foreign keys on (D1 always enforces them). */
export function createFakeD1(path = ":memory:"): FakeD1 {
  const sqlite = new DatabaseSync(path);
  sqlite.exec("PRAGMA foreign_keys = ON");

  return {
    batch: <T = Record<string, unknown>>(
      statements: D1PreparedStatement[]
    ): Promise<D1Result<T>[]> => {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((statement) => {
          if (!(statement instanceof FakeStatement)) {
            throw new Error("batch() only accepts statements from this database.");
          }
          return statement.execute<T>();
        });
        sqlite.exec("COMMIT");
        return Promise.resolve(results);
      } catch (error) {
        sqlite.exec("ROLLBACK");
        return Promise.reject(error);
      }
    },
    exec: (query: string) => {
      sqlite.exec(query);
      return Promise.resolve({ count: 1, duration: 0 });
    },
    prepare: (sql: string) => new FakeStatement(sqlite, sql),
    sqlite,
  };
}

/** The migration files, oldest first. */
export function migrationFiles(dir = MIGRATIONS_DIR): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

/** Applies every migration, exactly as `wrangler d1 migrations apply` would. */
export function applyMigrations(sqlite: DatabaseSync, dir = MIGRATIONS_DIR): string[] {
  const applied: string[] = [];
  for (const file of migrationFiles(dir)) {
    sqlite.exec(readFileSync(join(dir, file), "utf8"));
    applied.push(file);
  }
  return applied;
}

/** A fresh in-memory database with the full schema. The usual starting point of a test. */
export function createMigratedD1(): FakeD1 {
  const d1 = createFakeD1();
  applyMigrations(d1.sqlite);
  return d1;
}
