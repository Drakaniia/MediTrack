import { Button } from "@cmis/ui/components/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import {
  type FormEvent,
  type ReactElement,
  useCallback,
  useId,
  useState,
} from "react";

import {
  AuthField,
  AuthShell,
  FormError,
} from "@/features/shell/components/auth-shell";
import { isApiError } from "@/lib/api/errors";
import { loginMutation } from "@/lib/auth/queries";
import { redirectSearch } from "@/lib/auth/redirect";

export const INVALID_LOGIN_MESSAGE = "Incorrect username or password.";
const OFFER_RETRY_MESSAGE = "Something went wrong signing you in. Try again.";

/** What the sign-in form shows for a failed attempt. Deliberately says nothing about WHICH part was wrong. */
export function loginErrorMessage(error: unknown): string {
  if (!isApiError(error)) {
    return OFFER_RETRY_MESSAGE;
  }
  switch (error.code) {
    case "invalid_credentials":
    case "unauthenticated":
      return INVALID_LOGIN_MESSAGE;
    case "rate_limited": {
      const seconds = error.retryAfterSeconds;
      return seconds
        ? `Too many sign-in attempts. Try again in ${seconds} ${seconds === 1 ? "second" : "seconds"}.`
        : "Too many sign-in attempts. Wait a moment and try again.";
    }
    case "network_error":
      return error.message;
    default:
      return OFFER_RETRY_MESSAGE;
  }
}

/** Where to go once signed in: the page they came from, or /change-password first when the account requires it. */
export function hrefAfterSignIn(
  mustChangePassword: boolean,
  redirectTo: string | undefined
): string {
  if (mustChangePassword) {
    const { redirect } = redirectSearch(redirectTo);
    return redirect
      ? `/change-password?redirect=${encodeURIComponent(redirect)}`
      : "/change-password";
  }
  return redirectSearch(redirectTo).redirect ?? "/";
}

export function LoginPage({
  redirectTo,
}: {
  redirectTo?: string;
}): ReactElement {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { error, isPending, mutateAsync, reset } = useMutation(
    loginMutation(queryClient)
  );
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const identifierId = useId();
  const passwordId = useId();

  const identifierMissing = submitted && identifier.trim() === "";
  const passwordMissing = submitted && password === "";

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      setSubmitted(true);
      if (identifier.trim() === "" || password === "") {
        return;
      }
      reset();
      try {
        const me = await mutateAsync({
          identifier: identifier.trim(),
          password,
        });
        router.history.push(
          hrefAfterSignIn(me.user.mustChangePassword, redirectTo)
        );
      } catch {
        // `error` (from the mutation) renders below; the password is not kept.
        setPassword("");
      }
    },
    [identifier, mutateAsync, password, redirectTo, reset, router]
  );

  return (
    <AuthShell
      description="Use the account your administrator gave you."
      title="Sign in to MediTract"
    >
      <form
        aria-busy={isPending}
        className="space-y-4"
        noValidate
        onSubmit={handleSubmit}
      >
        {error ? <FormError>{loginErrorMessage(error)}</FormError> : null}
        <AuthField
          autoCapitalize="none"
          autoComplete="username"
          autoCorrect="off"
          error={
            identifierMissing ? "Enter your username or email." : undefined
          }
          id={identifierId}
          label="Username or email"
          onValueChange={setIdentifier}
          spellCheck={false}
          value={identifier}
        />
        <AuthField
          autoComplete="current-password"
          error={passwordMissing ? "Enter your password." : undefined}
          id={passwordId}
          label="Password"
          onValueChange={setPassword}
          type="password"
          value={password}
        />
        <Button
          className="tap-target h-10 w-full md:h-9"
          disabled={isPending}
          type="submit"
        >
          {isPending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthShell>
  );
}
