export const ID_PLACEHOLDER: string;

export interface D1Block {
  env: string | undefined;
  id: string;
  name: string;
}

export interface D1Target {
  database?: string;
  env?: string;
  remote: boolean;
}

export function readD1Blocks(toml: string): D1Block[];
export function resolveRemoteBlock(target: {
  blocks?: D1Block[];
  database?: string;
  env?: string;
}): D1Block;
export function d1ExecuteArgs(target: D1Target): string[];
export function describeTarget(target: D1Target): string;
export function parseWranglerJson(
  stdout: string
): { results?: Record<string, unknown>[] }[];
