import { MAX_DIGEST_RECIPIENTS } from "@shared/settings";
import { z } from "zod";

const MAX_EMAIL_LENGTH = 254;
const emailSchema = z.email();

export type AddRecipientResult =
  | { message: string; ok: false }
  | { ok: true; recipients: string[] };

/**
 * Adds `input` to the digest recipients. The server lower-cases and de-duplicates
 * addresses, so the editor does the same: what the admin sees is what is stored,
 * and a save never shows up as a phantom change.
 */
export function addRecipient(
  current: readonly string[],
  input: string
): AddRecipientResult {
  const email = input.trim().toLowerCase();
  if (email === "") {
    return { message: "Enter an email address.", ok: false };
  }
  if (current.length >= MAX_DIGEST_RECIPIENTS) {
    return {
      message: `You can add up to ${MAX_DIGEST_RECIPIENTS} recipients.`,
      ok: false,
    };
  }
  if (
    email.length > MAX_EMAIL_LENGTH ||
    !emailSchema.safeParse(email).success
  ) {
    return { message: "Enter a valid email address.", ok: false };
  }
  if (current.some((existing) => existing.toLowerCase() === email)) {
    return { message: "That address is already on the list.", ok: false };
  }
  return { ok: true, recipients: [...current, email] };
}

export function removeRecipient(
  current: readonly string[],
  email: string
): string[] {
  return current.filter((existing) => existing !== email);
}
