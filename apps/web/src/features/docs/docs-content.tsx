import { QUICK_DEDUCT_UNDO_SECONDS } from "@shared/api";
import { MIN_PASSWORD_LENGTH } from "@shared/session";
import type { ReactElement, ReactNode } from "react";

export interface DocArticle {
  body: ReactNode;
  slug: string;
  summary: string;
  title: string;
}

function H({ children }: { children: ReactNode }): ReactElement {
  return <h2 className="mt-6 mb-2 font-semibold text-base">{children}</h2>;
}

function P({ children }: { children: ReactNode }): ReactElement {
  return <p className="mb-3 leading-relaxed">{children}</p>;
}

function List({ items }: { items: readonly string[] }): ReactElement {
  return (
    <ul className="mb-3 list-disc space-y-1 pl-5 leading-relaxed">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

/** Help pages, in reading order. Written for the web app (no install, no local database). */
export const DOC_ARTICLES: readonly DocArticle[] = [
  {
    body: (
      <>
        <P>
          MediTract tracks medical supplies by batch, works out how close each batch is to
          expiry, tells you which batch to use first (FEFO: First-Expiry, First-Out) and raises
          alerts. It runs in the browser; there is nothing to install.
        </P>
        <H>Signing in</H>
        <List
          items={[
            "Sign in with the username or email and password your administrator gave you. There is no public sign-up.",
            `On your first sign-in you must choose a new password (at least ${MIN_PASSWORD_LENGTH} characters).`,
            "Use the user menu to sign out, or to sign out of every device at once if a device was lost.",
            "After several failed attempts sign-in is paused for a while; wait and try again.",
          ]}
        />
        <H>Finding your way</H>
        <List
          items={[
            "The sidebar only lists the pages your role may open. On a phone it opens from the menu button.",
            "Press Ctrl+K (⌘K on a Mac) to jump to a page, search items or run an action.",
            "MediTract needs a connection. When you go offline a banner appears and changes are blocked until you are back.",
            "Theme (light/dark) and density (comfortable/compact) are in the header and the settings page.",
          ]}
        />
      </>
    ),
    slug: "getting-started",
    summary: "Signing in, passwords, navigation and the offline banner.",
    title: "Getting started",
  },
  {
    body: (
      <>
        <P>Every account has exactly one role. The administrator creates accounts and assigns roles.</P>
        <List
          items={[
            "Admin: everything, including users, settings, thresholds, alert channels, Trash restore and purge.",
            "Inventory Personnel: register and edit items and batches, adjust counts, dispose of expired stock, soft-delete, create requests, quick deduct, view analytics and reports.",
            "Pharmacist: approve, prepare and hand over requests, quick deduct, adjust counts, dispose of expired stock, view analytics and reports.",
            "Nurse / Healthcare Worker: scan, see availability and the FEFO list, create requests and quick deduct.",
            "Healthcare Administrator: read-only access to inventory, analytics and reports, plus report export and the audit log.",
          ]}
        />
        <P>
          The server checks every action against your role. A hidden button is a convenience, not the
          protection.
        </P>
      </>
    ),
    slug: "roles",
    summary: "The five roles and what each may do.",
    title: "Roles and permissions",
  },
  {
    body: (
      <>
        <P>
          An <strong>item</strong> is a product (name, strength, unit, category, supplier, SKU or
          barcode, low-stock threshold). A <strong>batch</strong> is stock of that item with a batch
          number, expiry date, quantity and received date.
        </P>
        <H>Adding stock</H>
        <List
          items={[
            "Open Add stock. Choose an existing item or create one, then add one row per batch. Leave the batch number empty to get a suggested one.",
            "Paste rows from a spreadsheet to register many batches at once.",
            "The same batch number for the same item (ignoring case and spaces) is blocked; you are offered to add the quantity to the existing batch instead.",
            "An expiry date in the past is allowed with a warning; the batch goes straight to Quarantine.",
            "Items such as equipment can be marked “no expiry”. Their batches are always Safe and are used last.",
          ]}
        />
        <H>Every batch gets a code</H>
        <P>
          Each batch receives a short code (10 characters) that its QR label encodes. Print labels from the
          Labels page.
        </P>
        <H>Corrections and deletion</H>
        <List
          items={[
            "Quantities never change by editing. Use Adjust stock (count correction, with a reason) so the ledger stays complete.",
            "Deleting an item or batch moves it to Trash. Only an administrator can restore or permanently purge it.",
          ]}
        />
      </>
    ),
    slug: "inventory",
    summary: "Items, batches, adding stock, duplicates and corrections.",
    title: "Inventory and batches",
  },
  {
    body: (
      <>
        <P>Each batch is classified from the whole days left until its expiry date, in the facility's time zone:</P>
        <List
          items={[
            "Expired: the expiry date has passed.",
            "Urgent: expires within the Urgent window (default 7 days, today included).",
            "Near Expiry: expires within the Near Expiry window (default 30 days).",
            "Safe: further away, or no expiry date.",
          ]}
        />
        <P>
          The class is worked out every time it is shown, so when an administrator changes the windows
          in Settings, every page, alert and report follows immediately. Every status is shown with text
          and an icon, never colour alone.
        </P>
        <H>Quarantine and disposal</H>
        <List
          items={[
            "Expired batches are never offered for dispensing, requests or quick deduct.",
            "They wait on the Quarantine page until someone with the permission disposes of them.",
            "Dispose / write off needs a reason (expired, damaged, recalled, other) and removes the whole remaining quantity. It is logged and audited.",
          ]}
        />
      </>
    ),
    slug: "expiry",
    summary: "Safe, Near Expiry, Urgent and Expired; quarantine and disposal.",
    title: "Expiry status and disposal",
  },
  {
    body: (
      <>
        <P>FEFO means the batch that expires first is used first.</P>
        <List
          items={[
            "Only batches that are not expired, not quarantined and have stock are eligible.",
            "Order: earliest expiry first, then earliest received date, then batch number. Batches without an expiry come last.",
            "Use first (FEFO) lists the next batch to pull for every item; the item detail shows the full order.",
            "Hand-overs and quick deducts take stock in FEFO order automatically and may span several batches. The record keeps the exact batches and quantities.",
            "If two people take the same stock at the same moment, one of them gets a conflict message and nothing is deducted twice. Stock can never go negative.",
          ]}
        />
      </>
    ),
    slug: "fefo",
    summary: "How the use-first order is chosen and applied.",
    title: "FEFO: what to use first",
  },
  {
    body: (
      <>
        <P>
          MediTract works with USB or Bluetooth handheld scanners that type like a keyboard and end with
          Enter. No camera permission is needed.
        </P>
        <List
          items={[
            "Click the scan field in the header (or open the Scan page) and scan. The batch QR code, a batch barcode, an item barcode or an SKU are all recognised.",
            "The result shows the item, the batch, its expiry status and the actions your role allows.",
            "Unknown code: you see a clear message, and staff who may register stock get a shortcut to register it.",
            "Labels: choose batches on the Labels page and print a sheet with item name, batch, expiry and QR code.",
          ]}
        />
      </>
    ),
    slug: "scanning",
    summary: "Handheld scanners, lookups and printing QR labels.",
    title: "Scanning and labels",
  },
  {
    body: (
      <>
        <P>Requests move through a queue: Pending → Approved → Ready to claim → Claimed. A request can also be Denied (with a reason) or Cancelled before hand-over.</P>
        <List
          items={[
            "Create a request with New request (Ctrl+N) or from an item's detail. Quantities must be whole numbers above zero.",
            "Pharmacists and administrators approve, prepare and hand over requests.",
            "Hand-over deducts stock in FEFO order and writes the dispensing log. A partial hand-over is allowed when not enough stock is available.",
            "If a batch expired after approval, the hand-over is checked again and reduced or blocked with a message.",
            "The Dispensing log lists every hand-over with the batches it drew from.",
          ]}
        />
        <H>Quick deduct</H>
        <P>
          Quick deduct (Ctrl+D) takes one quantity of one item in a single step, using FEFO. You can undo it
          for {QUICK_DEDUCT_UNDO_SECONDS} seconds.
        </P>
      </>
    ),
    slug: "requests",
    summary: "The request queue, hand-over, the dispensing log and quick deduct.",
    title: "Requests and dispensing",
  },
  {
    body: (
      <>
        <P>
          A daily job checks every batch. When a batch enters Near Expiry, enters Urgent, expires, or an
          item falls below its low-stock threshold, an alert is raised once (the same change is never sent
          twice).
        </P>
        <List
          items={[
            "In the app: the bell in the header and a banner on top of the pages. Read and dismissed state is per person.",
            "Browser push: turn it on for this device from the Notifications page. On iPhone and iPad, add MediTract to the home screen first.",
            "Daily email digest: the administrator manages the recipient list. Only addresses verified in the facility's Cloudflare account can receive it; if email is unavailable the other channels keep working.",
          ]}
        />
      </>
    ),
    slug: "alerts",
    summary: "In-app notifications, browser push and the daily email digest.",
    title: "Alerts and notifications",
  },
  {
    body: (
      <>
        <H>Analytics</H>
        <P>
          Usage by category, top dispensed items (with their batches), the expiry timeline, stock movement,
          the low-stock trend and dispensed vs requested, for a chosen range and category.
        </P>
        <H>Reports</H>
        <List
          items={[
            "Choose a month and year. The stock report shows opening, received, dispensed, disposed, adjusted and closing quantities per item and per batch.",
            "The expiry report lists batches expiring in that month and expired stock still on the shelf.",
            "Administrators and healthcare administrators can export either report to PDF or XLSX. Files are made in your browser.",
          ]}
        />
      </>
    ),
    slug: "reports",
    summary: "Analytics widgets, monthly stock and expiry reports, export.",
    title: "Analytics and reports",
  },
  {
    body: (
      <>
        <List
          items={[
            "Users: create accounts, change roles, reset passwords (the user must choose a new one) and disable accounts. Accounts with history are disabled, never deleted, and the last active administrator cannot be disabled.",
            "Settings: facility name, time zone, the Urgent and Near Expiry windows, alert channels, digest recipients and time.",
            "Audit log: every sign-in, inventory change, hand-over, disposal, settings change and user change, with who, when and what changed.",
            "Trash: restore or permanently purge deleted items and batches.",
          ]}
        />
      </>
    ),
    slug: "administration",
    summary: "Users, settings, the audit log and Trash.",
    title: "Administration",
  },
  {
    body: (
      <>
        <List
          items={[
            "Ctrl+K / ⌘K: command palette.",
            "Ctrl+N / ⌘N: new request.",
            "Ctrl+D / ⌘D: quick deduct.",
            "?: list of shortcuts.",
            "Esc: close the open dialog or menu.",
          ]}
        />
      </>
    ),
    slug: "shortcuts",
    summary: "Keyboard shortcuts.",
    title: "Keyboard shortcuts",
  },
  {
    body: (
      <>
        <List
          items={[
            "MediTract stores supplies and staff accounts only. Never enter patient information.",
            "Data is kept in the facility's Cloudflare D1 database, not on your computer.",
            "Passwords are stored as salted hashes. Your session lives in a secure, HTTP-only cookie.",
            "Push subscriptions are kept per device until you turn them off or the browser revokes them.",
          ]}
        />
      </>
    ),
    slug: "privacy",
    summary: "What is stored and where.",
    title: "Privacy",
  },
];

export function findDoc(slug: string): DocArticle | undefined {
  return DOC_ARTICLES.find((article) => article.slug === slug);
}
