import type { DailyJobDone, JobRunDto } from "@shared/schemas/alert-run";
import {
  MAX_DIGEST_RECIPIENTS,
  mergeSettings,
  type SettingsPatch,
} from "@shared/settings";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { MockRequest } from "@/test/mock-api";
import { makeMe, renderWithProviders } from "@/test/render";

import { makeSettings } from "../test-data";
import { SettingsPage } from "./settings-page";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

const REPORT: DailyJobDone = {
  counts: { expired: 1, lowStock: 2, nearExpiry: 3, safe: 40, urgent: 4 },
  email: {
    failed: 1,
    failures: [{ code: "destination_not_verified", to: "x@example.org" }],
    recipients: 3,
    sent: 2,
    skipped: 0,
    skippedReason: null,
  },
  force: true,
  localDate: "2026-11-12",
  lowStockAlerts: 2,
  notificationsCreated: 7,
  purged: { loginAttempts: 0, notifications: 0, sessions: 0 },
  push: {
    devices: 3,
    failed: 0,
    gone: 1,
    removed: 0,
    sent: 2,
    skipped: null,
  },
  resolved: 0,
  status: "ok",
  transitions: 5,
};

const RUNS: JobRunDto[] = [
  {
    finishedAt: "2026-11-11T22:00:05.000Z",
    id: "run-1",
    job: "daily-alerts",
    runDate: "2026-11-12",
    startedAt: "2026-11-11T22:00:00.000Z",
    status: "ok",
    summary: REPORT,
  },
  {
    finishedAt: null,
    id: "run-2",
    job: "daily-alerts",
    runDate: "2026-11-11",
    startedAt: "2026-11-10T22:00:00.000Z",
    status: "error",
    summary: { message: "D1 unavailable" },
  },
];

async function openAlerts(
  settings = makeSettings(),
  extra: Record<string, (request: MockRequest) => unknown> = {}
) {
  const user = userEvent.setup();
  let current = settings;
  const rendered = await renderWithProviders(<SettingsPage />, {
    handlers: {
      "GET /api/alerts/run/status": () => RUNS,
      "GET /api/settings": () => current,
      "PUT /api/settings": (request: MockRequest) => {
        current = mergeSettings(current, request.body as SettingsPatch);
        return current;
      },
      ...extra,
    },
    me: makeMe("admin"),
  });
  await screen.findByLabelText("Facility name");
  await user.click(screen.getByRole("tab", { name: "Alerts" }));
  await screen.findByRole("switch", { name: "In-app notifications" });
  return { ...rendered, user };
}

function putBodies(api: { callsTo: (key: string) => MockRequest[] }) {
  return api.callsTo("PUT /api/settings").map((call) => call.body);
}

