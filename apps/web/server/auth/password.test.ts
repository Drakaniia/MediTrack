import { pbkdf2Sync } from "node:crypto";

import { describe, expect, it } from "vitest";

import { passwordSchema } from "../../shared/session";
import { base64UrlDecode } from "./crypto";
import {
  DEFAULT_PASSWORD_ITERATIONS,
  DUMMY_PASSWORD_HASH,
  generateTemporaryPassword,
  hashPassword,
  iterationsFromEnv,
  MAX_PASSWORD_ITERATIONS,
  MIN_PASSWORD_ITERATIONS,
  verifyPassword,
} from "./password";

const FAST = { iterations: 10_000 };
const FORMAT = /^pbkdf2-sha256\$10000\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/;
const PASSWORD = "correct horse battery staple";

/** A hash built the way `scripts/web-seed-admin.mjs` does it, with node:crypto. */
function nodeHash(password: string, iterations: number): string {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  return `pbkdf2-sha256$${iterations}$${Buffer.from(salt).toString("base64url")}$${key.toString("base64url")}`;
}

describe("hashPassword", () => {
  it("produces the documented format", async () => {
    expect(await hashPassword(PASSWORD, FAST)).toMatch(FORMAT);
  });

  it("salts every hash", async () => {
    const [first, second] = await Promise.all([
      hashPassword(PASSWORD, FAST),
      hashPassword(PASSWORD, FAST),
    ]);
    expect(first).not.toBe(second);
  });

  it("is deterministic for a fixed salt", async () => {
    const salt = new Uint8Array(16).fill(7);
    const [first, second] = await Promise.all([
      hashPassword(PASSWORD, { ...FAST, salt }),
      hashPassword(PASSWORD, { ...FAST, salt }),
    ]);
    expect(first).toBe(second);
  });

  it("agrees with node:crypto PBKDF2 for the same parameters", async () => {
    const salt = new Uint8Array(16).fill(3);
    const stored = await hashPassword(PASSWORD, { ...FAST, salt });
    const expected = pbkdf2Sync(PASSWORD, salt, 10_000, 32, "sha256");
    const parts = stored.split("$");
    expect(Buffer.from(base64UrlDecode(parts[3]) ?? []).equals(expected)).toBe(
      true
    );
  });

  it("rejects iteration counts outside 1..100000 (the Workers ceiling)", async () => {
    await expect(
      hashPassword(PASSWORD, { iterations: MAX_PASSWORD_ITERATIONS + 1 })
    ).rejects.toThrow(RangeError);
    await expect(hashPassword(PASSWORD, { iterations: 0 })).rejects.toThrow(
      RangeError
    );
    await expect(hashPassword(PASSWORD, { iterations: 1.5 })).rejects.toThrow(
      RangeError
    );
  });
});

