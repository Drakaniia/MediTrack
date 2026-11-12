import type { TemporaryPasswordResponse, UserDto } from "@shared/schemas/users";
import { type ReactElement, useCallback, useState } from "react";
import { toast } from "sonner";

import { errorMessage } from "@/lib/api/errors";

import {
  useResetUserPassword,
  useSetUserDisabled,
} from "../hooks/user-queries";
import { ConfirmDialog } from "./confirm-dialog";

/**
 * Disable / enable confirmation. A refusal from the server (yourself, the last
 * active administrator, …) is shown inside the dialog, which stays open.
 */
export function ToggleUserDialog({
  onClose,
  user,
}: {
  onClose: () => void;
  user: UserDto;
}): ReactElement {
  const disabling = !user.disabled;
  const mutation = useSetUserDisabled();
  const [error, setError] = useState<string | undefined>();

  const handleConfirm = useCallback(async () => {
    setError(undefined);
    try {
      await mutation.mutateAsync({ disabled: disabling, id: user.id });
      toast.success(
        disabling ? `Disabled ${user.username}.` : `Enabled ${user.username}.`
      );
      onClose();
    } catch (failure) {
      setError(
        errorMessage(
          failure,
          disabling
            ? "Couldn't disable the account."
            : "Couldn't enable the account."
        )
      );
    }
  }, [disabling, mutation, onClose, user.id, user.username]);

  return (
    <ConfirmDialog
      confirmLabel={disabling ? "Disable account" : "Enable account"}
      description={
        disabling
          ? `${user.displayName} (${user.username}) will be signed out and won't be able to sign in until the account is enabled again. Their history stays in the audit log.`
          : `${user.displayName} (${user.username}) will be able to sign in again.`
      }
      destructive={disabling}
      error={error}
      onCancel={onClose}
      onConfirm={handleConfirm}
      pending={mutation.isPending}
      title={
        disabling ? `Disable ${user.username}?` : `Enable ${user.username}?`
      }
    />
  );
}

/** Reset-password confirmation; on success the one-time password is handed to `onReset`. */
export function ResetPasswordDialog({
  onClose,
  onReset,
  user,
}: {
  onClose: () => void;
  onReset: (result: TemporaryPasswordResponse) => void;
  user: UserDto;
}): ReactElement {
  const mutation = useResetUserPassword();
  const [error, setError] = useState<string | undefined>();

  const handleConfirm = useCallback(async () => {
    setError(undefined);
    try {
      onReset(await mutation.mutateAsync(user.id));
    } catch (failure) {
      setError(errorMessage(failure, "Couldn't reset the password."));
    }
  }, [mutation, onReset, user.id]);

  return (
    <ConfirmDialog
      confirmLabel="Reset password"
      description={`${user.displayName} (${user.username}) will be signed out everywhere and given a new temporary password, which you will see once. Their old password stops working immediately.`}
      destructive
      error={error}
      onCancel={onClose}
      onConfirm={handleConfirm}
      pending={mutation.isPending}
      title={`Reset password for ${user.username}?`}
    />
  );
}
