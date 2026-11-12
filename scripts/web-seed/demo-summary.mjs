/** The text the demo seed prints: a compact summary table of what was (or would be) written. */

const LABEL_WIDTH = 24;

/**
 * @param {string} label
 * @param {string | number} value
 */
function line(label, value) {
  return `  ${label.padEnd(LABEL_WIDTH)}${value}`;
}

/**
 * @param {{
 *   passwordIsDefault: boolean,
 *   summary: ReturnType<typeof import("./demo-plan.mjs").buildDemoPlan>["summary"],
 *   tables: Record<string, Record<string, unknown>[]>,
 * }} plan
 * @param {{ defaultPassword: string, target: string }} context
 * @returns {string}
 */
export function formatDemoSummary(plan, { defaultPassword, target }) {
  const { batchClasses, counts, requestStatuses, thresholds } = plan.summary;
  const out = [
    "",
    "MediTract Web demo data",
    line("target", target),
    line(
      "base date",
      `${plan.summary.today} (${plan.summary.timeZone}); Urgent <= ${thresholds.urgentDays} d, Near Expiry <= ${thresholds.nearDays} d`
    ),
    "",
    "Catalogue and stock",
    line("categories", counts.categories),
    line("items", counts.items),
    line("batches", counts.batches),
    line("  Safe", batchClasses.safe),
    line("  Near Expiry", batchClasses.near_expiry),
    line("  Urgent", batchClasses.urgent),
    line("  Expired (quarantine)", batchClasses.expired),
    line("  qty 0, still active", batchClasses.zeroQty),
    line("  disposed", batchClasses.disposed),
    line("  without expiry date", batchClasses.noExpiry),
    line("stock movements", counts.movements),
    line("disposals", counts.disposals),
    "",
    "Requests and dispensing",
    line("requests", counts.requests),
    ...Object.entries(requestStatuses).map(([status, count]) =>
      line(`  ${status}`, count)
    ),
    line("request events", counts.requestEvents),
    line("dispensing records", counts.dispensingRecords),
    line("dispensing lines", counts.dispensingLines),
    "",
    "Alerts",
    line("notifications", counts.notifications),
    line(
      "low stock",
      plan.summary.lowStock
        .map(
          (entry) =>
            `${entry.name}: ${entry.status} (${entry.available}/${entry.threshold})`
        )
        .join("; ")
    ),
    "",
    "Users (shared password, must_change_password = 0)",
    ...plan.tables.users.map((user) =>
      line(String(user.username), String(user.role))
    ),
    line(
      "password",
      plan.passwordIsDefault
        ? `${defaultPassword} (default)`
        : "from WEB_DEMO_PASSWORD (not shown)"
    ),
    "",
    line("audit_log", `${counts.audit} rows appended (never deleted)`),
  ];
  return out.join("\n");
}
