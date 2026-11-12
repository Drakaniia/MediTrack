import { addDays } from "@shared/dates";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MockRequest } from "@/test/mock-api";
import { page } from "@/test/mock-api";
import { makeMe, renderWithProviders } from "@/test/render";

import { makeAuditEntry, makeUser } from "../test-data";
import { AuditPage } from "./audit-page";

vi.mock("@cmis/ui/components/popover", () => import("@/test/popover-shim"));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

const ENTRIES = [
  makeAuditEntry({ id: 3 }),
  makeAuditEntry({
    action: "auth.login",
    actorId: "user-maria",
    actorName: "Maria Santos",
    actorRole: "pharmacist",
    after: null,
    at: "2026-11-11T16:05:00.000Z",
    before: null,
    entityType: "user",
    id: 2,
    summary: "Signed in",
  }),
];

function lastAuditQuery(api: { callsTo: (key: string) => MockRequest[] }) {
  return api.callsTo("GET /api/audit").at(-1)?.query ?? {};
}

function renderPage(
  me = makeMe("admin"),
  handlers: Record<string, (request: MockRequest) => unknown> = {}
) {
  return renderWithProviders(<AuditPage />, {
    handlers: {
      "GET /api/audit": () => page(ENTRIES, { total: ENTRIES.length }),
      "GET /api/users": () => page([makeUser()]),
      ...handlers,
    },
    me,
  });
}

