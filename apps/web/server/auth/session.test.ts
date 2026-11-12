import { describe, expect, it } from "vitest";

import { createMigratedD1, type FakeD1 } from "../../test/harness";
import { sha256Hex } from "./crypto";
import {
  buildClearedSessionCookie,
  buildSessionCookie,
  createSession,
  deleteSession,
  deleteUserSessions,
  purgeExpiredSessions,
  readSessionToken,
  resolveSession,
  SESSION_ABSOLUTE_SECONDS,
  SESSION_IDLE_SECONDS,
  SESSION_REFRESH_AFTER_SECONDS,
} from "./session";

const PEPPER = "unit-test-pepper";
const T0 = new Date("2026-11-12T02:00:00.000Z");
const HOUR = 3600;

function at(seconds: number): Date {
  return new Date(T0.getTime() + seconds * 1000);
}

function insertUser(
  db: FakeD1,
  id: string,
  fields: { mustChange?: boolean; role?: string } = {}
): void {
  db.sqlite
    .prepare(
      "INSERT INTO users (id, username, username_lower, display_name, role, password_hash, must_change_password) VALUES (?, ?, ?, ?, ?, 'x', ?)"
    )
    .run(
      id,
      `User-${id}`,
      `user-${id}`,
      `User ${id}`,
      fields.role ?? "nurse",
      fields.mustChange ? 1 : 0
    );
}

function startSession(db: FakeD1, userId: string, now: Date = T0) {
  return createSession(
    db,
    { id: userId },
    { ip: "203.0.113.5", now, pepper: PEPPER, userAgent: "vitest" }
  );
}

function sessionRow(db: FakeD1, sessionId: string) {
  return db.sqlite
    .prepare("SELECT * FROM sessions WHERE id = ?")
    .get(sessionId) as
    | {
        absolute_expires_at: string;
        created_at: string;
        expires_at: string;
        id: string;
        ip: string | null;
        last_seen_at: string;
        user_agent: string | null;
        user_id: string;
      }
    | undefined;
}

function requestWithCookie(cookie: string | null): Request {
  return new Request("https://meditract.test/api/auth/me", {
    headers: cookie === null ? {} : { cookie },
  });
}

describe("createSession", () => {
  it("stores only the hash of the token, with both expiry clocks", async () => {
    const db = createMigratedD1();
    insertUser(db, "u1");
    const created = await startSession(db, "u1");

    expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.sessionId).toBe(await sha256Hex(created.token + PEPPER));
    expect(created.expiresAt).toBe(at(SESSION_IDLE_SECONDS).toISOString());

    const row = sessionRow(db, created.sessionId);
    expect(row).toMatchObject({
      absolute_expires_at: at(SESSION_ABSOLUTE_SECONDS).toISOString(),
      created_at: T0.toISOString(),
      expires_at: at(SESSION_IDLE_SECONDS).toISOString(),
      ip: "203.0.113.5",
      last_seen_at: T0.toISOString(),
      user_agent: "vitest",
      user_id: "u1",
    });
    expect(sessionRow(db, created.token)).toBeUndefined();
  });

  it("issues a different token every time", async () => {
    const db = createMigratedD1();
    insertUser(db, "u1");
    const [first, second] = await Promise.all([
      startSession(db, "u1"),
      startSession(db, "u1"),
    ]);
    expect(first.token).not.toBe(second.token);
    expect(first.sessionId).not.toBe(second.sessionId);
  });
});

