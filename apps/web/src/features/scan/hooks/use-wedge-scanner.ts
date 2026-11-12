import {
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { cleanScanText, isEditableTarget } from "../lib/clean-code";
import {
  createWedgeDetector,
  type WedgeDetector,
  type WedgeOptions,
} from "../lib/wedge-detector";

/**
 * Two ways to catch a keyboard-wedge scanner (see `lib/wedge-detector.ts`):
 *
 *  - `useWedgeScanner`: global capture while NO editable element has focus, so a scan works
 *    from anywhere in the app without clicking into a field first.
 *  - `useScanInput`: per-field mode for the scan fields. Enter submits whatever is in the
 *    field (typed or scanned), control characters and padding are trimmed, and the submit says
 *    whether it arrived as a fast burst.
 *
 * Neither ever submits a partial code: only Enter completes a scan.
 */

/** Reads the event time. Injectable so tests control the clock. */
export type KeyClock = (event: KeyboardEvent | ReactKeyboardEvent) => number;

const eventClock: KeyClock = (event) => event.timeStamp;

export interface UseWedgeScannerOptions extends WedgeOptions {
  /** Capture only while true (e.g. off on pages that run their own scan field). Default true. */
  enabled?: boolean;
  getTime?: KeyClock;
  onScan: (code: string) => void;
}

export function useWedgeScanner(options: UseWedgeScannerOptions): void {
  const { enabled = true, getTime = eventClock, maxGapMs, minLength } = options;
  const onScanRef = useRef(options.onScan);

  useEffect(() => {
    onScanRef.current = options.onScan;
  });

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const detector = createWedgeDetector({ maxGapMs, minLength });
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing) {
        return;
      }
      if (isEditableTarget(event.target)) {
        detector.reset();
        return;
      }
      const code = detector.push({
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        key: event.key,
        metaKey: event.metaKey,
        timeStamp: getTime(event),
      });
      if (code !== null) {
        // Stops Enter from "clicking" whatever button happens to have focus.
        event.preventDefault();
        onScanRef.current(code);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [enabled, getTime, maxGapMs, minLength]);
}

export interface ScanSubmission {
  code: string;
  /** True when the code arrived as a fast scanner burst rather than being typed. */
  viaScanner: boolean;
}

export interface UseScanInputOptions extends WedgeOptions {
  getTime?: KeyClock;
  onSubmit: (submission: ScanSubmission) => void;
}

export interface ScanInputBinding {
  clear: () => void;
  inputProps: {
    onChange: (event: ChangeEvent<HTMLInputElement>) => void;
    onKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
    value: string;
  };
  setValue: (value: string) => void;
  /** Submits the current text like Enter does (for a "Look up" button). */
  submit: () => void;
  value: string;
}

export function useScanInput(options: UseScanInputOptions): ScanInputBinding {
  const { getTime = eventClock, maxGapMs, minLength } = options;
  const [value, setValue] = useState("");
  const onSubmitRef = useRef(options.onSubmit);
  const detectorRef = useRef<WedgeDetector | null>(null);

  useEffect(() => {
    onSubmitRef.current = options.onSubmit;
  });

  useEffect(() => {
    detectorRef.current = createWedgeDetector({ maxGapMs, minLength });
    return () => {
      detectorRef.current = null;
    };
  }, [maxGapMs, minLength]);

  const clear = useCallback(() => setValue(""), []);

  const submit = useCallback(() => {
    const code = cleanScanText(value);
    if (code === "") {
      return;
    }
    setValue("");
    onSubmitRef.current({ code, viaScanner: false });
  }, [value]);

  const onChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setValue(event.target.value);
  }, []);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.nativeEvent.isComposing) {
        return;
      }
      const burst = detectorRef.current?.push({
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        key: event.key,
        metaKey: event.metaKey,
        timeStamp: getTime(event),
      });
      if (event.key !== "Enter") {
        return;
      }
      event.preventDefault();
      const code = cleanScanText(event.currentTarget.value);
      if (code === "") {
        return;
      }
      setValue("");
      onSubmitRef.current({ code, viaScanner: typeof burst === "string" });
    },
    [getTime]
  );

  return useMemo(
    () => ({
      clear,
      inputProps: { onChange, onKeyDown, value },
      setValue,
      submit,
      value,
    }),
    [clear, onChange, onKeyDown, submit, value]
  );
}
