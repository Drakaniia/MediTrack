import { describe, expect, it } from "vitest";
import type { AlertBannerTopItem } from "../../../shared/schemas/alerts";
import {
  alertsQuerySchema,
  base64UrlByteLength,
  endpointTail,
  pushSubscribeSchema,
} from "../../../shared/schemas/alerts";
import { pickTopItems } from "./banner-queries";
import {
  isLocalPath,
  parseNotificationData,
  toNotificationDto,
} from "./notification-mapper";

describe("base64UrlByteLength", () => {
  it("measures the decoded size", () => {
    expect(base64UrlByteLength(Buffer.alloc(65).toString("base64url"))).toBe(
      65
    );
    expect(base64UrlByteLength(Buffer.alloc(16).toString("base64url"))).toBe(
      16
    );
    expect(base64UrlByteLength(Buffer.alloc(16).toString("base64"))).toBe(16);
  });

  it("rejects text that is not base64url", () => {
    expect(base64UrlByteLength("")).toBeNull();
    expect(base64UrlByteLength("ab+/")).toBeNull();
    expect(base64UrlByteLength("a")).toBeNull();
    expect(base64UrlByteLength("ab cd")).toBeNull();
  });
});

describe("pushSubscribeSchema", () => {
  const keys = {
    auth: Buffer.alloc(16, 1).toString("base64url"),
    p256dh: Buffer.alloc(65, 2).toString("base64url"),
  };

  it("accepts a well-formed subscription", () => {
    const parsed = pushSubscribeSchema.safeParse({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      keys,
      userAgent: "  Firefox  ",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.userAgent).toBe("Firefox");
  });

  it("rejects unknown fields and non-https endpoints", () => {
    expect(
      pushSubscribeSchema.safeParse({
        endpoint: "https://x.test/a",
        extra: 1,
        keys,
      }).success
    ).toBe(false);
    expect(
      pushSubscribeSchema.safeParse({ endpoint: "ftp://x.test/a", keys })
        .success
    ).toBe(false);
  });
});

describe("alertsQuerySchema", () => {
  it("reads flags and comma lists", () => {
    const parsed = alertsQuerySchema.parse({
      includeDismissed: "true",
      kind: "expired, urgent",
      unread: "1",
    });
    expect(parsed).toEqual({
      includeDismissed: true,
      kind: ["expired", "urgent"],
      unread: true,
    });
  });

  it("rejects bad values", () => {
    expect(alertsQuerySchema.safeParse({ unread: "yes" }).success).toBe(false);
    expect(alertsQuerySchema.safeParse({ kind: "" }).success).toBe(false);
  });
});

describe("endpointTail", () => {
  it("keeps the last characters", () => {
    expect(endpointTail("https://h.test/abcdefghij")).toBe("cdefghij");
    expect(endpointTail("short")).toBe("short");
  });
});

describe("parseNotificationData", () => {
  it("keeps only known, well-typed fields", () => {
    expect(
      parseNotificationData(
        JSON.stringify({
          batchNumber: "B1",
          daysUntil: 4,
          expiry: "2026-11-16",
          itemName: "Gauze",
          onHand: "many",
          secret: "x",
          url: "/inventory/expiry",
        })
      )
    ).toEqual({
      batchNumber: "B1",
      daysUntil: 4,
      expiry: "2026-11-16",
      itemName: "Gauze",
      url: "/inventory/expiry",
    });
  });

  it("returns {} for non-objects and corrupt JSON", () => {
    expect(parseNotificationData("[]")).toEqual({});
    expect(parseNotificationData("null")).toEqual({});
    expect(parseNotificationData("{oops")).toEqual({});
  });
});

describe("isLocalPath", () => {
  it("only allows same-origin paths", () => {
    expect(isLocalPath("/inventory")).toBe(true);
    expect(isLocalPath("//evil.test")).toBe(false);
    expect(isLocalPath("https://evil.test")).toBe(false);
    expect(isLocalPath("javascript:alert(1)")).toBe(false);
  });
});

describe("toNotificationDto", () => {
  it("maps state columns to booleans", () => {
    const dto = toNotificationDto({
      batch_id: null,
      body: "b",
      created_at: "2026-11-12T00:00:00.000Z",
      data: "{}",
      dismissed_at: "2026-11-12T01:00:00.000Z",
      id: "n",
      item_id: "i",
      kind: "expired",
      read_at: null,
      resolved_at: null,
      severity: "critical",
      title: "t",
    });
    expect(dto).toMatchObject({ dismissed: true, read: false });
  });
});

function top(
  kind: AlertBannerTopItem["kind"],
  itemName: string
): AlertBannerTopItem {
  return {
    available: null,
    batchId: null,
    batchNumber: null,
    daysUntil: null,
    expiry: null,
    itemId: itemName,
    itemName,
    kind,
    threshold: null,
    unit: "",
  };
}

describe("pickTopItems", () => {
  it("orders by severity, stable within a kind, and caps at three", () => {
    const picked = pickTopItems([
      top("expired", "e1"),
      top("expired", "e2"),
      top("urgent", "u1"),
      top("low_stock", "l1"),
      top("expired", "e3"),
    ]);
    expect(picked.map((item) => item.itemName)).toEqual(["e1", "e2", "e3"]);
    expect(
      pickTopItems([top("low_stock", "l1"), top("urgent", "u1")]).map(
        (item) => item.itemName
      )
    ).toEqual(["u1", "l1"]);
  });
});
