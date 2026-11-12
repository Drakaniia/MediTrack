import { describe, expect, it } from "vitest";
import {
  createCloudflareEmailSender,
  createEmailSender,
  createNullEmailSender,
  type EmailBinding,
  type EmailMessage,
  type EmailSender,
  type EmailSendResult,
  isValidEmailAddress,
  sendDigestToRecipients,
} from "./sender";

const RENDERED = { html: "<p>H</p>", subject: "S", text: "T" };
const MESSAGE: EmailMessage = {
  html: "<p>html</p>",
  subject: "Subject",
  text: "plain",
  to: "nurse@example.org",
};

type BindingMessage = Parameters<EmailBinding["send"]>[0];

function bindingThatThrows(error: unknown): EmailBinding {
  return {
    send: () => Promise.reject(error),
  };
}

function codedError(code: string, message = "boom"): Error {
  return Object.assign(new Error(message), { code });
}

function recordingBinding(): { binding: EmailBinding; sent: BindingMessage[] } {
  const sent: BindingMessage[] = [];
  return {
    binding: {
      send: (message) => {
        sent.push(message);
        return Promise.resolve({ messageId: `id-${sent.length}` });
      },
    },
    sent,
  };
}

describe("createCloudflareEmailSender", () => {
  it("passes the message through with from and returns the message id", async () => {
    const { binding, sent } = recordingBinding();
    const sender = createCloudflareEmailSender({
      binding,
      from: "alerts@example.org",
    });
    const result = await sender.send(MESSAGE);
    expect(result).toEqual({ messageId: "id-1", ok: true });
    expect(sent).toEqual([
      {
        from: "alerts@example.org",
        html: MESSAGE.html,
        subject: MESSAGE.subject,
        text: MESSAGE.text,
        to: MESSAGE.to,
      },
    ]);
  });

  it("uses a named from address when fromName is set", async () => {
    const { binding, sent } = recordingBinding();
    const sender = createCloudflareEmailSender({
      binding,
      from: "alerts@example.org",
      fromName: "MediTract",
    });
    await sender.send(MESSAGE);
    expect(sent[0]?.from).toEqual({
      email: "alerts@example.org",
      name: "MediTract",
    });
  });

  it("classifies transient Cloudflare errors as retryable", async () => {
    for (const code of [
      "E_RATE_LIMIT_EXCEEDED",
      "E_INTERNAL_SERVER_ERROR",
      "E_DELIVERY_FAILED",
    ]) {
      const sender = createCloudflareEmailSender({
        binding: bindingThatThrows(codedError(code, "slow down")),
        from: "a@example.org",
      });
      expect(await sender.send(MESSAGE)).toEqual({
        code,
        message: "slow down",
        ok: false,
        retryable: true,
      });
    }
  });

  it("classifies permanent Cloudflare errors as not retryable", async () => {
    for (const code of [
      "E_RECIPIENT_NOT_ALLOWED",
      "E_SENDER_NOT_VERIFIED",
      "E_SENDER_DOMAIN_NOT_AVAILABLE",
      "E_DAILY_LIMIT_EXCEEDED",
      "E_VALIDATION_ERROR",
      "E_RECIPIENT_SUPPRESSED",
      "E_ACCOUNT_SUSPENDED",
    ]) {
      const sender = createCloudflareEmailSender({
        binding: bindingThatThrows(codedError(code)),
        from: "a@example.org",
      });
      const result = await sender.send(MESSAGE);
      expect(result).toMatchObject({ code, ok: false, retryable: false });
    }
  });

  it("never throws, even for errors without a code or non-Error throws", async () => {
    const plain = createCloudflareEmailSender({
      binding: bindingThatThrows(new Error("socket hang up")),
      from: "a@example.org",
    });
    expect(await plain.send(MESSAGE)).toEqual({
      code: "E_UNKNOWN",
      message: "socket hang up",
      ok: false,
      retryable: true,
    });
    const weird = createCloudflareEmailSender({
      binding: bindingThatThrows("nope"),
      from: "a@example.org",
    });
    expect(await weird.send(MESSAGE)).toMatchObject({
      code: "E_UNKNOWN",
      message: "nope",
      ok: false,
    });
  });
});

describe("createNullEmailSender and createEmailSender", () => {
  it("null sender always reports EMAIL_DISABLED with the reason", async () => {
    const result = await createNullEmailSender("off for now").send(MESSAGE);
    expect(result).toEqual({
      code: "EMAIL_DISABLED",
      message: "off for now",
      ok: false,
      retryable: false,
    });
  });

  it("returns the null sender when the binding or from address is missing or blank", async () => {
    const { binding } = recordingBinding();
    const cases = [
      {},
      { EMAIL: binding },
      { EMAIL: binding, EMAIL_FROM: "" },
      { EMAIL: binding, EMAIL_FROM: "   " },
      { EMAIL_FROM: "a@example.org" },
    ];
    for (const env of cases) {
      const result = await createEmailSender(env).send(MESSAGE);
      expect(result).toMatchObject({ code: "EMAIL_DISABLED", ok: false });
    }
  });

  it("returns a working Cloudflare sender when configured", async () => {
    const { binding, sent } = recordingBinding();
    const sender = createEmailSender({
      EMAIL: binding,
      EMAIL_FROM: " alerts@example.org ",
      EMAIL_FROM_NAME: "MediTract",
    });
    expect((await sender.send(MESSAGE)).ok).toBe(true);
    expect(sent[0]?.from).toEqual({
      email: "alerts@example.org",
      name: "MediTract",
    });
  });
});

