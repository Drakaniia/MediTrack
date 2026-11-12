import { Button } from "@cmis/ui/components/button";
import { localDateOf } from "@shared/dates";
import type { UserDto } from "@shared/schemas/users";
import { Ban, CircleCheck } from "lucide-react";
import type { ReactElement } from "react";

import { formatDate, formatDateTime } from "@/lib/format";

import { RoleBadge } from "./role-badge";

export interface UsersTableProps {
  currentUserId: string;
  onEdit: (user: UserDto) => void;
  onReset: (user: UserDto) => void;
  onToggle: (user: UserDto) => void;
  timezone: string;
  users: readonly UserDto[];
}

function StatusCell({ user }: { user: UserDto }): ReactElement {
  const Icon = user.disabled ? Ban : CircleCheck;
  return (
    <div className="grid gap-0.5">
      <span className="inline-flex items-center gap-1 whitespace-nowrap">
        <Icon aria-hidden className="size-3.5 shrink-0" />
        {user.disabled ? "Disabled" : "Active"}
      </span>
      {user.mustChangePassword ? (
        <span className="text-muted-foreground text-xs">
          Must change password
        </span>
      ) : null}
    </div>
  );
}

function RowActions({
  isSelf,
  onEdit,
  onReset,
  onToggle,
  user,
}: {
  isSelf: boolean;
  onEdit: (user: UserDto) => void;
  onReset: (user: UserDto) => void;
  onToggle: (user: UserDto) => void;
  user: UserDto;
}): ReactElement {
  return (
    <div className="flex flex-wrap justify-end gap-1">
      <Button
        aria-label={`Edit ${user.displayName}`}
        onClick={() => onEdit(user)}
        size="sm"
        variant="outline"
      >
        Edit
      </Button>
      {isSelf ? null : (
        <>
          <Button
            aria-label={`Reset password for ${user.displayName}`}
            onClick={() => onReset(user)}
            size="sm"
            variant="outline"
          >
            Reset password
          </Button>
          <Button
            aria-label={`${user.disabled ? "Enable" : "Disable"} ${user.displayName}`}
            onClick={() => onToggle(user)}
            size="sm"
            variant={user.disabled ? "outline" : "destructive"}
          >
            {user.disabled ? "Enable" : "Disable"}
          </Button>
        </>
      )}
    </div>
  );
}

/** The user list. Email and "created" drop out on narrow screens; the edit dialog still has them. */
export function UsersTable({
  currentUserId,
  onEdit,
  onReset,
  onToggle,
  timezone,
  users,
}: UsersTableProps): ReactElement {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
        <caption className="sr-only">User accounts</caption>
        <thead className="bg-muted/50 text-muted-foreground text-xs">
          <tr>
            <th className="px-3 py-2 font-medium" scope="col">
              Name
            </th>
            <th className="px-3 py-2 font-medium" scope="col">
              Username
            </th>
            <th
              className="hidden px-3 py-2 font-medium lg:table-cell"
              scope="col"
            >
              Email
            </th>
            <th className="px-3 py-2 font-medium" scope="col">
              Role
            </th>
            <th className="px-3 py-2 font-medium" scope="col">
              Status
            </th>
            <th
              className="hidden px-3 py-2 font-medium md:table-cell"
              scope="col"
            >
              Last login
            </th>
            <th
              className="hidden px-3 py-2 font-medium xl:table-cell"
              scope="col"
            >
              Created
            </th>
            <th className="px-3 py-2 text-right font-medium" scope="col">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => {
            const isSelf = user.id === currentUserId;
            return (
              <tr className="border-t align-top" key={user.id}>
                <td className="px-3 py-2 font-medium">
                  {user.displayName}
                  {isSelf ? (
                    <span className="ml-2 rounded-full bg-primary/10 px-1.5 py-0.5 font-medium text-primary text-xs">
                      You
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2 font-mono text-xs">{user.username}</td>
                <td className="hidden px-3 py-2 lg:table-cell">
                  {user.email ?? "—"}
                </td>
                <td className="px-3 py-2">
                  <RoleBadge role={user.role} />
                </td>
                <td className="px-3 py-2">
                  <StatusCell user={user} />
                </td>
                <td className="hidden px-3 py-2 md:table-cell">
                  {user.lastLoginAt
                    ? formatDateTime(user.lastLoginAt, timezone)
                    : "Never"}
                </td>
                <td className="hidden px-3 py-2 xl:table-cell">
                  {formatDate(localDateOf(user.createdAt, timezone))}
                </td>
                <td className="px-3 py-2">
                  <RowActions
                    isSelf={isSelf}
                    onEdit={onEdit}
                    onReset={onReset}
                    onToggle={onToggle}
                    user={user}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
