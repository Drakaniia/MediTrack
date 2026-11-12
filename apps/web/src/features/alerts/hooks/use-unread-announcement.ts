import { useEffect, useRef, useState } from "react";

import { unreadAnnouncement } from "../lib/notification-view";

/**
 * Text for a polite live region: "2 new notifications" when the unread count rises, then
 * "" again once it does not. The first value (page load) is never announced, and one
 * message covers any number of new alerts, so a burst is a single announcement, not a storm.
 */
export function useUnreadAnnouncement(unread: number | undefined): string {
  const previous = useRef<number | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (unread === undefined) {
      return;
    }
    setMessage(unreadAnnouncement(previous.current, unread));
    previous.current = unread;
  }, [unread]);

  return message;
}
