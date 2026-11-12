import type {
  AlertBannerDto,
  NotificationDto,
  PushSubscriptionDto,
} from "@shared/schemas/alerts";

import { type MockResponse, page } from "@/test/mock-api";

/** Builders for component tests. */

/** `GET /api/alerts`: the rows plus `meta.total` and `meta.unread`, like the real endpoint. */
export function alertsPage(
  rows: readonly NotificationDto[],
  options: { offset?: number; total?: number; unread: number }
): MockResponse {
  const meta = {
    offset: options.offset ?? 0,
    total: options.total ?? rows.length,
    unread: options.unread,
  };
  return page(rows, meta as { total: number });
}

let sequence = 0;

export function makeNotification(
  overrides: Partial<NotificationDto> = {}
): NotificationDto {
  sequence += 1;
  return {
    batchId: null,
    body: "Batch LOT-1 expires in 3 days.",
    createdAt: "2026-11-12T02:00:00.000Z",
    data: {},
    dismissed: false,
    id: `notif-${sequence}`,
    itemId: null,
    kind: "urgent",
    read: false,
    resolvedAt: null,
    severity: "warning",
    title: `Alert ${sequence}`,
    ...overrides,
  };
}

export function makeBanner(
  overrides: Partial<AlertBannerDto> = {}
): AlertBannerDto {
  return {
    counts: { expired: 0, lowStock: 0, urgent: 0 },
    enabled: true,
    thresholds: { nearDays: 30, urgentDays: 7 },
    today: "2026-11-12",
    topItems: [],
    unreadCount: 0,
    ...overrides,
  };
}

export function makeDevice(
  overrides: Partial<PushSubscriptionDto> = {}
): PushSubscriptionDto {
  sequence += 1;
  return {
    createdAt: "2026-11-10T02:00:00.000Z",
    endpointHost: "fcm.googleapis.com",
    endpointTail: `tail-${String(sequence).padStart(3, "0")}`,
    id: `device-${sequence}`,
    lastSuccessAt: null,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36",
    ...overrides,
  };
}
