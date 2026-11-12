import type { AuditEntryDto } from "@shared/schemas/audit";
import type { UserDto } from "@shared/schemas/users";
import { type AppSettings, DEFAULT_SETTINGS } from "@shared/settings";

/** Fixtures for the admin screens' tests. */

export function makeUser(overrides: Partial<UserDto> = {}): UserDto {
  return {
    createdAt: "2026-10-01T02:00:00.000Z",
    disabled: false,
    disabledAt: null,
    displayName: "Maria Santos",
    email: "maria@example.org",
    id: "user-maria",
    lastLoginAt: "2026-11-11T01:30:00.000Z",
    mustChangePassword: false,
    passwordChangedAt: "2026-10-02T02:00:00.000Z",
    role: "pharmacist",
    updatedAt: "2026-10-02T02:00:00.000Z",
    username: "maria",
    ...overrides,
  };
}

export function makeAuditEntry(
  overrides: Partial<AuditEntryDto> = {}
): AuditEntryDto {
  return {
    action: "user.update",
    actorId: "user-admin",
    actorName: "Test System Administrator",
    actorRole: "admin",
    after: { role: "nurse" },
    at: "2026-11-11T16:30:00.000Z",
    before: { role: "pharmacist" },
    entityId: "user-maria",
    entityType: "user",
    id: 1,
    ip: "203.0.113.7",
    summary: "Changed role of maria",
    ...overrides,
  };
}

export function makeSettings(
  overrides: Partial<AppSettings> = {}
): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    alerts: { ...DEFAULT_SETTINGS.alerts },
    digest: { ...DEFAULT_SETTINGS.digest, recipients: [] },
    expiry: { ...DEFAULT_SETTINGS.expiry },
    facility: { ...DEFAULT_SETTINGS.facility },
    schedule: { ...DEFAULT_SETTINGS.schedule },
    ...overrides,
  };
}
