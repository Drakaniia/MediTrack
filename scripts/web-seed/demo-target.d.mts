export const PRODUCTION_DATABASE_NAMES: string[];
export const DEMO_USAGE: string;

export interface DemoOptions {
  confirmProduction: boolean;
  database: string | undefined;
  dryRun: boolean;
  env: string | undefined;
  help: boolean;
  remote: boolean;
  today: string | undefined;
  yesIKnow: boolean;
}

export interface DemoTarget {
  database: string | undefined;
  env: string | undefined;
  production: boolean;
  remote: boolean;
}

export function parseDemoArgs(argv: readonly string[]): DemoOptions;
export function isProductionTarget(
  target: { database?: string; env?: string },
  productionNames?: readonly string[]
): boolean;
export function resolveDemoTarget(
  options: DemoOptions,
  productionNames?: readonly string[]
): DemoTarget;
