import { Button } from "@cmis/ui/components/button";
import type { ItemSummaryDto } from "@shared/schemas/inventory";
import { SearchX, X } from "lucide-react";
import { type KeyboardEvent, type ReactElement, useEffect, useRef } from "react";

export type ScanFeedback =
  | { code: string; items: ItemSummaryDto[]; type: "ambiguous" }
  | { canRegister: boolean; code: string; type: "not_found" };

export interface ScanFeedbackPanelProps {
  feedback: ScanFeedback;
  onDismiss: () => void;
  onPick: (item: ItemSummaryDto) => void;
  onRegister: (code: string) => void;
}

function NotFound({
  canRegister,
  code,
  onRegister,
}: {
  canRegister: boolean;
  code: string;
  onRegister: (code: string) => void;
}): ReactElement {
  return (
    <div className="flex items-start gap-2">
      <SearchX aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1 space-y-2">
        <div>
          <p className="font-medium text-sm">Code not found</p>
          <p className="break-all text-muted-foreground text-xs">{code}</p>
        </div>
        {canRegister ? (
          <Button
            className="tap-target"
            onClick={() => onRegister(code)}
            size="sm"
            variant="outline"
          >
            Register this code
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function Chooser({
  code,
  items,
  onPick,
}: {
  code: string;
  items: ItemSummaryDto[];
  onPick: (item: ItemSummaryDto) => void;
}): ReactElement {
  const firstRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  return (
    <div className="space-y-2">
      <div>
        <p className="font-medium text-sm">Several items match</p>
        <p className="break-all text-muted-foreground text-xs">{code}</p>
      </div>
      <ul aria-label="Matching items" className="space-y-1">
        {items.map((item, index) => (
          <li key={item.id}>
            <Button
              className="tap-target h-auto w-full justify-start whitespace-normal py-1.5 text-left"
              onClick={() => onPick(item)}
              ref={index === 0 ? firstRef : undefined}
              variant="ghost"
            >
              <span className="font-medium">{item.displayName}</span>
              {item.sku ? (
                <span className="ml-2 text-muted-foreground text-xs">SKU {item.sku}</span>
              ) : null}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The small popover under the header scan field for the two outcomes that need a decision:
 * a code that matches nothing (offer to register it) and a code that matches several items.
 */
export function ScanFeedbackPanel({
  feedback,
  onDismiss,
  onPick,
  onRegister,
}: ScanFeedbackPanelProps): ReactElement {
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onDismiss();
    }
  };

  return (
    <section
      aria-label="Scan result"
      className="absolute top-full right-0 left-0 z-50 mt-1 min-w-64 rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg"
      onKeyDown={handleKeyDown}
    >
      <Button
        aria-label="Dismiss scan result"
        className="absolute top-1 right-1"
        onClick={onDismiss}
        size="icon-xs"
        variant="ghost"
      >
        <X aria-hidden />
      </Button>
      <div className="pr-6">
        {feedback.type === "not_found" ? (
          <NotFound
            canRegister={feedback.canRegister}
            code={feedback.code}
            onRegister={onRegister}
          />
        ) : (
          <Chooser code={feedback.code} items={feedback.items} onPick={onPick} />
        )}
      </div>
    </section>
  );
}
