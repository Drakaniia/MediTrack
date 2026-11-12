import type { DemoPlan } from "./demo-plan.mjs";

export function formatDemoSummary(
  plan: DemoPlan,
  context: { defaultPassword: string; target: string }
): string;
