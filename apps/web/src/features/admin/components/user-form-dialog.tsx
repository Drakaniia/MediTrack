import { Button } from "@cmis/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@cmis/ui/components/dialog";
import {
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  ROLES,
  type Role,
} from "@shared/roles";
import {
  createUserInputSchema,
  type TemporaryPasswordResponse,
  type UserDto,
  updateUserInputSchema,
} from "@shared/schemas/users";
import { MIN_PASSWORD_LENGTH } from "@shared/session";
import {
  type FormEvent,
  type ReactElement,
  useCallback,
  useState,
} from "react";
import { toast } from "sonner";
import type { z } from "zod";

import {
  type CreateUserBody,
  type UpdateUserBody,
  useCreateUser,
  useUpdateUser,
} from "../hooks/user-queries";
import { serverFormErrors } from "../lib/form-errors";
import { FormAlert, SelectField, TextField } from "./form-controls";

export type UserFormMode = { kind: "create" } | { kind: "edit"; user: UserDto };

export interface UserFormDialogProps {
  mode: UserFormMode;
  onClose: () => void;
  /** Called with the new account and its one-time password. */
  onCreated: (result: TemporaryPasswordResponse) => void;
}

interface FormValues {
  displayName: string;
  email: string;
  role: Role;
  temporaryPassword: string;
  username: string;
}

type FormErrors = Record<string, string>;

const ROLE_OPTIONS = ROLES.map((role) => ({
  label: ROLE_LABELS[role],
  value: role,
}));

const DEFAULT_ROLE: Role = "nurse";

function initialValues(mode: UserFormMode): FormValues {
  if (mode.kind === "edit") {
    const { user } = mode;
    return {
      displayName: user.displayName,
      email: user.email ?? "",
      role: user.role,
      temporaryPassword: "",
      username: user.username,
    };
  }
  return {
    displayName: "",
    email: "",
    role: DEFAULT_ROLE,
    temporaryPassword: "",
    username: "",
  };
}

function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/** The first message per field of a failed zod parse. */
function zodErrors(error: z.ZodError): FormErrors {
  const errors: FormErrors = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "");
    if (field !== "" && !(field in errors)) {
      errors[field] = issue.message;
    }
  }
  return errors;
}

function changesFor(user: UserDto, values: FormValues): UpdateUserBody {
  const patch: UpdateUserBody = {};
  if (values.displayName.trim() !== user.displayName) {
    patch.displayName = values.displayName;
  }
  const email = values.email.trim();
  if (email !== (user.email ?? "")) {
    patch.email = email === "" ? null : email;
  }
  if (values.role !== user.role) {
    patch.role = values.role;
  }
  return patch;
}

function createBody(
  data: z.output<typeof createUserInputSchema>
): CreateUserBody {
  const body: CreateUserBody = {
    displayName: data.displayName,
    role: data.role,
    username: data.username,
  };
  if (data.email) {
    body.email = data.email;
  }
  if (data.temporaryPassword) {
    body.temporaryPassword = data.temporaryPassword;
  }
  return body;
}

function submitLabel(pending: boolean, editing: boolean): string {
  if (pending) {
    return "Saving…";
  }
  return editing ? "Save changes" : "Create user";
}

/** Add-user and edit-user form. Errors appear after "Save", not while typing (spec §7.4). */
export function UserFormDialog({
  mode,
  onClose,
  onCreated,
}: UserFormDialogProps): ReactElement {
  const editing = mode.kind === "edit";
  const [values, setValues] = useState<FormValues>(() => initialValues(mode));
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string | undefined>();
  const create = useCreateUser();
  const update = useUpdateUser();
  const pending = create.isPending || update.isPending;

  const patch = editing ? changesFor(mode.user, values) : {};
  const unchanged = editing && Object.keys(patch).length === 0;

  const setField = useCallback(
    (field: keyof FormValues) => (value: string) =>
      setValues((previous) => ({
        ...previous,
        [field]: field === "role" && !isRole(value) ? previous.role : value,
      })),
    []
  );

  const fail = useCallback((error: unknown, fallback: string) => {
    const { fields, form } = serverFormErrors(error, fallback);
    setErrors(fields);
    setFormError(form);
  }, []);

  const submitCreate = useCallback(async () => {
    const parsed = createUserInputSchema.safeParse({
      displayName: values.displayName,
      email: values.email,
      role: values.role,
      temporaryPassword: values.temporaryPassword,
      username: values.username,
    });
    if (!parsed.success) {
      setErrors(zodErrors(parsed.error));
      return;
    }
    try {
      onCreated(await create.mutateAsync(createBody(parsed.data)));
    } catch (error) {
      fail(error, "Couldn't create the account. Try again.");
    }
  }, [create, fail, onCreated, values]);

  const submitEdit = useCallback(
    async (user: UserDto) => {
      const parsed = updateUserInputSchema.safeParse(patch);
      if (!parsed.success) {
        setErrors(zodErrors(parsed.error));
        return;
      }
      try {
        await update.mutateAsync({ id: user.id, patch });
        toast.success(`Saved ${user.username}.`);
        onClose();
      } catch (error) {
        fail(error, "Couldn't save the changes. Try again.");
      }
    },
    [fail, onClose, patch, update]
  );

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setErrors({});
      setFormError(undefined);
      await (mode.kind === "edit" ? submitEdit(mode.user) : submitCreate());
    },
    [mode, submitCreate, submitEdit]
  );

  return (
    <Dialog onOpenChange={(open) => (open ? undefined : onClose())} open>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit user" : "Add user"}</DialogTitle>
          <DialogDescription>
            {editing
              ? `Change ${mode.user.username}'s name, email or role.`
              : "Create an account. You'll get a temporary password to hand over."}
          </DialogDescription>
        </DialogHeader>
        <form
          aria-busy={pending}
          className="grid gap-4"
          noValidate
          onSubmit={handleSubmit}
        >
          {formError ? <FormAlert>{formError}</FormAlert> : null}
          {editing ? null : (
            <TextField
              autoCapitalize="none"
              autoComplete="off"
              error={errors.username}
              hint="3–40 letters, digits, dots, underscores or hyphens. Not case-sensitive."
              label="Username"
              onValueChange={setField("username")}
              spellCheck={false}
              value={values.username}
            />
          )}
          <TextField
            autoComplete="off"
            error={errors.displayName}
            label="Display name"
            onValueChange={setField("displayName")}
            value={values.displayName}
          />
          <TextField
            autoComplete="off"
            error={errors.email}
            hint="Optional. Can be used to sign in."
            inputMode="email"
            label="Email (optional)"
            onValueChange={setField("email")}
            type="email"
            value={values.email}
          />
          <SelectField
            error={errors.role}
            hint={ROLE_DESCRIPTIONS[values.role]}
            label="Role"
            onValueChange={setField("role")}
            options={ROLE_OPTIONS}
            value={values.role}
          />
          {editing ? null : (
            <TextField
              autoComplete="new-password"
              error={errors.temporaryPassword}
              hint={`Optional. Leave blank to generate one. At least ${MIN_PASSWORD_LENGTH} characters.`}
              label="Temporary password (optional)"
              onValueChange={setField("temporaryPassword")}
              type="password"
              value={values.temporaryPassword}
            />
          )}
          <DialogFooter>
            <Button onClick={onClose} type="button" variant="outline">
              Cancel
            </Button>
            <Button disabled={pending || unchanged} type="submit">
              {submitLabel(pending, editing)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
