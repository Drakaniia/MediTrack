import { Button } from "@cmis/ui/components/button";
import { Input } from "@cmis/ui/components/input";
import { ROLE_LABELS, ROLES, type Role } from "@shared/roles";
import type { TemporaryPasswordResponse, UserDto } from "@shared/schemas/users";
import { Plus, Search, Users } from "lucide-react";
import { type ReactElement, useCallback, useState } from "react";

import { DataState } from "@/components/data-state";
import { PageHeader } from "@/components/page-header";
import { useFacility } from "@/lib/auth/guards";
import { useCachedMe } from "@/lib/auth/queries";

import { useDebouncedValue } from "../hooks/use-debounced-value";
import {
  EMPTY_USER_FILTERS,
  type UserFilters,
  useUsers,
} from "../hooks/user-queries";
import { SelectField } from "./form-controls";
import {
  type TemporaryPasswordContext,
  TemporaryPasswordDialog,
} from "./temporary-password-dialog";
import { ResetPasswordDialog, ToggleUserDialog } from "./user-action-dialogs";
import { UserFormDialog } from "./user-form-dialog";
import { UsersTable } from "./users-table";

type DialogState =
  | { kind: "create" }
  | { kind: "edit"; user: UserDto }
  | {
      kind: "password";
      context: TemporaryPasswordContext;
      result: TemporaryPasswordResponse;
    }
  | { kind: "reset"; user: UserDto }
  | { kind: "toggle"; user: UserDto };

const ROLE_FILTER_OPTIONS = [
  { label: "All roles", value: "" },
  ...ROLES.map((role) => ({ label: ROLE_LABELS[role], value: role })),
];

const STATUS_FILTER_OPTIONS = [
  { label: "All statuses", value: "" },
  { label: "Active", value: "active" },
  { label: "Disabled", value: "disabled" },
];

function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

function UserDialogs({
  dialog,
  onClose,
  onOpen,
}: {
  dialog: DialogState | null;
  onClose: () => void;
  onOpen: (next: DialogState) => void;
}): ReactElement | null {
  switch (dialog?.kind) {
    case "create":
      return (
        <UserFormDialog
          mode={dialog}
          onClose={onClose}
          onCreated={(result) =>
            onOpen({ context: "created", kind: "password", result })
          }
        />
      );
    case "edit":
      return (
        <UserFormDialog
          mode={dialog}
          onClose={onClose}
          onCreated={() => undefined}
        />
      );
    case "toggle":
      return <ToggleUserDialog onClose={onClose} user={dialog.user} />;
    case "reset":
      return (
        <ResetPasswordDialog
          onClose={onClose}
          onReset={(result) =>
            onOpen({ context: "reset", kind: "password", result })
          }
          user={dialog.user}
        />
      );
    case "password":
      return (
        <TemporaryPasswordDialog
          context={dialog.context}
          onClose={onClose}
          result={dialog.result}
        />
      );
    default:
      return null;
  }
}

/** `/users` (admin): accounts, roles, disable / enable, password resets. */
export function UsersPage(): ReactElement {
  const { timezone } = useFacility();
  const { data: me } = useCachedMe();
  const [filters, setFilters] = useState<UserFilters>(EMPTY_USER_FILTERS);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const debouncedQ = useDebouncedValue(filters.q);
  const query = useUsers({ ...filters, q: debouncedQ });

  const closeDialog = useCallback(() => setDialog(null), []);
  const users = query.data?.users ?? [];
  const filtered =
    filters.q.trim() !== "" || filters.role !== "" || filters.status !== "";

  return (
    <div>
      <PageHeader
        actions={
          <Button onClick={() => setDialog({ kind: "create" })}>
            <Plus aria-hidden />
            Add user
          </Button>
        }
        description="Accounts are never deleted. Disable one to block sign-in and keep its history."
        title="Users"
      />
      <search
        aria-label="Filter users"
        className="grid gap-3 pb-4 sm:grid-cols-[1fr_12rem_10rem]"
      >
        <div className="relative self-end">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground"
          />
          <Input
            aria-label="Search users"
            className="h-9 pl-8"
            onChange={(event) =>
              setFilters((previous) => ({ ...previous, q: event.target.value }))
            }
            placeholder="Search name, username or email"
            type="search"
            value={filters.q}
          />
        </div>
        <SelectField
          label="Role"
          onValueChange={(role) =>
            setFilters((previous) => ({
              ...previous,
              role: isRole(role) ? role : "",
            }))
          }
          options={ROLE_FILTER_OPTIONS}
          value={filters.role}
        />
        <SelectField
          label="Status"
          onValueChange={(status) =>
            setFilters((previous) => ({
              ...previous,
              status:
                status === "active" || status === "disabled" ? status : "",
            }))
          }
          options={STATUS_FILTER_OPTIONS}
          value={filters.status}
        />
      </search>
      <DataState
        empty={{
          action: filtered ? (
            <Button
              onClick={() => setFilters(EMPTY_USER_FILTERS)}
              variant="outline"
            >
              Clear filters
            </Button>
          ) : undefined,
          description: filtered
            ? "No account matches these filters."
            : "Add the first account to get started.",
          icon: Users,
          title: filtered ? "No users found" : "No users yet",
        }}
        error={query.error}
        isEmpty={users.length === 0}
        isLoading={query.isPending}
        onRetry={() => query.refetch()}
      >
        <UsersTable
          currentUserId={me?.user.id ?? ""}
          onEdit={(user) => setDialog({ kind: "edit", user })}
          onReset={(user) => setDialog({ kind: "reset", user })}
          onToggle={(user) => setDialog({ kind: "toggle", user })}
          timezone={timezone}
          users={users}
        />
        <p aria-live="polite" className="pt-2 text-muted-foreground text-xs">
          {query.data && query.data.total > users.length
            ? `Showing the first ${users.length} of ${query.data.total} accounts. Narrow the search to find the rest.`
            : `${users.length} ${users.length === 1 ? "account" : "accounts"}`}
        </p>
      </DataState>
      <UserDialogs dialog={dialog} onClose={closeDialog} onOpen={setDialog} />
    </div>
  );
}
