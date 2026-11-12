import { Button } from "@cmis/ui/components/button";
import { ROLE_LABELS } from "@shared/roles";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  type FormEvent,
  type ReactElement,
  useCallback,
  useState,
} from "react";
import { toast } from "sonner";

import { isApiError } from "@/lib/api/errors";
import { changePasswordMutation, useCachedMe } from "@/lib/auth/queries";
import { useSignOut } from "@/lib/auth/use-sign-out";
import { serverFormErrors } from "../lib/form-errors";
import {
  EMPTY_PASSWORD_FORM,
  PASSWORD_HINT,
  type PasswordFormErrors,
  type PasswordFormValues,
  validatePasswordForm,
} from "../lib/password-form";
import { ConfirmDialog } from "./confirm-dialog";
import { FormAlert, SectionCard, TextField } from "./form-controls";

function ProfileCard(): ReactElement | null {
  const { data: me } = useCachedMe();
  if (!me) {
    return null;
  }
  const { user } = me;
  return (
    <SectionCard
      description="Ask a system administrator to change your name, email or role."
      title="Your account"
    >
      <dl className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-0.5">
          <dt className="text-muted-foreground text-xs">Display name</dt>
          <dd className="text-sm">{user.displayName}</dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-muted-foreground text-xs">Username</dt>
          <dd className="font-mono text-sm">{user.username}</dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-muted-foreground text-xs">Role</dt>
          <dd className="text-sm">{ROLE_LABELS[user.role]}</dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-muted-foreground text-xs">Email</dt>
          <dd className="text-sm">{user.email ?? "—"}</dd>
        </div>
      </dl>
    </SectionCard>
  );
}

/** Maps a rejected password change onto its fields. */
function passwordFailure(error: unknown): {
  fields: PasswordFormErrors;
  form?: string;
} {
  if (isApiError(error) && error.code === "invalid_credentials") {
    return {
      fields: { currentPassword: "Your current password is incorrect." },
    };
  }
  const { fields, form } = serverFormErrors(
    error,
    "Couldn't change your password. Try again."
  );
  return {
    fields: {
      currentPassword: fields.currentPassword,
      newPassword: fields.newPassword,
    },
    form,
  };
}

function PasswordCard(): ReactElement {
  const queryClient = useQueryClient();
  const change = useMutation(changePasswordMutation(queryClient));
  const [values, setValues] = useState<PasswordFormValues>(EMPTY_PASSWORD_FORM);
  const [errors, setErrors] = useState<PasswordFormErrors>({});
  const [formError, setFormError] = useState<string | undefined>();

  const setField = useCallback(
    (field: keyof PasswordFormValues) => (value: string) =>
      setValues((previous) => ({ ...previous, [field]: value })),
    []
  );

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setFormError(undefined);
      const problems = validatePasswordForm(values);
      setErrors(problems);
      if (Object.keys(problems).length > 0) {
        return;
      }
      try {
        await change.mutateAsync({
          currentPassword: values.currentPassword,
          newPassword: values.newPassword,
        });
      } catch (error) {
        const failed = passwordFailure(error);
        setErrors(failed.fields);
        setFormError(failed.form);
        return;
      }
      setValues(EMPTY_PASSWORD_FORM);
      toast.success("Password changed.");
    },
    [change, values]
  );

  return (
    <form
      aria-busy={change.isPending}
      className="grid gap-4"
      noValidate
      onSubmit={handleSubmit}
    >
      <SectionCard
        footer={
          <Button disabled={change.isPending} type="submit">
            {change.isPending ? "Saving…" : "Change password"}
          </Button>
        }
        title="Change password"
      >
        {formError ? <FormAlert>{formError}</FormAlert> : null}
        <TextField
          autoComplete="current-password"
          error={errors.currentPassword}
          label="Current password"
          onValueChange={setField("currentPassword")}
          type="password"
          value={values.currentPassword}
        />
        <TextField
          autoComplete="new-password"
          error={errors.newPassword}
          hint={PASSWORD_HINT}
          label="New password"
          onValueChange={setField("newPassword")}
          type="password"
          value={values.newPassword}
        />
        <TextField
          autoComplete="new-password"
          error={errors.confirmPassword}
          label="Confirm new password"
          onValueChange={setField("confirmPassword")}
          type="password"
          value={values.confirmPassword}
        />
      </SectionCard>
    </form>
  );
}

function SessionsCard(): ReactElement {
  const { isPending, signOut } = useSignOut();
  const [confirming, setConfirming] = useState(false);

  const handleConfirm = useCallback(async () => {
    await signOut({ everywhere: true });
    setConfirming(false);
  }, [signOut]);

  return (
    <SectionCard
      description="Signed in on a shared or lost device? End every session of this account, including this one."
      title="Sessions"
    >
      <div>
        <Button
          onClick={() => setConfirming(true)}
          type="button"
          variant="outline"
        >
          Log out everywhere
        </Button>
      </div>
      {confirming ? (
        <ConfirmDialog
          confirmLabel="Log out everywhere"
          description="Every device signed in as you, including this one, will be signed out. You'll need to sign in again."
          destructive
          onCancel={() => setConfirming(false)}
          onConfirm={handleConfirm}
          pending={isPending}
          title="Log out of all devices?"
        />
      ) : null}
    </SectionCard>
  );
}

/** Everyone's own account: who they are, change password, log out everywhere. */
export function AccountTab(): ReactElement {
  return (
    <div className="grid gap-4">
      <ProfileCard />
      <PasswordCard />
      <SessionsCard />
    </div>
  );
}