describe("resolveSession", () => {
  it("returns the signed-in user", async () => {
    const db = createMigratedD1();
    insertUser(db, "u1", { role: "pharmacist" });
    const { sessionId, token } = await startSession(db, "u1");

    const resolved = await resolveSession(db, token, PEPPER, at(10));
    expect(resolved).toMatchObject({
      refreshed: false,
      sessionId,
      user: {
        displayName: "User u1",
        email: null,
        id: "u1",
        mustChangePassword: false,
        role: "pharmacist",
        username: "User-u1",
      },
    });
  });

  it("reports a pending password change", async () => {
    const db = createMigratedD1();
    insertUser(db, "u1", { mustChange: true });
    const { token } = await startSession(db, "u1");
    const resolved = await resolveSession(db, token, PEPPER, at(1));
    expect(resolved?.user.mustChangePassword).toBe(true);
  });

  it("rejects unknown, tampered and wrongly peppered tokens", async () => {
    const db = createMigratedD1();
    insertUser(db, "u1");
    const { token } = await startSession(db, "u1");

    expect(await resolveSession(db, "x".repeat(43), PEPPER, at(1))).toBeNull();
    expect(
      await resolveSession(db, `${token.slice(0, -1)}A`, PEPPER, at(1))
    ).toBeNull();
    expect(await resolveSession(db, token, "another-pepper", at(1))).toBeNull();
    expect(await resolveSession(db, token, PEPPER, at(1))).not.toBeNull();
  });

  it("rejects a disabled user", async () => {
    const db = createMigratedD1();
    insertUser(db, "u1");
    const { token } = await startSession(db, "u1");
    db.sqlite
      .prepare("UPDATE users SET disabled_at = ? WHERE id = 'u1'")
      .run(at(5).toISOString());
    expect(await resolveSession(db, token, PEPPER, at(10))).toBeNull();
  });

  it("expires after the idle window", async () => {
    const db = createMigratedD1();
    insertUser(db, "u1");
    const almost = await startSession(db, "u1");
    const exact = await startSession(db, "u1");

    expect(
      await resolveSession(
        db,
        almost.token,
        PEPPER,
        at(SESSION_IDLE_SECONDS - 1)
      )
    ).not.toBeNull();
    expect(
      await resolveSession(db, exact.token, PEPPER, at(SESSION_IDLE_SECONDS))
    ).toBeNull();
  });

  it("slides the idle expiry at most once per refresh window", async () => {
    const db = createMigratedD1();
    insertUser(db, "u1");
    const { sessionId, token } = await startSession(db, "u1");

    const early = await resolveSession(db, token, PEPPER, at(100));
    expect(early?.refreshed).toBe(false);
    expect(sessionRow(db, sessionId)?.last_seen_at).toBe(T0.toISOString());

    const justBefore = await resolveSession(
      db,
      token,
      PEPPER,
      at(SESSION_REFRESH_AFTER_SECONDS - 1)
    );
    expect(justBefore?.refreshed).toBe(false);

    const due = await resolveSession(
      db,
      token,
      PEPPER,
      at(SESSION_REFRESH_AFTER_SECONDS)
    );
    expect(due).toMatchObject({
      expiresAt: at(
        SESSION_REFRESH_AFTER_SECONDS + SESSION_IDLE_SECONDS
      ).toISOString(),
      maxAgeSeconds: SESSION_IDLE_SECONDS,
      refreshed: true,
    });
    expect(sessionRow(db, sessionId)).toMatchObject({
      expires_at: at(
        SESSION_REFRESH_AFTER_SECONDS + SESSION_IDLE_SECONDS
      ).toISOString(),
      last_seen_at: at(SESSION_REFRESH_AFTER_SECONDS).toISOString(),
    });

    const next = await resolveSession(
      db,
      token,
      PEPPER,
      at(SESSION_REFRESH_AFTER_SECONDS + 1)
    );
    expect(next?.refreshed).toBe(false);
    const again = await resolveSession(
      db,
      token,
      PEPPER,
      at(SESSION_REFRESH_AFTER_SECONDS * 2)
    );
    expect(again?.refreshed).toBe(true);
  });

  it("keeps a continuously active session alive but never past the absolute limit", async () => {
    const db = createMigratedD1();
    insertUser(db, "u1");
    const { sessionId, token } = await startSession(db, "u1");

    // Active every 7 hours (inside the 8-hour idle window) for the whole week.
    for (let hours = 7; hours < SESSION_ABSOLUTE_SECONDS / HOUR; hours += 7) {
      const resolved = await resolveSession(
        db,
        token,
        PEPPER,
        at(hours * HOUR)
      );
      expect(resolved).not.toBeNull();
    }

    const last = sessionRow(db, sessionId);
    expect(last?.expires_at).toBe(last?.absolute_expires_at);
    expect(last?.absolute_expires_at).toBe(
      at(SESSION_ABSOLUTE_SECONDS).toISOString()
    );

    expect(
      await resolveSession(db, token, PEPPER, at(SESSION_ABSOLUTE_SECONDS - 1))
    ).not.toBeNull();
    expect(
      await resolveSession(db, token, PEPPER, at(SESSION_ABSOLUTE_SECONDS))
    ).toBeNull();
  });
});

