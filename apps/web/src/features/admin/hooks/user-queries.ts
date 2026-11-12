import { MAX_PAGE_SIZE } from "@shared/api";
import type { Role } from "@shared/roles";
import type {
  TemporaryPasswordResponse,
  UserDto,
  UserStatus,
} from "@shared/schemas/users";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { apiGetPage, apiPatch, apiPost } from "@/lib/api/client";

export interface UserFilters {
  q: string;
  role: Role | "";
  status: UserStatus | "";
}

export const EMPTY_USER_FILTERS: UserFilters = { q: "", role: "", status: "" };

export interface CreateUserBody {
  displayName: string;
  email?: string;
  role: Role;
  temporaryPassword?: string;
  username: string;
}

export interface UpdateUserBody {
  displayName?: string;
  /** `null` removes the email address. */
  email?: string | null;
  role?: Role;
}

export const userKeys = {
  actors: ["users", "actors"] as const,
  all: ["users"] as const,
  list: (filters: UserFilters) => ["users", "list", filters] as const,
};

export interface UserList {
  total: number;
  users: UserDto[];
}

export function useUsers(filters: UserFilters) {
  return useQuery({
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }): Promise<UserList> => {
      const { data, meta } = await apiGetPage<UserDto[]>(
        "/users",
        {
          limit: MAX_PAGE_SIZE,
          q: filters.q.trim(),
          role: filters.role,
          status: filters.status,
        },
        { signal }
      );
      return { total: meta.total ?? data.length, users: data };
    },
    queryKey: userKeys.list(filters),
  });
}

function useRefreshUsers(): () => Promise<void> {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: userKeys.all }),
      queryClient.invalidateQueries({ queryKey: ["audit"] }),
    ]);
  };
}

export function useCreateUser() {
  const refresh = useRefreshUsers();
  return useMutation({
    mutationFn: (body: CreateUserBody) =>
      apiPost<TemporaryPasswordResponse>("/users", body),
    onSuccess: refresh,
  });
}

export function useUpdateUser() {
  const refresh = useRefreshUsers();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateUserBody }) =>
      apiPatch<UserDto>(`/users/${encodeURIComponent(id)}`, patch),
    onSuccess: refresh,
  });
}

export function useSetUserDisabled() {
  const refresh = useRefreshUsers();
  return useMutation({
    mutationFn: ({ disabled, id }: { disabled: boolean; id: string }) =>
      apiPost<UserDto>(
        `/users/${encodeURIComponent(id)}/${disabled ? "disable" : "enable"}`
      ),
    onSuccess: refresh,
  });
}

export function useResetUserPassword() {
  const refresh = useRefreshUsers();
  return useMutation({
    mutationFn: (id: string) =>
      apiPost<TemporaryPasswordResponse>(
        `/users/${encodeURIComponent(id)}/reset-password`
      ),
    onSuccess: refresh,
  });
}

/** Everyone who can appear as an audit actor (admin only: `GET /users` needs `users.manage`). */
export function useUserOptions(enabled: boolean) {
  return useQuery({
    enabled,
    queryFn: async ({ signal }) => {
      const { data } = await apiGetPage<UserDto[]>(
        "/users",
        { limit: MAX_PAGE_SIZE },
        { signal }
      );
      return data;
    },
    queryKey: userKeys.actors,
    staleTime: 60_000,
  });
}
