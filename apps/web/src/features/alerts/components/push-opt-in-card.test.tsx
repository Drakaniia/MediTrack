import { endpointTail } from "@shared/schemas/alerts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MockRequest } from "@/test/mock-api";
import { makeMe, renderWithProviders } from "@/test/render";

import { currentSubscription, subscribeThisDevice } from "../lib/push-browser";
import { type PushEnvironment, readPushEnvironment } from "../lib/push-client";
import { makeDevice } from "../test-data";
import { PushOptInCard } from "./push-opt-in-card";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));
vi.mock("../lib/push-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/push-client")>()),
  readPushEnvironment: vi.fn(),
}));
vi.mock("../lib/push-browser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/push-browser")>()),
  currentSubscription: vi.fn(),
  subscribeThisDevice: vi.fn(),
}));

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abcdef-this-device";
const KEY = "BPublicKey";
const SUPPORTED: PushEnvironment = {
  hasNotification: true,
  hasPushManager: true,
  hasServiceWorker: true,
  isIos: false,
  isSecureContext: true,
  isStandalone: false,
  permission: "default",
};

function environment(overrides: Partial<PushEnvironment> = {}): void {
  vi.mocked(readPushEnvironment).mockReturnValue({
    ...SUPPORTED,
    ...overrides,
  });
}

function fakeSubscription() {
  const json = {
    endpoint: ENDPOINT,
    keys: { auth: "authkey", p256dh: "p256dhkey" },
  };
  return { endpoint: ENDPOINT, toJSON: () => json, unsubscribe: vi.fn() };
}

function handlers(
  config: { enabled: boolean; publicKey: string | null },
  devices = [] as ReturnType<typeof makeDevice>[]
) {
  const state = { devices };
  return {
    handlers: {
      "DELETE /api/push/subscriptions/:id": (request: MockRequest) => {
        state.devices = state.devices.filter(
          (device) => device.id !== request.params.id
        );
      },
      "GET /api/push/config": () => config,
      "GET /api/push/subscriptions": () => state.devices,
      "POST /api/push/subscribe": () => {
        state.devices = [
          makeDevice({ endpointTail: endpointTail(ENDPOINT) }),
          ...state.devices,
        ];
        return { id: "new" };
      },
      "POST /api/push/unsubscribe": () => {
        state.devices = [];
        return { removed: true };
      },
    },
    state,
  };
}

const ENABLED = { enabled: true, publicKey: KEY };

beforeEach(() => {
  vi.mocked(currentSubscription).mockResolvedValue(null);
  environment();
});

