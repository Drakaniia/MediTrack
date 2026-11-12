import { Button } from "@cmis/ui/components/button";
import { MIN_PASSWORD_LENGTH, passwordSchema } from "@shared/session";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import {
  type FormEvent,
  type ReactElement,
  useCallback,
  useId,
  useState,
} from "react";
import { toast } from "sonner";

import {
  AuthField,
  AuthShell,
  FormError,
} from "@/features/shell/components/auth-shell";
import { errorMessage, fieldErrors, isApiError } from "@/lib/api/errors";
import { changePasswordMutation, useCachedMe } from "@/lib/auth/queries";
import { redirectSearch } from "@/lib/auth/redirect";
import { useSignOut } from "@/lib/auth/use-sign-out";

interface FormValues {
  confirmPassword: string;
  currentPassword: string;
  newPassword: string;
}

type FormErrors = Partial<Record<keyof FormValues, string>>;

const EMPTY_VALUES: FormValues = {
  confirmPassword: "",
  currentPassword: "",
  newPassword: "",
};

/** Client-side checks, run on submit only (spec §7.4: no errors while typing). */
export function validatePasswordForm(values: FormValues): FormErrors {
  const errors: FormErrors = {};
  if (values.currentPassword === "") {
    errors.currentPassword = "Enter your current password.";
  }
  const strength = passwordSchema.safeParse(values.newPassword);
  if (!strength.success) {
    errors.newPassword =
      values.newPassword === ""
        ? "Enter a new password."
        : (strength.error.issues[0]?.message ?? "Choose a different password.");
  } else if (values.newPassword === values.currentPassword) {
    errors.newPassword = "Choose a password you haven't used before.";
  }
  if (values.confirmPassword !== values.newPassword) {
    errors.confirmPassword = "The passwords don't match.";
  }
  return errors;
}

/** Maps a server rejection onto the field it is about (or a form-level message). */
function serverErrors(error: unknown): { fields: FormErrors; form?: string } {
  if (isApiError(error) && error.code === "invalid_credentials") {
    return {
      fields: { currentPassword: "Your current password is incorrect." },
    };
  }
  const byField = fieldErrors(error);
  const fields: FormErrors = {};
  if (byField.newPassword) {
    fields.newPassword = byField.newPassword;
  }
  if (byField.currentPassword) {
    fields.currentPassword = byField.currentPassword;
  }
  if (Object.keys(fields).length > 0) {
    return { fields };
  }
  return {
    fields: {},
    form: errorMessage(error, "Couldn't change your password. Try again."),
  };
}

export function ChangePasswordPage({
  redirectTo,
}: {
  redirectTo?: string;
}): ReactElement {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { data: me } = useCachedMe();
  const { signOut } = useSignOut();
  const { isPending, mutateAsync } = useMutation(
    changePasswordMutation(queryClient)
  );
  const [values, setValues] = useState<FormValues>(EMPTY_VALUES);
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string | undefined>();
  const currentId = useId();
  const newId = useId();
  const confirmId = useId();

  const mustChange = me?.user.mustChangePassword ?? false;

  const setCurrent = useCallback(
    (value: string) =>
      setValues((previous) => ({ ...previous, currentPassword: value })),
    []
  );
  const setNew = useCallback(
    (value: string) =>
      setValues((previous) => ({ ...previous, newPassword: value })),
    []
  );
  const setConfirm = useCallback(
    (value: string) =>
      setValues((previous) => ({ ...previous, confirmPassword: value })),
    []
  );

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      setFormError(undefined);
      const problems = validatePasswordForm(values);
      setErrors(problems);
      if (Object.keys(problems).length > 0) {
        return;
      }
      try {
        await mutateAsync({
          currentPassword: values.currentPassword,
          newPassword: values.newPassword,
        });
      } catch (error) {
        const { fields, form } = serverErrors(error);
        setErrors(fields);
        setFormError(form);
        return;
      }
      toast.success("Password changed.");
      router.history.push(redirectSearch(redirectTo).redirect ?? "/");
    },
    [mutateAsync, redirectTo, router, values]
  );

  const handleLeave = useCallback(() => {
    if (mustChange) {
      signOut();
      return;
    }
    router.history.back();
  }, [mustChange, router, signOut]);

  return (
    <AuthShell
      description={
        mustChange
          ? "You need to choose a new password before you continue."
          : "Choose a new password for your account."
      }
      title="Change password"
    >
      <form
        aria-busy={isPending}
        className="space-y-4"
        noValidate
        onSubmit={handleSubmit}
      >
        {formError ? <FormError>{formError}</FormError> : null}
        <AuthField
          autoComplete="current-password"
          error={errors.currentPassword}
          id={currentId}
          label="Current password"
          onValueChange={setCurrent}
          type="password"
          value={values.currentPassword}
        />
        <AuthField
          autoComplete="new-password"
          error={errors.newPassword}
          hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
          id={newId}
          label="New password"
          onValueChange={setNew}
          type="password"
          value={values.newPassword}
        />
        <AuthField
          autoComplete="new-password"
          error={errors.confirmPassword}
          id={confirmId}
          label="Confirm new password"
          onValueChange={setConfirm}
          type="password"
          value={values.confirmPassword}
        />
        <Button
          className="tap-target h-10 w-full md:h-9"
          disabled={isPending}
          type="submit"
        >
          {isPending ? "Saving…" : "Change password"}
        </Button>
      </form>
      <Button
        className="tap-target w-full"
        onClick={handleLeave}
        type="button"
        variant="ghost"
      >
        {mustChange ? "Log out instead" : "Cancel"}
      </Button>
    </AuthShell>
  );
}
