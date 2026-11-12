export const ADMIN_ACTOR_NAME: string;
export const ADMIN_USAGE: string;
export const PASSWORD_MIN_LENGTH: number;
export const PASSWORD_MAX_LENGTH: number;
export const HASH_ITERATIONS: number;
export const SALT_BYTES: number;
export const KEY_BYTES: number;

export interface AdminOptions {
  dryRun: boolean;
  env: string | undefined;
  force: boolean;
  help: boolean;
  remote: boolean;
  resetPassword: boolean;
}

export interface AdminCredentials {
  displayName: string;
  email: string | null;
  password: string;
  username: string;
}

export interface AdminState {
  activeAdmins: number;
  existing: { disabled: boolean; id: string; role: string } | null;
}

export interface AdminSqlInput {
  action: "create" | "reset";
  credentials: AdminCredentials;
  existingId?: string;
  force: boolean;
  hash: string;
  id?: string;
  now: string;
}

export interface WranglerJsonResult {
  results?: Record<string, unknown>[];
}

export function parseAdminArgs(argv: readonly string[]): AdminOptions;
export function readAdminCredentials(
  env: Readonly<Record<string, string | undefined>>
): AdminCredentials;
export function hashAdminPassword(
  password: string,
  options?: { iterations?: number; salt?: Buffer }
): string;
export function buildAdminPreflightSql(username: string): string;
export function readAdminState(parsed: WranglerJsonResult[]): AdminState;
export function planAdminAction(
  state: AdminState,
  flags: { force: boolean; resetPassword: boolean },
  username: string
): "create" | "reset";
export function buildAdminSql(input: AdminSqlInput): {
  id: string;
  sql: string;
};
export function buildAdminVerifySql(id: string): string;
export function adminWasWritten(parsed: WranglerJsonResult[]): boolean;
