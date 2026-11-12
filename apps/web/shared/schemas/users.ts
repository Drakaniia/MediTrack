/**
 * User management DTOs and input schemas (spec §7.10). Shared by the API
 * (`server/routes/users.ts`) and the SPA's Users screen.
 *
 * `UserDto` NEVER carries a password hash, a session or a token. Temporary passwords
 * appear exactly once, in the response that created or reset them.
 */

import { z } from "zod";

import type { Role } from "../roles";
import {
  MAX_USERNAME_LENGTH,
  passwordSchema,
  roleSchema,
  USERNAME_PATTERN,
} from "../session";

export const MAX_DISPLAY_NAME_LENGTH = 80;
export const MAX_EMAIL_LENGTH = 254;
export const MAX_USER_SEARCH_LENGTH = 100;

export const USER_STATUSES = ["active", "disabled"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export interface UserDto {
  createdAt: string;
  disabled: boolean;
  disabledAt: string | null;
  displayName: string;
  email: string | null;
  id: string;
  lastLoginAt: string | null;
  /** True until the person sets their own password (new account or admin reset). */
  mustChangePassword: boolean;
  passwordChangedAt: string | null;
  role: Role;
  updatedAt: string;
  username: string;
}

/** Response of `POST /api/users` and `POST /api/users/:id/reset-password`. */
export interface TemporaryPasswordResponse {
  /** Shown ONCE. Hand it to the person; they must change it at first sign-in. */
  temporaryPassword: string;
  user: UserDto;
}

function blankToUndefined(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

export const usernameSchema = z
  .string()
  .trim()
  .regex(USERNAME_PATTERN, {
    message: `Use 3–${MAX_USERNAME_LENGTH} letters, digits, dots, underscores or hyphens.`,
  });

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, { message: "Enter a name." })
  .max(MAX_DISPLAY_NAME_LENGTH, {
    message: `Use at most ${MAX_DISPLAY_NAME_LENGTH} characters.`,
  });

/** An email address; blank text means "no email" (`null`). */
const optionalEmailSchema = z
  .string()
  .trim()
  .max(MAX_EMAIL_LENGTH, { message: "That email address is too long." })
  .transform((value) => (value === "" ? null : value))
  .pipe(z.email({ message: "Enter a valid email address." }).nullable());

export const createUserInputSchema = z.strictObject({
  displayName: displayNameSchema,
  email: optionalEmailSchema.nullish(),
  role: roleSchema,
  /** Leave out (or blank) to have the server generate one. */
  temporaryPassword: z.preprocess(blankToUndefined, passwordSchema.optional()),
  username: usernameSchema,
});

export const updateUserInputSchema = z
  .strictObject({
    displayName: displayNameSchema.optional(),
    /** `null` removes the email address; leaving it out keeps it. */
    email: optionalEmailSchema.nullish(),
    role: roleSchema.optional(),
  })
  .refine(
    (value) =>
      value.displayName !== undefined ||
      value.email !== undefined ||
      value.role !== undefined,
    { message: "Provide at least one field to change." }
  );

export type CreateUserInput = z.output<typeof createUserInputSchema>;
export type UpdateUserInput = z.output<typeof updateUserInputSchema>;

/** `GET /api/users` filters (paging comes from `limit` / `offset`). */
export const listUsersQuerySchema = z.object({
  q: z.preprocess(
    blankToUndefined,
    z.string().trim().max(MAX_USER_SEARCH_LENGTH).optional()
  ),
  role: z.preprocess(blankToUndefined, roleSchema.optional()),
  status: z.preprocess(blankToUndefined, z.enum(USER_STATUSES).optional()),
});

export type ListUsersQuery = z.output<typeof listUsersQuerySchema>;