describe("deleting sessions", () => {
  it("deletes one session", async () => {
    const db = createMigratedD1();
    insertUser(db, "u1");
    const one = await startSession(db, "u1");
    const two = await startSession(db, "u1");

    await deleteSession(db, one.sessionId);
    expect(await resolveSession(db, one.token, PEPPER, at(1))).toBeNull();
    expect(await resolveSession(db, two.token, PEPPER, at(1))).not.toBeNull();
  });

  it("deletes all of a user's sessions, optionally keeping one", async () => {
    const db = createMigratedD1();
    insertUser(db, "u1");
    insertUser(db, "u2");
    const keep = await startSession(db, "u1");
    const drop = await startSession(db, "u1");
    const other = await startSession(db, "u2");

    await deleteUserSessions(db, "u1", keep.sessionId);
    expect(await resolveSession(db, keep.token, PEPPER, at(1))).not.toBeNull();
    expect(await resolveSession(db, drop.token, PEPPER, at(1))).toBeNull();
    expect(await resolveSession(db, other.token, PEPPER, at(1))).not.toBeNull();

    await deleteUserSessions(db, "u1");
    expect(await resolveSession(db, keep.token, PEPPER, at(1))).toBeNull();
    expect(await resolveSession(db, other.token, PEPPER, at(1))).not.toBeNull();
  });

  it("purges expired sessions only", async () => {
    const db = createMigratedD1();
    insertUser(db, "u1");
    const old = await startSession(db, "u1", T0);
    const fresh = await startSession(db, "u1", at(9 * HOUR));

    await purgeExpiredSessions(db, at(9 * HOUR));
    expect(sessionRow(db, old.sessionId)).toBeUndefined();
    expect(sessionRow(db, fresh.sessionId)).toBeDefined();
  });
});

describe("cookies", () => {
  it("builds an HttpOnly, SameSite=Lax cookie, Secure only on https", () => {
    const secure = buildSessionCookie("tok", {
      maxAgeSeconds: 28_800,
      secure: true,
    });
    expect(secure).toBe(
      "mt_session=tok; Max-Age=28800; Path=/; HttpOnly; SameSite=Lax; Secure"
    );
    const plain = buildSessionCookie("tok", {
      maxAgeSeconds: 28_800,
      secure: false,
    });
    expect(plain).toBe(
      "mt_session=tok; Max-Age=28800; Path=/; HttpOnly; SameSite=Lax"
    );
  });

  it("clears the cookie with the same scope", () => {
    const cleared = buildClearedSessionCookie({ secure: true });
    expect(cleared).toContain("mt_session=;");
    expect(cleared).toContain("Max-Age=0");
    expect(cleared).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
    expect(cleared).toContain("Path=/");
    expect(cleared).toContain("HttpOnly");
    expect(cleared).toContain("Secure");
    expect(buildClearedSessionCookie({ secure: false })).not.toContain(
      "Secure"
    );
  });

  it("reads the token from the Cookie header", () => {
    const token = "A".repeat(43);
    expect(readSessionToken(requestWithCookie(`mt_session=${token}`))).toBe(
      token
    );
    expect(
      readSessionToken(
        requestWithCookie(`theme=dark; mt_session=${token}; other=1`)
      )
    ).toBe(token);
  });

  it("ignores missing, similarly named and malformed cookies", () => {
    const token = "A".repeat(43);
    expect(readSessionToken(requestWithCookie(null))).toBeNull();
    expect(readSessionToken(requestWithCookie("theme=dark"))).toBeNull();
    expect(
      readSessionToken(requestWithCookie(`xmt_session=${token}`))
    ).toBeNull();
    expect(
      readSessionToken(requestWithCookie(`mt_session_old=${token}`))
    ).toBeNull();
    expect(readSessionToken(requestWithCookie("mt_session="))).toBeNull();
    expect(readSessionToken(requestWithCookie("mt_session=short"))).toBeNull();
    expect(
      readSessionToken(requestWithCookie("mt_session=has spaces in it!!"))
    ).toBeNull();
    expect(
      readSessionToken(requestWithCookie(`mt_session=${"A".repeat(300)}`))
    ).toBeNull();
    expect(readSessionToken(requestWithCookie("garbage"))).toBeNull();
  });
});
