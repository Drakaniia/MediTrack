export const SEED_ACTOR_NAME: string;

export type Row = Record<string, string | number | null>;

export interface DemoSummary {
  batchClasses: {
    disposed: number;
    expired: number;
    near_expiry: number;
    noExpiry: number;
    safe: number;
    urgent: number;
    zeroQty: number;
  };
  counts: Record<string, number>;
  lowStock: { available: number; name: string; status: string; threshold: number }[];
  quarantine: number;
  requestStatuses: Record<string, number>;
  thresholds: { nearDays: number; urgentDays: number };
  timeZone: string;
  today: string;
}

export interface DemoPlan {
  passwordIsDefault: boolean;
  summary: DemoSummary;
  tables: Record<
    | "alert_state"
    | "audit_log"
    | "batches"
    | "categories"
    | "counters"
    | "dispensing_lines"
    | "dispensing_records"
    | "disposals"
    | "items"
    | "low_stock_state"
    | "notification_state"
    | "notifications"
    | "request_events"
    | "requests"
    | "stock_movements"
    | "users",
    Row[]
  >;
  thresholds: { nearDays: number; urgentDays: number };
  timeZone: string;
  today: string;
}

export interface DemoPlanOptions {
  iterations?: number;
  password?: string;
  thresholds?: { nearDays: number; urgentDays: number };
  timeZone: string;
  today: string;
}

export function buildDemoPlan(
  dataset: unknown,
  options: DemoPlanOptions
): DemoPlan;
