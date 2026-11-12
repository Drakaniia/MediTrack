import type { AlertBannerTopItem } from "@shared/schemas/alerts";
import { describe, expect, it } from "vitest";

import {
  bannerParts,
  bannerSummary,
  bannerVisible,
  countsIncreased,
  describeTopItem,
  lowerBaseline,
  parseBaseline,
} from "./banner-model";
import {
  badgeText,
  bellLabel,
  unreadAnnouncement,
  unreadFromMeta,
} from "./notification-view";

describe("bannerSummary", () => {
  it("joins the non-zero parts in severity order", () => {
    expect(bannerSummary({ expired: 2, lowStock: 4, urgent: 3 })).toBe(
      "2 batches expired · 3 urgent · 4 items low on stock"
    );
  });

  it("uses singular nouns and skips zeros", () => {
    expect(bannerSummary({ expired: 1, lowStock: 1, urgent: 0 })).toBe(
      "1 batch expired · 1 item low on stock"
    );
    expect(bannerSummary({ expired: 0, lowStock: 0, urgent: 0 })).toBe("");
  });

  it("links each part to its inventory view", () => {
    expect(
      bannerParts({ expired: 1, lowStock: 1, urgent: 1 }).map(
        (part) => part.href
      )
    ).toEqual([
      "/inventory/quarantine",
      "/inventory/expiry",
      "/inventory/low-stock",
    ]);
  });
});

describe("banner dismissal rules", () => {
  const dismissed = { expired: 2, lowStock: 1, urgent: 3 };

  it("stays hidden while nothing increased", () => {
    expect(bannerVisible(dismissed, dismissed)).toBe(false);
    expect(
      bannerVisible({ expired: 1, lowStock: 0, urgent: 3 }, dismissed)
    ).toBe(false);
  });

  it("comes back when any count rises", () => {
    expect(countsIncreased({ ...dismissed, urgent: 4 }, dismissed)).toBe(true);
    expect(bannerVisible({ ...dismissed, lowStock: 2 }, dismissed)).toBe(true);
  });

  it("is hidden at zero whatever was dismissed, and shown when never dismissed", () => {
    expect(bannerVisible({ expired: 0, lowStock: 0, urgent: 0 }, null)).toBe(
      false
    );
    expect(bannerVisible(dismissed, null)).toBe(true);
  });

  it("lowers the baseline with the counts, never raises it", () => {
    expect(
      lowerBaseline({ expired: 1, lowStock: 5, urgent: 3 }, dismissed)
    ).toEqual({
      expired: 1,
      lowStock: 1,
      urgent: 3,
    });
  });

  it("parses only well-formed stored baselines", () => {
    expect(parseBaseline(JSON.stringify(dismissed))).toEqual(dismissed);
    expect(parseBaseline(null)).toBeNull();
    expect(parseBaseline("nope")).toBeNull();
    expect(parseBaseline('{"expired":1}')).toBeNull();
    expect(parseBaseline('{"expired":-1,"lowStock":0,"urgent":0}')).toBeNull();
  });
});

function topItem(overrides: Partial<AlertBannerTopItem>): AlertBannerTopItem {
  return {
    available: null,
    batchId: "b",
    batchNumber: "B-12",
    daysUntil: -3,
    expiry: "2026-11-09",
    itemId: "i",
    itemName: "Amoxicillin 500 mg",
    kind: "expired",
    threshold: null,
    unit: "cap",
    ...overrides,
  };
}

describe("describeTopItem", () => {
  it("names the batch and the timing", () => {
    expect(describeTopItem(topItem({}))).toBe(
      "Amoxicillin 500 mg · batch B-12 · Expired 3d ago"
    );
    expect(
      describeTopItem(topItem({ daysUntil: 0, kind: "urgent" }))
    ).toContain("Expires today");
  });

  it("describes low stock as available versus threshold", () => {
    expect(
      describeTopItem(
        topItem({
          available: 5,
          batchNumber: null,
          itemName: "Gauze",
          kind: "low_stock",
          threshold: 20,
          unit: "roll",
        })
      )
    ).toBe("Gauze · 5 of 20 roll available");
  });
});

describe("bell helpers", () => {
  it("caps the badge and builds the accessible label", () => {
    expect(badgeText(3)).toBe("3");
    expect(badgeText(150)).toBe("99+");
    expect(bellLabel(3)).toBe("Notifications, 3 unread");
    expect(bellLabel(0)).toBe("Notifications, 0 unread");
  });

  it("announces only increases after the first value", () => {
    expect(unreadAnnouncement(null, 5)).toBe("");
    expect(unreadAnnouncement(2, 2)).toBe("");
    expect(unreadAnnouncement(5, 2)).toBe("");
    expect(unreadAnnouncement(2, 3)).toBe("1 new notification");
    expect(unreadAnnouncement(2, 6)).toBe("4 new notifications");
  });

  it("reads meta.unread defensively", () => {
    expect(unreadFromMeta({ total: 1, unread: 4 })).toBe(4);
    expect(unreadFromMeta({ total: 1 })).toBe(0);
  });
});
