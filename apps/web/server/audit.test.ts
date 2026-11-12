import { describe, expect, it } from "vitest";

import { createMigratedD1, type FakeD1 } from "../test/harness";
import {
  type AuditEntry,
  actorOf,
  auditJson,
  auditStatement,
  MAX_AUDIT_JSON_CHARS,
} from "./audit";

const NOW = "2026-11-12T02:00:00.000Z";

interface AuditRow {
  action: string;
  actor_id: string | null;
  actor_name: string;
  actor_role: string | null;
  after: string | null;
  at: string;
  before: string | null;
  entity_id: string | null;
  entity_type: string;
  id: number;
  ip: string | null;
  summary: string;
}

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    action: "test.event",
    actor: { id: "u1", name: "Maria Santos", role: "admin" },
    at: NOW,
    entityType: "test",
    summary: "Did a thing",
    ...overrides,
  };
}

async function write(db: FakeD1, value: AuditEntry): Promise<AuditRow> {
  await auditStatement(db, value).run();
  return db.sqlite
    .prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT 1")
    .get() as unknown as AuditRow;
}

describe("auditStatement", () => {
  it("stores every field", async () => {
    const db = createMigratedD1();
    const row = await write(
      db,
      entry({
        action: "user.update",
        after: { role: "nurse" },
        before: { role: "admin" },
        entityId: "user-9",
        entityType: "user",
        ip: "203.0.113.5",
      })
    );
    expect(row).toMatchObject({
      action: "user.update",
      actor_id: "u1",
      actor_name: "Maria Santos",
      actor_role: "admin",
      after: '{"role":"nurse"}',
      at: NOW,
      before: '{"role":"admin"}',
      entity_id: "user-9",
      entity_type: "user",
      ip: "203.0.113.5",
      summary: "Did a thing",
    });
  });

  it("records the system as 'System' with no id or role", async () => {
    const db = createMigratedD1();
    const row = await write(db, entry({ actor: null }));
    expect(row).toMatchObject({
      actor_id: null,
      actor_name: "System",
      actor_role: null,
    });
  });

  it("stores NULL for omitted optional fields", async () => {
    const db = createMigratedD1();
    const row = await write(db, entry({ after: null, before: undefined }));
    expect(row).toMatchObject({
      after: null,
      before: null,
      entity_id: null,
      ip: null,
    });
  });

  it("allows an actor without an id (a failed sign-in)", async () => {
    const db = createMigratedD1();
    const row = await write(
      db,
      entry({ actor: { id: null, name: "x".repeat(200), role: null } })
    );
    expect(row.actor_id).toBeNull();
    expect(row.actor_name).toHaveLength(80);
  });

  it("caps the summary", async () => {
    const db = createMigratedD1();
    const row = await write(db, entry({ summary: "s".repeat(2000) }));
    expect(row.summary).toHaveLength(500);
  });

  it("builds an actor from a signed-in user", () => {
    expect(
      actorOf({
        displayName: "Maria Santos",
        email: null,
        id: "u1",
        mustChangePassword: false,
        role: "pharmacist",
        username: "maria",
      })
    ).toEqual({ id: "u1", name: "Maria Santos", role: "pharmacist" });
  });
});

describe("redaction", () => {
  it("replaces sensitive keys at every depth and keeps the rest", async () => {
    const db = createMigratedD1();
    const row = await write(
      db,
      entry({
        after: {
          nested: {
            auth: "push-auth-secret-value",
            p256dh: "push-key-value",
            password: "hunter2-hunter2",
            pepper: "pepper-value",
          },
          passwordHash: "pbkdf2-sha256$100000$salt$hash",
          rows: [{ sessionToken: "token-value", visible: 1 }],
          secretKey: "secret-value",
          username: "maria",
        },
      })
    );
    const text = row.after ?? "";
    for (const leaked of [
      "push-auth-secret-value",
      "push-key-value",
      "hunter2-hunter2",
      "pepper-value",
      "pbkdf2-sha256",
      "token-value",
      "secret-value",
    ]) {
      expect(text).not.toContain(leaked);
    }
    expect(JSON.parse(text)).toEqual({
      nested: {
        auth: "[redacted]",
        p256dh: "[redacted]",
        password: "[redacted]",
        pepper: "[redacted]",
      },
      passwordHash: "[redacted]",
      rows: [{ sessionToken: "[redacted]", visible: 1 }],
      secretKey: "[redacted]",
      username: "maria",
    });
  });
});

describe("size cap", () => {
  it("stores small snapshots verbatim", () => {
    expect(auditJson({ a: 1 })).toBe('{"a":1}');
    expect(auditJson(undefined)).toBeNull();
    expect(auditJson(null)).toBeNull();
  });

  it("replaces an oversized snapshot with a parseable marker under the cap", async () => {
    const db = createMigratedD1();
    const big = {
      lines: Array.from({ length: 400 }, (_, index) => ({
        index,
        name: `Medicine "${index}" with quotes`,
      })),
    };
    const row = await write(db, entry({ after: big }));
    const stored = row.after ?? "";

    expect(stored.length).toBeLessThanOrEqual(MAX_AUDIT_JSON_CHARS);
    const parsed = JSON.parse(stored) as {
      originalLength: number;
      preview: string;
      truncated: boolean;
    };
    expect(parsed.truncated).toBe(true);
    expect(parsed.originalLength).toBe(JSON.stringify(big).length);
    expect(parsed.preview.startsWith('{"lines":[')).toBe(true);
  });

  it("copes with values JSON cannot represent", async () => {
    const db = createMigratedD1();
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect((await write(db, entry({ after: circular }))).after).toBeNull();
    expect((await write(db, entry({ after: { big: 10n } }))).after).toBeNull();
  });
});

describe("atomicity and immutability", () => {
  it("rolls the audit row back with the rest of a failed batch", async () => {
    const db = createMigratedD1();
    await expect(
      db.batch([
        auditStatement(db, entry()),
        db.prepare("INSERT INTO nonexistent_table VALUES (1)"),
      ])
    ).rejects.toThrow();
    const count = db.sqlite
      .prepare("SELECT COUNT(*) AS n FROM audit_log")
      .get() as { n: number };
    expect(count.n).toBe(0);
  });

  it("is append-only", async () => {
    const db = createMigratedD1();
    await write(db, entry());
    await expect(
      db.prepare("UPDATE audit_log SET summary = 'edited'").run()
    ).rejects.toThrow(/append-only/);
    await expect(db.prepare("DELETE FROM audit_log").run()).rejects.toThrow(
      /append-only/
    );
  });
});