// jsdom's Blob has no `text()`.
function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AuditPage", () => {
  it("lists entries with the time on the facility clock, actor, role and action", async () => {
    await renderPage();
    const table = await screen.findByRole("table", {
      name: "Audit log, newest first",
    });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(3);
    // 2026-11-11T16:30Z is 00:30 the next day in Asia/Manila.
    expect(within(rows[1]).getByText("12 Nov 2026, 00:30")).toBeInTheDocument();
    expect(
      within(rows[1]).getByText("Test System Administrator")
    ).toBeInTheDocument();
    expect(
      within(rows[1]).getByText("System Administrator")
    ).toBeInTheDocument();
    expect(within(rows[1]).getByText("user.update")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Pharmacist")).toBeInTheDocument();
  });

  it("builds the query string from facility-local dates and the other filters", async () => {
    const user = userEvent.setup();
    const me = makeMe("admin", { settings: { timezone: "Pacific/Auckland" } });
    const { api } = await renderPage(me);
    await screen.findByRole("table");
    expect(lastAuditQuery(api)).toMatchObject({ limit: "50", offset: "0" });
    expect(lastAuditQuery(api)).not.toHaveProperty("from");

    await user.type(screen.getByLabelText("From date"), "2026-11-01");
    await user.type(screen.getByLabelText("To date"), "2026-11-12");
    await user.click(screen.getByRole("button", { name: "Auth" }));
    await user.selectOptions(screen.getByLabelText("Actor"), "user-maria");
    await user.selectOptions(screen.getByLabelText("Record type"), "user");
    await user.type(screen.getByLabelText("Search summary or actor"), "role");

    await waitFor(() =>
      expect(lastAuditQuery(api)).toEqual({
        action: "auth.",
        actorId: "user-maria",
        entityType: "user",
        from: "2026-11-01",
        limit: "50",
        offset: "0",
        q: "role",
        to: "2026-11-12",
      })
    );

    // A chip is a toggle: pressing it again drops the filter.
    await user.click(screen.getByRole("button", { name: "Auth" }));
    await waitFor(() =>
      expect(lastAuditQuery(api)).not.toHaveProperty("action")
    );
  });

  it("uses the facility's today for the quick ranges", async () => {
    const user = userEvent.setup();
    const me = makeMe("admin", { settings: { timezone: "Pacific/Auckland" } });
    const { api } = await renderPage(me);
    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "Last 7 days" }));
    await waitFor(() =>
      expect(lastAuditQuery(api)).toMatchObject({
        from: addDays(me.today, -6),
        to: me.today,
      })
    );
  });

  it("explains an inverted date range instead of asking the server", async () => {
    const user = userEvent.setup();
    const { api } = await renderPage();
    await screen.findByRole("table");
    await user.type(screen.getByLabelText("From date"), "2026-11-12");
    await user.type(screen.getByLabelText("To date"), "2026-11-01");
    expect(
      await screen.findByText("The start date must not be after the end date.")
    ).toBeInTheDocument();
    expect(
      api
        .callsTo("GET /api/audit")
        .some(
          (call) =>
            call.query.from === "2026-11-12" && call.query.to === "2026-11-01"
        )
    ).toBe(false);
  });

  it("pages on the server and returns to page 1 when a filter changes", async () => {
    const user = userEvent.setup();
    const rows = Array.from({ length: 50 }, (_, index) =>
      makeAuditEntry({ id: 100 - index })
    );
    const { api } = await renderPage(makeMe("admin"), {
      "GET /api/audit": () => page(rows, { total: 120 }),
    });
    expect(await screen.findByText("Showing 1–50 of 120")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(lastAuditQuery(api).offset).toBe("50"));
    expect(
      await screen.findByText("Showing 51–100 of 120")
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Auth" }));
    await waitFor(() =>
      expect(lastAuditQuery(api)).toMatchObject({
        action: "auth.",
        offset: "0",
      })
    );
  });

  it("opens a drawer with a before / after diff", async () => {
    const user = userEvent.setup();
    await renderPage(makeMe("admin"), {
      "GET /api/audit": () =>
        page([
          makeAuditEntry({
            after: { email: "m@x.org", role: "nurse" },
            before: { email: "m@x.org", role: "pharmacist" },
          }),
        ]),
    });
    await user.click(
      await screen.findByRole("button", { name: /^Details of user\.update/ })
    );
    const drawer = await screen.findByRole("dialog", { name: "Audit entry" });
    const diff = within(drawer).getByRole("table", {
      name: "Before and after",
    });
    const roleRow = within(diff).getByRole("row", { name: /role/ });
    expect(within(roleRow).getByText('"pharmacist"')).toBeInTheDocument();
    expect(within(roleRow).getByText('"nurse"')).toBeInTheDocument();
    expect(within(roleRow).getByText("Changed")).toBeInTheDocument();
    const emailRow = within(diff).getByRole("row", { name: /email/ });
    expect(within(emailRow).getByText("Unchanged")).toBeInTheDocument();
    expect(within(drawer).getByText("203.0.113.7")).toBeInTheDocument();
  });

  it("says so when an entry has no snapshot", async () => {
    const user = userEvent.setup();
    await renderPage(makeMe("admin"), {
      "GET /api/audit": () =>
        page([makeAuditEntry({ after: null, before: null })]),
    });
    await user.click(
      await screen.findByRole("button", { name: /^Details of/ })
    );
    expect(
      await screen.findByText(/No before \/ after snapshot/)
    ).toBeInTheDocument();
  });

  it("hides the actor filter, and never asks for users, without users.manage", async () => {
    const { api } = await renderPage(makeMe("health_admin"), {
      "GET /api/users": () => {
        throw new Error("health admin must not list users");
      },
    });
    await screen.findByRole("table");
    expect(screen.queryByLabelText("Actor")).toBeNull();
    expect(api.callsTo("GET /api/users")).toHaveLength(0);
  });

  it("exports every entry matching the filters as CSV, only with reports.export", async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn(() => "blob:audit");
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      () => undefined
    );

    const { api } = await renderPage();
    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "Auth" }));
    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    expect(lastAuditQuery(api)).toMatchObject({
      action: "auth.",
      limit: "200",
      offset: "0",
    });
    const [[blob]] = createObjectURL.mock.calls as unknown as [[Blob]];
    const text = await readBlob(blob);
    expect(text).toContain('"Time (facility)","Time (UTC)","Actor"');
    expect(text).toContain('"12 Nov 2026, 00:30","2026-11-11T16:30:00.000Z"');
    expect(text).toContain('"Signed in"');
  });

  it("does not offer the export without reports.export", async () => {
    const base = makeMe("health_admin");
    await renderPage({
      ...base,
      permissions: base.permissions.filter((p) => p !== "reports.export"),
    });
    await screen.findByRole("table");
    expect(screen.queryByRole("button", { name: "Export CSV" })).toBeNull();
  });
});
