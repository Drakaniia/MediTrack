import { Button } from "@cmis/ui/components/button";
import { Input } from "@cmis/ui/components/input";
import { Label } from "@cmis/ui/components/label";
import { MAX_DIGEST_RECIPIENTS } from "@shared/settings";
import { X } from "lucide-react";
import {
  type ChangeEvent,
  type KeyboardEvent,
  type ReactElement,
  useCallback,
  useId,
  useState,
} from "react";

import { addRecipient, removeRecipient } from "../lib/recipients";

export interface RecipientsEditorProps {
  /** A message from the surrounding form (for example "Add at least one recipient"). */
  error?: string;
  onChange: (recipients: string[]) => void;
  recipients: readonly string[];
}

/** The digest's recipient list: add by typing + Enter, remove with the × button. Max 50. */
export function RecipientsEditor({
  error,
  onChange,
  recipients,
}: RecipientsEditorProps): ReactElement {
  const inputId = useId();
  const messageId = useId();
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState<string | undefined>();

  const handleAdd = useCallback(() => {
    const result = addRecipient(recipients, draft);
    if (!result.ok) {
      setDraftError(result.message);
      return;
    }
    setDraftError(undefined);
    setDraft("");
    onChange(result.recipients);
  }, [draft, onChange, recipients]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        handleAdd();
      }
    },
    [handleAdd]
  );

  const handleDraft = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setDraft(event.target.value);
    setDraftError(undefined);
  }, []);

  const message = draftError ?? error;

  return (
    <div className="grid gap-2">
      <Label htmlFor={inputId}>Add a recipient</Label>
      <div className="flex gap-2">
        <Input
          aria-describedby={message ? messageId : undefined}
          aria-invalid={message ? true : undefined}
          autoComplete="off"
          className="h-9"
          id={inputId}
          inputMode="email"
          onChange={handleDraft}
          onKeyDown={handleKeyDown}
          placeholder="name@example.org"
          type="email"
          value={draft}
        />
        <Button onClick={handleAdd} type="button" variant="outline">
          Add
        </Button>
      </div>
      {message ? (
        <p className="text-destructive text-xs" id={messageId} role="alert">
          {message}
        </p>
      ) : null}
      <p className="text-muted-foreground text-xs">
        {recipients.length} of {MAX_DIGEST_RECIPIENTS} recipients. On the
        Cloudflare free tier, mail can only reach destination addresses that are
        verified in your Cloudflare account.
      </p>
      {recipients.length === 0 ? (
        <p className="text-sm">No recipients yet.</p>
      ) : (
        <ul
          aria-label="Digest recipients"
          className="divide-y rounded-md border text-sm"
        >
          {recipients.map((email) => (
            <li
              className="flex items-center justify-between gap-2 px-3 py-1.5"
              key={email}
            >
              <span className="min-w-0 break-all">{email}</span>
              <Button
                aria-label={`Remove ${email}`}
                onClick={() => onChange(removeRecipient(recipients, email))}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <X aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