describe("isValidEmailAddress", () => {
  it("accepts ordinary addresses", () => {
    expect(isValidEmailAddress("a.b+tag@sub.example.org")).toBe(true);
  });

  it("rejects malformed, header-injecting and oversized addresses", () => {
    for (const bad of [
      "",
      "no-at.example.org",
      "a@b",
      "a b@example.org",
      "a@example.org\r\nBcc: x@y.z",
      "<a@example.org>",
      `${"a".repeat(250)}@example.org`,
    ]) {
      expect(isValidEmailAddress(bad)).toBe(false);
    }
  });
});

describe("sendDigestToRecipients", () => {
  function scriptedSender(failFor: ReadonlySet<string>): {
    sender: EmailSender;
    calls: EmailMessage[];
  } {
    const calls: EmailMessage[] = [];
    return {
      calls,
      sender: {
        send: (message): Promise<EmailSendResult> => {
          calls.push(message);
          return Promise.resolve(
            failFor.has(message.to)
              ? {
                  code: "E_RECIPIENT_NOT_ALLOWED",
                  message: "not verified",
                  ok: false,
                  retryable: false,
                }
              : { messageId: `m-${calls.length}`, ok: true }
          );
        },
      },
    };
  }

  it("sends one message per recipient with the rendered content", async () => {
    const { sender, calls } = scriptedSender(new Set());
    const summary = await sendDigestToRecipients(
      sender,
      ["a@example.org", "b@example.org"],
      RENDERED
    );
    expect(calls.map((call) => call.to)).toEqual([
      "a@example.org",
      "b@example.org",
    ]);
    expect(calls[0]).toEqual({ to: "a@example.org", ...RENDERED });
    expect(summary).toMatchObject({ failed: 0, sent: 2, skipped: 0 });
  });

  it("does not let one failing recipient block the others", async () => {
    const { sender } = scriptedSender(new Set(["bad@example.org"]));
    const summary = await sendDigestToRecipients(
      sender,
      ["a@example.org", "bad@example.org", "c@example.org"],
      RENDERED
    );
    expect(summary).toMatchObject({ failed: 1, sent: 2, skipped: 0 });
    expect(summary.results.map((entry) => entry.status)).toEqual([
      "sent",
      "failed",
      "sent",
    ]);
    expect(summary.results[1]?.result).toMatchObject({
      code: "E_RECIPIENT_NOT_ALLOWED",
      ok: false,
    });
  });

  it("de-duplicates case-insensitively and trims", async () => {
    const { sender, calls } = scriptedSender(new Set());
    const summary = await sendDigestToRecipients(
      sender,
      ["A@Example.org", " a@example.org ", "a@example.org"],
      RENDERED
    );
    expect(calls).toHaveLength(1);
    expect(summary).toMatchObject({ failed: 0, sent: 1, skipped: 0 });
  });

  it("skips invalid addresses without sending to them", async () => {
    const { sender, calls } = scriptedSender(new Set());
    const summary = await sendDigestToRecipients(
      sender,
      ["not-an-email", "ok@example.org", ""],
      RENDERED
    );
    expect(calls.map((call) => call.to)).toEqual(["ok@example.org"]);
    expect(summary).toMatchObject({ failed: 0, sent: 1, skipped: 2 });
    expect(
      summary.results.filter((entry) => entry.reason === "invalid_address")
    ).toHaveLength(2);
  });

  it("caps at 50 recipients and reports the rest as skipped", async () => {
    const { sender, calls } = scriptedSender(new Set());
    const recipients = Array.from(
      { length: 60 },
      (_, index) => `user${index}@example.org`
    );
    const summary = await sendDigestToRecipients(sender, recipients, RENDERED);
    expect(calls).toHaveLength(50);
    expect(summary).toMatchObject({ failed: 0, sent: 50, skipped: 10 });
    expect(summary.results.at(-1)).toMatchObject({
      reason: "over_limit",
      status: "skipped",
    });
  });

  it("returns an empty summary for no recipients", async () => {
    const { sender, calls } = scriptedSender(new Set());
    const summary = await sendDigestToRecipients(sender, [], RENDERED);
    expect(calls).toHaveLength(0);
    expect(summary).toEqual({ failed: 0, results: [], sent: 0, skipped: 0 });
  });

  it("reports every recipient as failed with EMAIL_DISABLED when email is off", async () => {
    const summary = await sendDigestToRecipients(
      createNullEmailSender("off"),
      ["a@example.org"],
      RENDERED
    );
    expect(summary).toMatchObject({ failed: 1, sent: 0, skipped: 0 });
    expect(summary.results[0]?.result).toMatchObject({
      code: "EMAIL_DISABLED",
    });
  });
});
