import { describe, expect, it } from "vitest";

import { createMigratedD1, type FakeD1 } from "../../test/harness";
import { HttpError } from "../http";
import {
  assertLoginAllowed,
  LOGIN_IP_LIMIT,
  LOGIN_USER_LIMIT,
  LOGIN_WINDOW_SECONDS,
  type LoginThrottleIds,
  loginBuckets,
  recordLoginAttempt,
} from "./rate-limit";

const T0 = new Date("2026-11-12T02:00:00.000Z");

function at(seconds: number): Date {
  return new Date(T0.getTime() + seconds * 1000);
}

const alice: LoginThrottleIds = { identifier: "alice", ip: "198.51.100.7" };

async function failTimes(
  db: FakeD1,
  ids: LoginThrottleIds,
  count: number,
  start = 0
): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await recordLoginAttempt(db, ids, false, at(start + index));
  }
}

async function blockedFor(
  db: FakeD1,
  ids: LoginThrottleIds,
  now: Date
): Promise<HttpError | null> {
  try {
    await assertLoginAllowed(db, ids, now);
    return null;
  } catch (error) {
    if (error instanceof HttpError) {
      return error;
    }
    throw error;
  }
}

function countRows(db: FakeD1, where = "1 = 1"): number {
  const row = db.sqlite
    .prepare(`SELECT COUNT(*) AS n FROM login_attempts WHERE ${where}`)
    .get() as { n: number };
  return row.n;
}

describe("loginBuckets", () => {
  it("normalises the identifier and falls back to 'unknown' for the ip", () => {
    expect(
      loginBuckets({ identifier: "  Alice@Example.COM ", ip: "1.2.3.4" })
    ).toEqual({
      ip: "ip:1.2.3.4",
      user: "user:alice@example.com|ip:1.2.3.4",
    });
    expect(loginBuckets({ identifier: "bob", ip: null })).toEqual({
      ip: "ip:unknown",
      user: "user:bob|ip:unknown",
    });
    expect(
      loginBuckets({ identifier: "x".repeat(500), ip: " " }).user.length
    ).toBeLessThan(130);
  });
});

describe("assertLoginAllowed", () => {
  it("allows attempts until the user+ip bucket holds 5 failures", async () => {
    const db = createMigratedD1();
    await assertLoginAllowed(db, alice, T0);

    await failTimes(db, alice, LOGIN_USER_LIMIT - 1);
    expect(await blockedFor(db, alice, at(10))).toBeNull();

    await recordLoginAttempt(db, alice, false, at(4));
    const blocked = await blockedFor(db, alice, at(10));
    expect(blocked?.code).toBe("rate_limited");
    expect(blocked?.status).toBe(429);
  });

  it("reports how long to wait and recovers when the window has passed", async () => {
    const db = createMigratedD1();
    await failTimes(db, alice, LOGIN_USER_LIMIT);

    const blocked = await blockedFor(db, alice, at(5));
    expect(blocked?.details).toEqual({
      retryAfterSeconds: LOGIN_WINDOW_SECONDS - 5,
    });
    expect(blocked?.message).toContain("15 minutes");

    const later = await blockedFor(db, alice, at(LOGIN_WINDOW_SECONDS - 60));
    expect(later?.details).toEqual({ retryAfterSeconds: 60 });
    expect(later?.message).toContain("1 minute.");

    // The oldest failure leaves the window at exactly +900 s, freeing one slot.
    expect(await blockedFor(db, alice, at(LOGIN_WINDOW_SECONDS))).toBeNull();
  });

  it("does not extend the lock when blocked attempts keep arriving", async () => {
    const db = createMigratedD1();
    await failTimes(db, alice, LOGIN_USER_LIMIT);
    const before = countRows(db);
    await blockedFor(db, alice, at(30));
    await blockedFor(db, alice, at(60));
    expect(countRows(db)).toBe(before);
  });

  it("keeps buckets separate per identifier and per ip, and ignores case", async () => {
    const db = createMigratedD1();
    await failTimes(db, alice, LOGIN_USER_LIMIT);

    expect(
      await blockedFor(db, { identifier: "bob", ip: alice.ip }, at(10))
    ).toBeNull();
    expect(
      await blockedFor(db, { identifier: "alice", ip: "198.51.100.8" }, at(10))
    ).toBeNull();
    expect(
      (await blockedFor(db, { identifier: "ALICE", ip: alice.ip }, at(10)))
        ?.code
    ).toBe("rate_limited");
  });

  it("throttles an address that sprays many accounts", async () => {
    const db = createMigratedD1();
    const ip = "203.0.113.9";
    for (let index = 0; index < LOGIN_IP_LIMIT; index += 1) {
      await recordLoginAttempt(
        db,
        { identifier: `user${index}`, ip },
        false,
        at(index)
      );
    }

    expect(
      (await blockedFor(db, { identifier: "someone-new", ip }, at(40)))?.code
    ).toBe("rate_limited");
    expect(
      await blockedFor(
        db,
        { identifier: "someone-new", ip: "203.0.113.10" },
        at(40)
      )
    ).toBeNull();
  });

  it("uses the literal 'unknown' when there is no client address", async () => {
    const db = createMigratedD1();
    const ids = { identifier: "carol", ip: null };
    await failTimes(db, ids, LOGIN_USER_LIMIT);
    expect((await blockedFor(db, ids, at(10)))?.code).toBe("rate_limited");
    const buckets = db.sqlite
      .prepare("SELECT DISTINCT bucket FROM login_attempts ORDER BY bucket")
      .all() as { bucket: string }[];
    expect(buckets.map((row) => row.bucket)).toEqual([
      "ip:unknown",
      "user:carol|ip:unknown",
    ]);
  });
});

describe("recordLoginAttempt", () => {
  it("clears the user+ip bucket on success but never the ip bucket", async () => {
    const db = createMigratedD1();
    await failTimes(db, alice, LOGIN_USER_LIMIT - 1);
    await recordLoginAttempt(db, alice, true, at(10));

    expect(countRows(db, "bucket LIKE 'user:%' AND success = 0")).toBe(0);
    expect(countRows(db, "bucket = 'ip:198.51.100.7' AND success = 0")).toBe(
      LOGIN_USER_LIMIT - 1
    );

    // Five new failures are needed again before the account is locked.
    await failTimes(db, alice, LOGIN_USER_LIMIT - 1, 20);
    expect(await blockedFor(db, alice, at(30))).toBeNull();
    await recordLoginAttempt(db, alice, false, at(25));
    expect((await blockedFor(db, alice, at(30)))?.code).toBe("rate_limited");
  });

  it("does not count successes as failures", async () => {
    const db = createMigratedD1();
    for (let index = 0; index < LOGIN_USER_LIMIT + 2; index += 1) {
      await recordLoginAttempt(db, alice, true, at(index));
    }
    expect(await blockedFor(db, alice, at(20))).toBeNull();
  });

  it("purges attempts older than a day on every write", async () => {
    const db = createMigratedD1();
    db.sqlite
      .prepare(
        "INSERT INTO login_attempts (bucket, attempted_at, success) VALUES (?, ?, 0)"
      )
      .run("ip:old", at(-25 * 3600).toISOString());
    db.sqlite
      .prepare(
        "INSERT INTO login_attempts (bucket, attempted_at, success) VALUES (?, ?, 0)"
      )
      .run("ip:recent", at(-23 * 3600).toISOString());

    await recordLoginAttempt(db, alice, false, T0);

    expect(countRows(db, "bucket = 'ip:old'")).toBe(0);
    expect(countRows(db, "bucket = 'ip:recent'")).toBe(1);
  });
});
