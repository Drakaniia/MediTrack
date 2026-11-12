export type DigestTransitionClass = "near_expiry" | "urgent" | "expired";

export interface DigestCounts {
  expired: number;
  lowStock: number;
  nearExpiry: number;
  safe: number;
  urgent: number;
}

export interface DigestTransition {
  batchNumber: string;
  /** Negative when already expired. */
  daysUntil: number;
  /** Expiry date, `YYYY-MM-DD`. */
  expiry: string;
  /** Previous notified class, `null` when the batch is newly tracked. */
  from: string | null;
  itemName: string;
  to: DigestTransitionClass;
}

export interface DigestLowStock {
  itemName: string;
  onHand: number;
  threshold: number;
  unit: string;
}

export interface DigestInput {
  appUrl: string;
  counts: DigestCounts;
  facilityName: string;
  /** Facility-local date, `YYYY-MM-DD`. */
  localDate: string;
  lowStock: DigestLowStock[];
  /** Maximum rows per table before "...and N more". Defaults to 20. */
  maxRows?: number;
  transitions: DigestTransition[];
}

export interface RenderedDigest {
  html: string;
  subject: string;
  text: string;
}

export const DEFAULT_MAX_ROWS = 20;
const SUBJECT_PREFIX = "[MediTract]";
const NEWLINES = /[\r\n]+/g;
const AMPERSAND = /&/g;
const LESS_THAN = /</g;
const GREATER_THAN = />/g;
const DOUBLE_QUOTE = /"/g;
const SINGLE_QUOTE = /'/g;
const UNDERSCORE = /_/g;

const CLASS_LABELS: Readonly<Record<string, string>> = {
  expired: "Expired",
  near_expiry: "Near Expiry",
  safe: "Safe",
  urgent: "Urgent",
};

interface Palette {
  background: string;
  color: string;
}

const CLASS_PALETTES: Readonly<Record<DigestTransitionClass, Palette>> = {
  expired: { background: "#7f1d1d", color: "#ffffff" },
  near_expiry: { background: "#fef3c7", color: "#92400e" },
  urgent: { background: "#fee2e2", color: "#991b1b" },
};
const LOW_STOCK_PALETTE: Palette = { background: "#dbeafe", color: "#1e40af" };
const SAFE_PALETTE: Palette = { background: "#dcfce7", color: "#166534" };
const FONT = "-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif";
const CELL = "padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:14px;";

/** Escapes text for HTML element content and quoted attribute values. */
function escapeHtml(value: string): string {
  return value
    .replace(AMPERSAND, "&amp;")
    .replace(LESS_THAN, "&lt;")
    .replace(GREATER_THAN, "&gt;")
    .replace(DOUBLE_QUOTE, "&quot;")
    .replace(SINGLE_QUOTE, "&#39;");
}

function classLabel(value: string): string {
  return CLASS_LABELS[value] ?? value.replace(UNDERSCORE, " ");
}

function pluralDays(days: number): string {
  return days === 1 ? "1 day" : `${days} days`;
}

function describeDays(daysUntil: number): string {
  if (daysUntil === 0) {
    return "today";
  }
  return daysUntil > 0
    ? `in ${pluralDays(daysUntil)}`
    : `${pluralDays(-daysUntil)} ago`;
}

function describeChange(transition: DigestTransition): string {
  const from = transition.from === null ? "New" : classLabel(transition.from);
  return `${from} \u2192 ${classLabel(transition.to)}`;
}

function formatQuantity(low: DigestLowStock): string {
  return `${low.onHand} ${low.unit} (min ${low.threshold})`;
}

