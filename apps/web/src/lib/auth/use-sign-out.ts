import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { toast } from "sonner";

import { errorMessage, isApiError } from "@/lib/api/errors";

import { type LogoutVariables, logoutMutation } from "./queries";

export interface SignOut {
  isPending: boolean;
  /** Ends this session (or every session with `{ everywhere: true }`) and returns to /login. */
  signOut: (options?: LogoutVariables) => Promise<void>;
}

/**
 * Sign-out for components. Order matters: the server forgets the session, THEN
 * the app navigates to /login (which unmounts the layout), and only THEN is the
 * cache cleared — clearing while the layout is still mounted would refetch
 * everything into a wall of 401s, and a stale `me` would bounce /login back home.
 */
export function useSignOut(): SignOut {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { isPending, mutateAsync } = useMutation(logoutMutation());

  const signOut = useCallback(
    async (options?: LogoutVariables) => {
      try {
        await mutateAsync(options);
      } catch (error) {
        // A 401 means the session was already gone: the goal is met.
        if (!(isApiError(error) && error.code === "unauthenticated")) {
          toast.error(errorMessage(error, "Couldn't sign out. Try again."));
          return;
        }
      }
      await navigate({ replace: true, to: "/login" });
      queryClient.removeQueries();
    },
    [mutateAsync, navigate, queryClient]
  );

  return { isPending, signOut };
}
