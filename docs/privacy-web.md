# MediTract Web Privacy Statement

**Effective:** 2026-11-12

MediTract Web is the hosted version of MediTract: a browser app for tracking medical supply
expiry and first-expiry, first-out (FEFO) dispensing. It is **not local-first**: your facility's supply data and staff
accounts live in a database hosted on Cloudflare. This statement says exactly what is stored
and where.

**MediTract Web holds no patient data.** It tracks supplies, not people receiving care. Do not
type patient names or identifiers into free-text fields (notes, reasons, requestor).

## Who runs it

Each facility runs its own deployment under its own Cloudflare account and decides who
gets an account. The facility (the operator) is the controller of the data; the project
authors cannot see, collect or access any deployment's data.

## What is stored

All of it is in the facility's Cloudflare D1 database:

- **Staff accounts:** username, display name, role, optional email address, a salted PBKDF2
  password hash (never the password), and timestamps such as last sign-in.
- **Supply data:** items, categories, batches (numbers, expiry dates, quantities, suppliers,
  barcodes), stock movements, supply requests (who asked for what), dispensing and disposal
  records, and notifications.
- **Sessions:** a hashed session token, creation and expiry times, and the IP address and
  browser user-agent of the sign-in. Sessions end after 8 hours idle or 7 days in total, or
  when you sign out ("sign out everywhere" ends all of them).
- **Login throttling:** a record of recent sign-in attempts keyed by username and IP address,
  used only to slow down password guessing.
- **Audit log:** an append-only record of sign-ins, inventory changes, dispensing, disposal,
  settings and user-management actions, with who did it, when, a summary and the IP address.
- **Push subscriptions (optional):** if you enable browser notifications, the push service
  endpoint and encryption keys your browser gave us, plus the browser user-agent. Remove it
  any time by turning notifications off.
- **Digest email addresses (optional):** addresses an administrator enters in settings to
  receive the daily expiry digest.
- **Settings:** facility name, timezone, alert thresholds, digest time.

## Cookies and local storage

- One **session cookie** (`mt_session`): `HttpOnly`, `Secure`, `SameSite=Lax`. It is strictly
  necessary to keep you signed in; there are no other cookies.
- The browser stores your display preferences (theme, density) locally. A service worker
  handles push notifications; it is not used for tracking.

## What is not collected

- No analytics, telemetry, advertising or tracking scripts, and no third-party fonts or CDNs;
  the app serves everything from its own origin.
- No data is sold or shared for marketing.

## Third parties (infrastructure only)

- **Cloudflare** hosts the app (Pages, Workers, D1) and, like any host, processes request
  metadata such as IP addresses in its own logs under its terms.
- **Browser push services** (Google, Mozilla, Apple, Microsoft) relay notifications you opted
  into. Notifications carry supply information (item names, expiry status) and no personal data.
- **Cloudflare Email Service** delivers the digest if the operator configured it. Digest
  emails list supply names and expiry dates only.

## Retention and deletion

- Sessions are removed when they expire or when you sign out.
- Accounts with history are disabled rather than deleted, so the audit trail stays coherent.
  The operator can remove accounts and rows directly in D1.
- Audit entries, stock movements and dispensing records are kept for as long as the
  operator keeps the database; the operator decides any retention policy and is
  responsible for it under the rules that apply to the facility.
- Deleting the D1 database (or the Cloudflare project) erases everything the app stores.

## Security

Passwords are hashed with a per-user salt; session tokens are stored only as hashes; the
session secret and push private key are kept as Cloudflare secrets, never in the code
repository. Access is role-based and checked on the server, and the app sends strict
security headers (CSP, no framing, no MIME sniffing).

## Contact

Privacy or security questions: https://github.com/Drakaniia/cmis/issues
(please do not post personal or facility data in an issue).
