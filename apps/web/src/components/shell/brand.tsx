import type { ReactElement } from "react";

/** The logo mark and wordmark. The theme picks which logo file shows (CSS only, no flash). */
export function Brand({
  showName = true,
}: {
  showName?: boolean;
}): ReactElement {
  return (
    <span className="flex items-center gap-2.5">
      <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-card p-1 shadow-sm">
        <img
          alt=""
          className="size-full object-contain dark:hidden"
          height={24}
          src="/icons/logo-on-light.png"
          width={24}
        />
        <img
          alt=""
          className="hidden size-full object-contain dark:block"
          height={24}
          src="/icons/logo-on-dark.png"
          width={24}
        />
      </span>
      {showName ? (
        <span className="font-semibold text-sm tracking-tight">MediTract</span>
      ) : (
        <span className="sr-only">MediTract</span>
      )}
    </span>
  );
}
