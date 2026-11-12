import { Button } from "@cmis/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@cmis/ui/components/dropdown-menu";
import type { RequestActionId } from "@shared/request-transitions";
import type { RequestDto } from "@shared/schemas/requests";
import { Ellipsis } from "lucide-react";
import type { ReactElement } from "react";

import { useAllowedActions } from "../hooks/use-allowed-actions";

export interface RequestCardMenuProps {
  onAction: (action: RequestActionId, request: RequestDto) => void;
  request: RequestDto;
}

/** The ⋯ menu of a card: every action the user may take, and the keyboard route for moving cards. */
export function RequestCardMenu({
  onAction,
  request,
}: RequestCardMenuProps): ReactElement {
  const actions = useAllowedActions(request);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={`Actions for ${request.code}`}
            className="size-7"
            size="icon"
            type="button"
            variant="ghost"
          />
        }
      >
        <Ellipsis aria-hidden className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {actions.map((action) => (
          <DropdownMenuItem
            className={action.destructive ? "text-destructive" : undefined}
            key={action.id}
            onClick={() => onAction(action.id, request)}
          >
            {action.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