/** Returns the normalised URL only for http(s); anything else (javascript:, mailto:, garbage) is dropped. */
function safeAppUrl(appUrl: string): string | null {
  try {
    const url = new URL(appUrl);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function singleLine(value: string): string {
  return value.replace(NEWLINES, " ").trim();
}

function resolveMaxRows(maxRows: number | undefined): number {
  if (maxRows === undefined || !Number.isFinite(maxRows) || maxRows < 1) {
    return DEFAULT_MAX_ROWS;
  }
  return Math.floor(maxRows);
}

function visibleRows<T>(
  rows: readonly T[],
  maxRows: number
): { shown: T[]; hidden: number } {
  return {
    hidden: Math.max(0, rows.length - maxRows),
    shown: rows.slice(0, maxRows),
  };
}

/**
 * True when there is nothing new to say: no class transitions and no low-stock
 * entries. The cron job uses this with the "quiet when nothing changed" setting
 * to decide whether to skip sending at all.
 */
export function isQuietDigest(input: DigestInput): boolean {
  return input.transitions.length === 0 && input.lowStock.length === 0;
}

function buildSubject(input: DigestInput): string {
  const { counts } = input;
  const parts: string[] = [];
  const candidates: [number, string][] = [
    [counts.urgent, "urgent"],
    [counts.expired, "expired"],
    [counts.nearExpiry, "near expiry"],
    [counts.lowStock, "low stock"],
  ];
  for (const [count, label] of candidates) {
    if (count > 0) {
      parts.push(`${count} ${label}`);
    }
  }
  const summary =
    isQuietDigest(input) || parts.length === 0
      ? "Daily summary"
      : parts.join(", ");
  const facility = singleLine(input.facilityName);
  const date = singleLine(input.localDate);
  return `${SUBJECT_PREFIX} ${summary} \u2014 ${facility} ${date}`;
}

function countsLine(counts: DigestCounts): string {
  return [
    `Safe: ${counts.safe}`,
    `Near Expiry: ${counts.nearExpiry}`,
    `Urgent: ${counts.urgent}`,
    `Expired: ${counts.expired}`,
    `Low Stock: ${counts.lowStock}`,
  ].join(" | ");
}

function renderText(input: DigestInput, maxRows: number): string {
  const lines: string[] = [
    `MediTract daily summary for ${singleLine(input.facilityName)} (${singleLine(input.localDate)})`,
    "",
    countsLine(input.counts),
  ];
  if (isQuietDigest(input)) {
    lines.push("", "No changes since the last summary.");
  }
  const transitions = visibleRows(input.transitions, maxRows);
  if (transitions.shown.length > 0) {
    lines.push("", "Changes since the last summary:");
    for (const entry of transitions.shown) {
      lines.push(
        `- ${entry.itemName} (batch ${entry.batchNumber}): ${describeChange(entry)}, expires ${entry.expiry} (${describeDays(entry.daysUntil)})`
      );
    }
    if (transitions.hidden > 0) {
      lines.push(`...and ${transitions.hidden} more`);
    }
  }
  const lowStock = visibleRows(input.lowStock, maxRows);
  if (lowStock.shown.length > 0) {
    lines.push("", "Low stock:");
    for (const entry of lowStock.shown) {
      lines.push(`- ${entry.itemName}: ${formatQuantity(entry)}`);
    }
    if (lowStock.hidden > 0) {
      lines.push(`...and ${lowStock.hidden} more`);
    }
  }
  const link = safeAppUrl(input.appUrl);
  if (link) {
    lines.push("", `Open MediTract: ${link}`);
  }
  return `${lines.join("\n")}\n`;
}

function badge(label: string, palette: Palette): string {
  return `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:bold;background:${palette.background};color:${palette.color};">${escapeHtml(label)}</span>`;
}

function td(content: string, extraStyle = ""): string {
  return `<td style="${CELL}${extraStyle}">${content}</td>`;
}

function th(label: string): string {
  return `<th align="left" style="padding:8px 10px;border-bottom:2px solid #9ca3af;font-size:12px;text-transform:uppercase;color:#4b5563;">${escapeHtml(label)}</th>`;
}

function countCell(label: string, count: number, palette: Palette): string {
  return `<td align="center" style="padding:10px 6px;background:${palette.background};color:${palette.color};border:2px solid #ffffff;"><div style="font-size:22px;font-weight:bold;">${count}</div><div style="font-size:12px;font-weight:bold;">${escapeHtml(label)}</div></td>`;
}

function renderCountsHtml(counts: DigestCounts): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;"><tr>${[
    countCell("Safe", counts.safe, SAFE_PALETTE),
    countCell("Near Expiry", counts.nearExpiry, CLASS_PALETTES.near_expiry),
    countCell("Urgent", counts.urgent, CLASS_PALETTES.urgent),
    countCell("Expired", counts.expired, CLASS_PALETTES.expired),
    countCell("Low Stock", counts.lowStock, LOW_STOCK_PALETTE),
  ].join("")}</tr></table>`;
}

function renderSection(
  title: string,
  headers: string[],
  rows: string[],
  hidden: number
): string {
  const more =
    hidden > 0
      ? `<p style="margin:8px 0 0;font-size:13px;color:#4b5563;">&hellip;and ${hidden} more</p>`
      : "";
  return `<h2 style="margin:24px 0 8px;font-size:16px;color:#111827;">${escapeHtml(title)}</h2><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><thead><tr>${headers.map(th).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>${more}`;
}

function renderTransitionRow(entry: DigestTransition): string {
  return `<tr>${[
    td(escapeHtml(entry.itemName)),
    td(escapeHtml(entry.batchNumber)),
    td(
      `${escapeHtml(entry.expiry)}<br><span style="font-size:12px;color:#4b5563;">${escapeHtml(describeDays(entry.daysUntil))}</span>`
    ),
    td(
      `${badge(classLabel(entry.to), CLASS_PALETTES[entry.to])}<br><span style="font-size:12px;color:#4b5563;">${escapeHtml(describeChange(entry))}</span>`
    ),
  ].join("")}</tr>`;
}

function renderLowStockRow(entry: DigestLowStock): string {
  return `<tr>${[
    td(escapeHtml(entry.itemName)),
    td(escapeHtml(formatQuantity(entry))),
  ].join("")}</tr>`;
}

function renderLink(appUrl: string): string {
  const link = safeAppUrl(appUrl);
  if (!link) {
    return "";
  }
  const href = escapeHtml(link);
  return `<p style="margin:24px 0 0;"><a href="${href}" style="display:inline-block;padding:10px 16px;background:#1d4ed8;color:#ffffff;text-decoration:none;border-radius:4px;font-size:14px;font-weight:bold;">Open MediTract</a></p><p style="margin:8px 0 0;font-size:12px;color:#4b5563;">${href}</p>`;
}

function renderHtml(input: DigestInput, maxRows: number): string {
  const sections: string[] = [];
  if (isQuietDigest(input)) {
    sections.push(
      '<p style="margin:16px 0;font-size:14px;color:#374151;">No changes since the last summary.</p>'
    );
  }
  const transitions = visibleRows(input.transitions, maxRows);
  if (transitions.shown.length > 0) {
    sections.push(
      renderSection(
        "Changes since the last summary",
        ["Item", "Batch", "Expiry", "Status"],
        transitions.shown.map(renderTransitionRow),
        transitions.hidden
      )
    );
  }
  const lowStock = visibleRows(input.lowStock, maxRows);
  if (lowStock.shown.length > 0) {
    sections.push(
      renderSection(
        "Low stock",
        ["Item", "On hand"],
        lowStock.shown.map(renderLowStockRow),
        lowStock.hidden
      )
    );
  }
  const title = "MediTract daily summary";
  const heading = `${escapeHtml(singleLine(input.facilityName))} &middot; ${escapeHtml(singleLine(input.localDate))}`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body style="margin:0;padding:0;background:#f3f4f6;font-family:${FONT};"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;"><tr><td align="center" style="padding:24px 12px;"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:6px;"><tr><td style="padding:24px;"><h1 style="margin:0;font-size:20px;color:#111827;">${escapeHtml(title)}</h1><p style="margin:4px 0 0;font-size:14px;color:#4b5563;">${heading}</p>${renderCountsHtml(input.counts)}${sections.join("")}${renderLink(input.appUrl)}</td></tr></table></td></tr></table></body></html>`;
}

/**
 * Renders the daily digest as subject + plain-text + HTML. Every interpolated
 * value is HTML-escaped (item names are user data), status is always spelled
 * out as text so colour is never the only signal, and long lists are truncated
 * to `maxRows` per table with an "...and N more" line to keep the email small.
 */
export function renderDigest(input: DigestInput): RenderedDigest {
  const maxRows = resolveMaxRows(input.maxRows);
  return {
    html: renderHtml(input, maxRows),
    subject: buildSubject(input),
    text: renderText(input, maxRows),
  };
}
