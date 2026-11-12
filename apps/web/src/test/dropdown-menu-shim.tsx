/**
 * Test-only stand-in for `@cmis/ui/components/dropdown-menu`.
 *
 * Same reasoning as `popover-shim.tsx`: Base UI's floating positioner re-measures
 * its anchor on every layout pass, and jsdom has no layout engine to answer
 * cheaply, so an *open* menu costs seconds per render. Rendering the trigger and
 * the content as plain elements keeps the item handlers under test while leaving
 * positioning to Base UI. The content is always rendered (no open state).
 *
 * Use it with
 * `vi.mock("@cmis/ui/components/dropdown-menu", () => import("@/test/dropdown-menu-shim"))`.
 */
import {
  cloneElement,
  createContext,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useCallback,
  useContext,
} from "react";

export function DropdownMenu({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  return <div>{children}</div>;
}

export function DropdownMenuTrigger({
  children,
  render,
  ...props
}: {
  children?: ReactNode;
  className?: string;
  render?: ReactElement;
}): ReactElement {
  if (isValidElement(render)) {
    return cloneElement(
      render as ReactElement<Record<string, unknown>>,
      props,
      children
    );
  }
  return (
    <button type="button" {...props}>
      {children}
    </button>
  );
}

export function DropdownMenuContent({
  children,
}: {
  align?: "center" | "end" | "start";
  children: ReactNode;
  className?: string;
}): ReactElement {
  return <div role="menu">{children}</div>;
}

export function DropdownMenuItem({
  children,
  disabled,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
}): ReactElement {
  return (
    <button disabled={disabled} onClick={onClick} role="menuitem" type="button">
      {children}
    </button>
  );
}

export function DropdownMenuGroup({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  return <fieldset>{children}</fieldset>;
}

export function DropdownMenuLabel({
  children,
}: {
  children: ReactNode;
  className?: string;
}): ReactElement {
  return <div>{children}</div>;
}

export function DropdownMenuSeparator(): ReactElement {
  return <hr />;
}

interface RadioState {
  onValueChange?: (value: string) => void;
  value?: string;
}

const RadioContext = createContext<RadioState>({});

export function DropdownMenuRadioGroup({
  children,
  onValueChange,
  value,
}: {
  children: ReactNode;
  onValueChange?: (value: string) => void;
  value?: string;
}): ReactElement {
  return (
    <RadioContext.Provider value={{ onValueChange, value }}>
      <fieldset>{children}</fieldset>
    </RadioContext.Provider>
  );
}

export function DropdownMenuRadioItem({
  children,
  value,
}: {
  children: ReactNode;
  className?: string;
  value: string;
}): ReactElement {
  const state = useContext(RadioContext);
  const handleClick = useCallback(
    () => state.onValueChange?.(value),
    [state, value]
  );
  return (
    <button
      aria-checked={state.value === value}
      onClick={handleClick}
      role="menuitemradio"
      type="button"
    >
      {children}
    </button>
  );
}
