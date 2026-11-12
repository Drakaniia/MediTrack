const MAX_RECIPIENTS = 50;
const MAX_ADDRESS_LENGTH = 254;
/** Deliberately simple and linear-time: no nested quantifiers, ASCII local part and domain. */
const EMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

/** Code returned by the null sender and by {@link createEmailSender} when email is not configured. */
export const EMAIL_DISABLED_CODE = "EMAIL_DISABLED";
/** Code used when the thrown error carries no usable `.code`. */
export const EMAIL_UNKNOWN_CODE = "E_UNKNOWN";

/**
 * Cloudflare Email Service error codes that are worth retrying on a later cron
 * run. Everything else (recipient not on the verified list, unverified sender,
 * daily quota, validation, suspended account, suppressed recipient, ...) will
 * fail the same way again today, so retrying only burns quota. The digest is
 * once a day, so "retryable" here means "the next run may succeed", not an
 * immediate loop. Unknown codes and non-Error throws are treated as retryable
 * because they are most likely transient platform faults.
 */
const RETRYABLE_CODES: ReadonlySet<string> = new Set([
  "E_RATE_LIMIT_EXCEEDED",
  "E_INTERNAL_SERVER_ERROR",
  "E_DELIVERY_FAILED",
]);

/** The message shape the digest needs; `from` is supplied by the sender. */
export interface EmailMessage {
  html: string;
  subject: string;
  text: string;
  to: string;
}

export type EmailSendResult =
  | { ok: true; messageId: string }
  | { ok: false; code: string; message: string; retryable: boolean };

/** Abstraction the cron job depends on, so tests and "email disabled" need no binding. */
export interface EmailSender {
  send: (message: EmailMessage) => Promise<EmailSendResult>;
}

/** Hand-typed subset of the Cloudflare `send_email` binding (no workers-types dependency). */
export interface EmailBinding {
  send: (message: {
    to: string;
    from: string | { email: string; name?: string };
    subject: string;
    html?: string;
    text?: string;
  }) => Promise<{ messageId: string }>;
}

/** The part of the Worker `Env` the email module reads. */
export interface EmailEnv {
  EMAIL?: EmailBinding;
  EMAIL_FROM?: string;
  EMAIL_FROM_NAME?: string;
}

export interface CloudflareEmailSenderOptions {
  binding: EmailBinding;
  /** Address on a domain onboarded to Email Service. */
  from: string;
  /** Optional display name shown to recipients. */
  fromName?: string;
}

export type RecipientStatus = "sent" | "failed" | "skipped";

export interface RecipientResult {
  /** Present for `skipped`: `invalid_address` or `over_limit`. */
  reason?: "invalid_address" | "over_limit";
  /** Present for `sent` and `failed`. */
  result?: EmailSendResult;
  status: RecipientStatus;
  /** Normalised (trimmed, lower-cased) address, or the raw input when it was invalid. */
  to: string;
}

export interface DigestSendSummary {
  failed: number;
  results: RecipientResult[];
  sent: number;
  skipped: number;
}

export interface RenderedEmail {
  html: string;
  subject: string;
  text: string;
}

function readErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const { code } = error;
    if (typeof code === "string" && code.length > 0) {
      return code;
    }
  }
  return EMAIL_UNKNOWN_CODE;
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Wraps the Cloudflare `env.EMAIL` binding. `send()` throws on every failure;
 * this converts those throws into a result value so one bad recipient can never
 * abort the cron run, and classifies the Cloudflare error code as retryable or not.
 */
export function createCloudflareEmailSender(
  options: CloudflareEmailSenderOptions
): EmailSender {
  const from = options.fromName
    ? { email: options.from, name: options.fromName }
    : options.from;
  return {
    async send(message: EmailMessage): Promise<EmailSendResult> {
      try {
        const { messageId } = await options.binding.send({
          from,
          html: message.html,
          subject: message.subject,
          text: message.text,
          to: message.to,
        });
        return { messageId, ok: true };
      } catch (error) {
        const code = readErrorCode(error);
        return {
          code,
          message: readErrorMessage(error),
          ok: false,
          retryable: code === EMAIL_UNKNOWN_CODE || RETRYABLE_CODES.has(code),
        };
      }
    },
  };
}

/**
 * A sender that always reports failure with `EMAIL_DISABLED`. Lets the digest
 * job run the same code path when email is not configured, and log why.
 */
export function createNullEmailSender(reason: string): EmailSender {
  return {
    send(): Promise<EmailSendResult> {
      return Promise.resolve({
        code: EMAIL_DISABLED_CODE,
        message: reason,
        ok: false,
        retryable: false,
      });
    },
  };
}

/**
 * Builds the sender from the Worker environment. The binding is declared in
 * wrangler.toml but `EMAIL_FROM` ships empty until an operator onboards a
 * domain, so missing or blank values mean "email off", not an error.
 */
export function createEmailSender(env: EmailEnv): EmailSender {
  const from = env.EMAIL_FROM?.trim();
  if (!env.EMAIL) {
    return createNullEmailSender("EMAIL binding is not configured");
  }
  if (!from) {
    return createNullEmailSender("EMAIL_FROM is not configured");
  }
  const fromName = env.EMAIL_FROM_NAME?.trim();
  return createCloudflareEmailSender({
    binding: env.EMAIL,
    from,
    ...(fromName ? { fromName } : {}),
  });
}

/** True for a plausible, safe-to-pass-on address (no whitespace, no CR/LF, bounded length). */
export function isValidEmailAddress(address: string): boolean {
  return address.length <= MAX_ADDRESS_LENGTH && EMAIL_PATTERN.test(address);
}

interface PlannedRecipients {
  invalid: string[];
  valid: string[];
}

function planRecipients(recipients: readonly string[]): PlannedRecipients {
  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const raw of recipients) {
    const address = raw.trim().toLowerCase();
    if (seen.has(address)) {
      continue;
    }
    seen.add(address);
    if (isValidEmailAddress(address)) {
      valid.push(address);
    } else {
      invalid.push(raw.trim());
    }
  }
  return { invalid, valid };
}

/**
 * Sends the rendered digest as one message per recipient. Separate messages
 * matter on the free tier: only verified destinations are accepted, and a
 * single unverified address in a shared `to` list would fail the whole send
 * and block the verified ones. Addresses are trimmed, lower-cased,
 * de-duplicated and validated, and capped at 50 (the platform recipient limit).
 * Sends are sequential to stay friendly to the rate limit.
 */
export async function sendDigestToRecipients(
  sender: EmailSender,
  recipients: readonly string[],
  rendered: RenderedEmail
): Promise<DigestSendSummary> {
  const { valid, invalid } = planRecipients(recipients);
  const results: RecipientResult[] = invalid.map((to) => ({
    reason: "invalid_address",
    status: "skipped",
    to,
  }));
  let sent = 0;
  let failed = 0;
  for (const [index, to] of valid.entries()) {
    if (index >= MAX_RECIPIENTS) {
      results.push({ reason: "over_limit", status: "skipped", to });
      continue;
    }
    // Sequential on purpose: keeps us under the send rate limit and the result order stable.
    const result = await sender.send({
      html: rendered.html,
      subject: rendered.subject,
      text: rendered.text,
      to,
    });
    results.push({ result, status: result.ok ? "sent" : "failed", to });
    if (result.ok) {
      sent += 1;
    } else {
      failed += 1;
    }
  }
  return { failed, results, sent, skipped: results.length - sent - failed };
}
