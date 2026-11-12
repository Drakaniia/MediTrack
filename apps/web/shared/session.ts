/**
 * Auth wire types shared by the API and the SPA (spec §8.4).
 *
 * `GET /api/auth/me` is the SPA's single bootstrap call: who am I, what may I do,
 * what are the facility settings every role needs (timezone + thresholds), and
 * what day is it at the facility.
 */

import { z } from "zod";

import type { Permission } from "./permissions";
import { isRole, type Role } from "./roles";
import type { PublicSettings } from "./settings";

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 128;
export const MAX_USERNAME_LENGTH = 40;

/** Usernames: letters, digits, dot, underscore, hyphen. Case-insensitive unique. */
export const USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,40}$/;

export const roleSchema = z.custom<Role>(isRole, { message: "Unknown role." });

export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, {
    message: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
  })
  .max(MAX_PASSWORD_LENGTH, {
    message: `Use at most ${MAX_PASSWORD_LENGTH} characters.`,
  });

/** `identifier` is a username or an email address. */
export const loginInputSchema = z.strictObject({
  identifier: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});

export const changePasswordInputSchema = z.strictObject({
  currentPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH),
  newPassword: passwordSchema,
});

export type LoginInput = z.infer<typeof loginInputSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordInputSchema>;

export interface SessionUser {
  displayName: string;
  email: string | null;
  id: string;
  /** True until an admin-created account sets its own password. */
  mustChangePassword: boolean;
  role: Role;
  username: string;
}

export interface MeResponse {
  /** Permissions held by `user.role` (mirror of `shared/permissions.ts`). */
  permissions: Permission[];
  /** Facility settings every role may read. */
  settings: PublicSettings;
  /** Server clock, ISO UTC. */
  serverTime: string;
  /** Facility-local calendar date (`YYYY-MM-DD`) — the "today" all expiry maths uses. */
  today: string;
  user: SessionUser;
}
