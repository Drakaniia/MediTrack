import { useRouter } from "@tanstack/react-router";
import { useCallback } from "react";

/** Where "Register this code" goes. The add-stock page may ignore `code`; that is fine. */
export function registerPathFor(code: string): string {
  return `/inventory/add?code=${encodeURIComponent(code)}`;
}

export function useRegisterCode(): (code: string) => void {
  const router = useRouter();
  return useCallback(
    (code: string) => {
      router.history.push(registerPathFor(code));
    },
    [router]
  );
}