describe("PushOptInCard", () => {
  it("says so when the browser has no push support", async () => {
    environment({ hasPushManager: false, permission: null });
    await renderWithProviders(<PushOptInCard />, {
      handlers: handlers(ENABLED).handlers,
    });

    expect(await screen.findByText("Not supported")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /browser notifications/ })
    ).not.toBeInTheDocument();
  });

  it("asks for HTTPS on an insecure page", async () => {
    environment({ isSecureContext: false });
    await renderWithProviders(<PushOptInCard />, {
      handlers: handlers(ENABLED).handlers,
    });

    expect(await screen.findByText("Needs HTTPS")).toBeInTheDocument();
    expect(screen.getByText(/Open MediTract over https/)).toBeInTheDocument();
  });

  it("tells iPhone users to install to the Home Screen first", async () => {
    environment({ isIos: true, isStandalone: false });
    await renderWithProviders(<PushOptInCard />, {
      handlers: handlers(ENABLED).handlers,
    });

    expect(await screen.findByText("Install first")).toBeInTheDocument();
    expect(
      screen.getByText(/add MediTract to your Home Screen first/)
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Enable/ })
    ).not.toBeInTheDocument();
  });

  it("explains a blocked permission and offers no button", async () => {
    environment({ permission: "denied" });
    await renderWithProviders(<PushOptInCard />, {
      handlers: handlers(ENABLED).handlers,
    });

    expect(await screen.findByText("Blocked")).toBeInTheDocument();
    expect(screen.getByText(/site settings/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Enable/ })
    ).not.toBeInTheDocument();
  });

  it("is unavailable when the facility has push switched off", async () => {
    await renderWithProviders(<PushOptInCard />, {
      handlers: handlers({ enabled: false, publicKey: null }).handlers,
    });

    expect(await screen.findByText("Unavailable")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Enable/ })
    ).not.toBeInTheDocument();
  });

  it("enables this device: subscribes, registers it and lists it", async () => {
    const subscription = fakeSubscription();
    vi.mocked(subscribeThisDevice).mockImplementation(() => {
      environment({ permission: "granted" });
      return Promise.resolve(subscription as unknown as PushSubscription);
    });
    vi.mocked(currentSubscription).mockResolvedValue(
      subscription as unknown as PushSubscription
    );
    const { api } = await renderWithProviders(<PushOptInCard />, {
      handlers: handlers(ENABLED).handlers,
      me: makeMe("nurse"),
    });

    await userEvent.click(
      await screen.findByRole("button", {
        name: "Enable browser notifications",
      })
    );

    await waitFor(() =>
      expect(api.callsTo("POST /api/push/subscribe")).toHaveLength(1)
    );
    expect(subscribeThisDevice).toHaveBeenCalledWith(KEY);
    expect(api.callsTo("POST /api/push/subscribe")[0].body).toMatchObject({
      endpoint: ENDPOINT,
      keys: { auth: "authkey", p256dh: "p256dhkey" },
    });
    expect(
      await screen.findByRole("button", {
        name: "Disable browser notifications",
      })
    ).toBeInTheDocument();
    expect(screen.getByText("This device")).toBeInTheDocument();
  });

  it("shows the reason when permission is refused", async () => {
    vi.mocked(subscribeThisDevice).mockRejectedValue(
      new Error("not a user-facing error")
    );
    await renderWithProviders(<PushOptInCard />, {
      handlers: handlers(ENABLED).handlers,
    });

    await userEvent.click(
      await screen.findByRole("button", {
        name: "Enable browser notifications",
      })
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not change browser notifications"
    );
  });

  it("disables this device: tells the server, then the browser", async () => {
    environment({ permission: "granted" });
    const subscription = fakeSubscription();
    vi.mocked(currentSubscription).mockResolvedValue(
      subscription as unknown as PushSubscription
    );
    const { api } = await renderWithProviders(<PushOptInCard />, {
      handlers: handlers(ENABLED, [
        makeDevice({ endpointTail: endpointTail(ENDPOINT) }),
      ]).handlers,
    });

    await userEvent.click(
      await screen.findByRole("button", {
        name: "Disable browser notifications",
      })
    );

    await waitFor(() =>
      expect(api.callsTo("POST /api/push/unsubscribe")[0]?.body).toEqual({
        endpoint: ENDPOINT,
      })
    );
    await waitFor(() => expect(subscription.unsubscribe).toHaveBeenCalled());
    expect(
      await screen.findByRole("button", {
        name: "Enable browser notifications",
      })
    ).toBeInTheDocument();
  });

  it("lists the user's devices and removes one", async () => {
    environment({ permission: "granted" });
    const other = makeDevice({
      id: "dev-other",
      userAgent: "Mozilla/5.0 (iPhone) Safari/604.1",
    });
    const { api } = await renderWithProviders(<PushOptInCard />, {
      handlers: handlers(ENABLED, [other]).handlers,
    });

    const heading = await screen.findByRole("heading", {
      name: "Your devices",
    });
    const list = heading.parentElement as HTMLElement;
    expect(within(list).getByText("Safari on iPhone")).toBeInTheDocument();

    await userEvent.click(
      within(list).getByRole("button", { name: "Remove Safari on iPhone" })
    );

    await waitFor(() =>
      expect(
        api.callsTo("DELETE /api/push/subscriptions/:id")[0]?.params.id
      ).toBe("dev-other")
    );
  });
});