describe("verifyPassword", () => {
  it("accepts the right password and rejects a wrong one", async () => {
    const stored = await hashPassword(PASSWORD, FAST);
    expect((await verifyPassword(PASSWORD, stored)).ok).toBe(true);
    expect((await verifyPassword(`${PASSWORD}x`, stored)).ok).toBe(false);
    expect((await verifyPassword("", stored)).ok).toBe(false);
  });

  it("handles unicode and 128-character passwords", async () => {
    const passwords = ["pässwörd-密码-🔐-ok", "x".repeat(128)];
    const outcomes = await Promise.all(
      passwords.map(async (password) => {
        const stored = await hashPassword(password, FAST);
        return {
          right: (await verifyPassword(password, stored)).ok,
          wrong: (await verifyPassword(`${password}.`, stored)).ok,
        };
      })
    );
    expect(outcomes).toEqual([
      { right: true, wrong: false },
      { right: true, wrong: false },
    ]);
  });

  it("verifies a hash made by node:crypto with the same parameters", async () => {
    const stored = nodeHash("seeded-admin-password", 25_000);
    expect(await verifyPassword("seeded-admin-password", stored)).toEqual({
      needsRehash: true,
      ok: true,
    });
    expect((await verifyPassword("something-else", stored)).ok).toBe(false);
  });

  it("never throws on malformed stored values", async () => {
    const valid = await hashPassword(PASSWORD, FAST);
    const [scheme, iterations, salt, hash] = valid.split("$");
    const malformed = [
      "",
      "garbage",
      "$$$",
      "pbkdf2-sha256",
      `${scheme}$${iterations}$${salt}`,
      `${scheme}$${iterations}$${salt}$${hash}$extra`,
      `bcrypt$${iterations}$${salt}$${hash}`,
      `${scheme}$abc$${salt}$${hash}`,
      `${scheme}$-5$${salt}$${hash}`,
      `${scheme}$0$${salt}$${hash}`,
      `${scheme}$1e4$${salt}$${hash}`,
      `${scheme}$${iterations}$$${hash}`,
      `${scheme}$${iterations}$${salt}$`,
      `${scheme}$${iterations}$!!!$${hash}`,
      `${scheme}$${iterations}$${salt}$***`,
      `${scheme}$${iterations}$AA$${hash}`,
      `${scheme}$${iterations}$${salt}$AA`,
      `${scheme}$99999999999$${salt}$${hash}`,
    ];
    const outcomes = await Promise.all(
      malformed.map((stored) => verifyPassword(PASSWORD, stored))
    );
    for (const outcome of outcomes) {
      expect(outcome).toEqual({ needsRehash: false, ok: false });
    }
  });

  it("treats hashes above the Workers iteration ceiling as unverifiable", async () => {
    const stored = nodeHash(PASSWORD, MAX_PASSWORD_ITERATIONS + 1);
    expect((await verifyPassword(PASSWORD, stored)).ok).toBe(false);
  });

  it("asks for a rehash only when the hash is weaker than the target", async () => {
    const stored = await hashPassword(PASSWORD, FAST);
    expect(await verifyPassword(PASSWORD, stored, 10_000)).toEqual({
      needsRehash: false,
      ok: true,
    });
    expect(await verifyPassword(PASSWORD, stored, 20_000)).toEqual({
      needsRehash: true,
      ok: true,
    });
    expect(await verifyPassword(PASSWORD, stored, 5000)).toEqual({
      needsRehash: false,
      ok: true,
    });
    expect((await verifyPassword("wrong", stored, 20_000)).needsRehash).toBe(
      false
    );
  });
});

describe("iterationsFromEnv", () => {
  it("defaults to 100000 and clamps to 10000..100000", () => {
    expect(iterationsFromEnv({})).toBe(DEFAULT_PASSWORD_ITERATIONS);
    expect(iterationsFromEnv({ PASSWORD_ITERATIONS: "" })).toBe(100_000);
    expect(iterationsFromEnv({ PASSWORD_ITERATIONS: "abc" })).toBe(100_000);
    expect(iterationsFromEnv({ PASSWORD_ITERATIONS: "50000" })).toBe(50_000);
    expect(iterationsFromEnv({ PASSWORD_ITERATIONS: " 20000 " })).toBe(20_000);
    expect(iterationsFromEnv({ PASSWORD_ITERATIONS: "5" })).toBe(
      MIN_PASSWORD_ITERATIONS
    );
    expect(iterationsFromEnv({ PASSWORD_ITERATIONS: "-1" })).toBe(10_000);
    expect(iterationsFromEnv({ PASSWORD_ITERATIONS: "999999999" })).toBe(
      MAX_PASSWORD_ITERATIONS
    );
  });
});

describe("generateTemporaryPassword", () => {
  it("is 16 unambiguous characters that satisfy the password policy", () => {
    for (let run = 0; run < 200; run += 1) {
      const password = generateTemporaryPassword();
      expect(password).toHaveLength(16);
      expect(password).not.toMatch(/[0OoIil1]/);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/\d/);
      expect(passwordSchema.safeParse(password).success).toBe(true);
    }
  });

  it("does not repeat", () => {
    const seen = new Set(
      Array.from({ length: 100 }, () => generateTemporaryPassword())
    );
    expect(seen.size).toBe(100);
  });
});

describe("DUMMY_PASSWORD_HASH", () => {
  it("is a well-formed 100000-iteration hash that no password matches", async () => {
    expect(DUMMY_PASSWORD_HASH).toMatch(
      /^pbkdf2-sha256\$100000\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/
    );
    expect((await verifyPassword("anything", DUMMY_PASSWORD_HASH)).ok).toBe(
      false
    );
    expect((await verifyPassword("", DUMMY_PASSWORD_HASH)).ok).toBe(false);
  });
});
