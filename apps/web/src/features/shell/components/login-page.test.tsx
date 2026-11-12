import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { failure } from "@/test/mock-api";
import { makeMe, renderWithProviders } from "@/test/render";

import { LoginPage } from "./login-page";

async function signIn(identifier = "nurse.joy", password = "correct horse") {
  await userEvent.type(screen.getByLabelText("Username or email"), identifier);
  await userEvent.type(screen.getByLabelText("Password"), password);
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

function currentHref(router: { state: { location: { href: string } } }) {
  return router.state.location.href;
}

describe("LoginPage", () => {
  it("renders labelled fields and a sign-in button", async () => {
    await renderWithProviders(<LoginPage />, { me: null, route: "/login" });

    expect(
      screen.getByRole("heading", { name: "Sign in to MediTract" })
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Username or email")).toHaveAttribute(
      "autocomplete",
      "username"
    );
    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "type",
      "password"
    );
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  it("shows field errors only after submitting, and sends nothing", async () => {
    const { api } = await renderWithProviders(<LoginPage />, {
      me: null,
      route: "/login",
    });
    expect(screen.queryByText("Enter your password.")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      screen.getByText("Enter your username or email.")
    ).toBeInTheDocument();
    expect(screen.getByText("Enter your password.")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "aria-invalid",
      "true"
    );
    expect(api.calls).toHaveLength(0);
  });

  it("signs in, caches the user and goes home", async () => {
    const me = makeMe("nurse");
    const { api, queryClient, router } = await renderWithProviders(
      <LoginPage />,
      {
        handlers: { "POST /api/auth/login": () => me },
        me: null,
        route: "/login",
      }
    );

    await signIn("  nurse.joy  ", "correct horse");

    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(api.callsTo("POST /api/auth/login")[0]?.body).toEqual({
      identifier: "nurse.joy",
      password: "correct horse",
    });
    expect(queryClient.getQueryData(["auth", "me"])).toEqual(me);
  });

  it("returns to the page the visitor came from (?redirect=)", async () => {
    const { router } = await renderWithProviders(
      <LoginPage redirectTo="/inventory?tab=expiry" />,
      {
        handlers: { "POST /api/auth/login": () => makeMe("pharmacist") },
        me: null,
        route: "/login",
      }
    );

    await signIn();

    await waitFor(() =>
      expect(currentHref(router)).toBe("/inventory?tab=expiry")
    );
  });

  it("never follows an off-site redirect", async () => {
    const { router } = await renderWithProviders(
      <LoginPage redirectTo="//evil.example" />,
      {
        handlers: { "POST /api/auth/login": () => makeMe("admin") },
        me: null,
        route: "/login",
      }
    );

    await signIn();

    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  });

  it("goes to /change-password first when the account must change its password", async () => {
    const { router } = await renderWithProviders(
      <LoginPage redirectTo="/requests" />,
      {
        handlers: {
          "POST /api/auth/login": () =>
            makeMe("nurse", { user: { mustChangePassword: true } }),
        },
        me: null,
        route: "/login",
      }
    );

    await signIn();

    await waitFor(() =>
      expect(currentHref(router)).toBe("/change-password?redirect=%2Frequests")
    );
  });

  it("shows one generic error for bad credentials and clears the password", async () => {
    await renderWithProviders(<LoginPage />, {
      handlers: {
        "POST /api/auth/login": () =>
          failure(401, "invalid_credentials", "No such user or wrong password"),
      },
      me: null,
      route: "/login",
    });

    await signIn("ghost", "whatever");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Incorrect username or password."
    );
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.getByLabelText("Username or email")).toHaveValue("ghost");
  });

  it("tells a rate-limited visitor how many seconds to wait", async () => {
    await renderWithProviders(<LoginPage />, {
      handlers: {
        "POST /api/auth/login": () =>
          failure(429, "rate_limited", "Too many attempts", {
            retryAfterSeconds: 42,
          }),
      },
      me: null,
      route: "/login",
    });

    await signIn();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many sign-in attempts. Try again in 42 seconds."
    );
  });

  it("uses the Retry-After header when the body has no seconds", async () => {
    await renderWithProviders(<LoginPage />, {
      handlers: {
        "POST /api/auth/login": () =>
          failure(429, "rate_limited", "Too many attempts", undefined, {
            "retry-after": "1",
          }),
      },
      me: null,
      route: "/login",
    });

    await signIn();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Try again in 1 second."
    );
  });

  it("disables the button and says so while the request is pending", async () => {
    let release: (value: unknown) => void = () => undefined;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    await renderWithProviders(<LoginPage />, {
      handlers: { "POST /api/auth/login": () => pending },
      me: null,
      route: "/login",
    });

    await signIn();

    const button = await screen.findByRole("button", { name: "Signing in…" });
    expect(button).toBeDisabled();

    release(makeMe("nurse"));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Signing in…" })
      ).not.toBeInTheDocument()
    );
  });

  it("reports a network failure with the client's own message", async () => {
    await renderWithProviders(<LoginPage />, { me: null, route: "/login" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch"))
    );

    await signIn();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Can't reach the server"
    );
  });
});