describe("Alerts tab", () => {
  it("shows the channels, the recipients note and the schedule", async () => {
    await openAlerts();
    expect(
      screen.getByRole("switch", { name: "In-app notifications" })
    ).toBeChecked();
    expect(screen.getByRole("switch", { name: "Browser push" })).toBeChecked();
    expect(
      screen.getByRole("switch", { name: "Email digest" })
    ).not.toBeChecked();
    expect(screen.getByLabelText("Daily run time")).toHaveValue("06:00");
    expect(
      screen.getByText(/verified in your Cloudflare account/)
    ).toBeInTheDocument();
    expect(
      screen.getByText("0 of 50 recipients", { exact: false })
    ).toBeInTheDocument();
  });

  it("sends a minimal patch: only the schedule when only the time changed", async () => {
    const { api } = await openAlerts();
    const save = screen.getByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Daily run time"), {
      target: { value: "07:30" },
    });
    await userEvent.click(save);
    await waitFor(() => expect(putBodies(api)).toHaveLength(1));
    expect(putBodies(api)[0]).toEqual({ schedule: { dailyTime: "07:30" } });
  });

  it("won't enable the digest without a recipient, then sends toggle + recipients together", async () => {
    const { api, user } = await openAlerts();
    await user.click(screen.getByRole("switch", { name: "Email digest" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(
      await screen.findByText(
        "Add at least one recipient to enable the email digest."
      )
    ).toBeInTheDocument();
    expect(putBodies(api)).toHaveLength(0);

    await user.type(
      screen.getByLabelText("Add a recipient"),
      "Nurse@Example.org{Enter}"
    );
    const list = screen.getByRole("list", { name: "Digest recipients" });
    expect(within(list).getByText("nurse@example.org")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(putBodies(api)).toHaveLength(1));
    expect(putBodies(api)[0]).toEqual({
      alerts: { emailDigest: true },
      digest: { recipients: ["nurse@example.org"] },
    });
  });

  it("validates recipients: format, duplicates, removal", async () => {
    const { user } = await openAlerts(
      makeSettings({
        digest: { recipients: ["a@example.org"], skipWhenQuiet: true },
      })
    );
    const input = screen.getByLabelText("Add a recipient");
    await user.type(input, "not-an-email");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(
      await screen.findByText("Enter a valid email address.")
    ).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, "A@example.org");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(
      await screen.findByText("That address is already on the list.")
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Remove a@example.org" })
    );
    expect(screen.getByText("No recipients yet.")).toBeInTheDocument();
  });

  it("stops at 50 recipients", async () => {
    const full = Array.from(
      { length: MAX_DIGEST_RECIPIENTS },
      (_, index) => `user${index}@example.org`
    );
    const { user } = await openAlerts(
      makeSettings({ digest: { recipients: full, skipWhenQuiet: true } })
    );
    expect(screen.getByText(/50 of 50 recipients/)).toBeInTheDocument();
    await user.type(
      screen.getByLabelText("Add a recipient"),
      "one.more@example.org"
    );
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(
      await screen.findByText("You can add up to 50 recipients.")
    ).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(MAX_DIGEST_RECIPIENTS);
  });

  it("runs the job now and summarises the result", async () => {
    const { api, user } = await openAlerts(makeSettings(), {
      "POST /api/alerts/run": () => REPORT,
    });
    const runs = within(
      screen.getByRole("table", { name: "Last runs of the daily alert job" })
    ).getAllByRole("row");
    expect(runs).toHaveLength(3);
    expect(
      within(runs[1]).getByText("7 notifications · push sent 2 · email sent 2")
    ).toBeInTheDocument();
    expect(within(runs[2]).getByText("D1 unavailable")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Run alert job now" }));
    const result = await screen.findByText(
      "Alert job finished for 2026-11-12."
    );
    expect(api.callsTo("POST /api/alerts/run")[0].body).toEqual({
      force: true,
      sendEmail: false,
    });
    const box = result.closest("[role=status]") as HTMLElement;
    expect(
      within(box).getByText(/7 notifications created/)
    ).toBeInTheDocument();
    expect(
      within(box).getByText("Push: sent 2, gone 1, failed 0")
    ).toBeInTheDocument();
    expect(
      within(box).getByText("Email: sent 2, failed 1, skipped 0")
    ).toBeInTheDocument();
    expect(
      within(box).getByText("x@example.org: destination_not_verified")
    ).toBeInTheDocument();
  });

  it("sends the email digest only when asked", async () => {
    const { api, user } = await openAlerts(makeSettings(), {
      "POST /api/alerts/run": () => ({
        dueTime: "06:00",
        localDate: "2026-11-12",
        localTime: "05:00",
        reason: "not_due",
        status: "skipped",
      }),
    });
    await user.click(screen.getByLabelText("Also send the email digest"));
    await user.click(screen.getByRole("button", { name: "Run alert job now" }));
    expect(
      await screen.findByText(/The alert job did not run\./)
    ).toHaveTextContent("It is not time yet.");
    expect(api.callsTo("POST /api/alerts/run")[0].body).toEqual({
      force: true,
      sendEmail: true,
    });
  });
});
