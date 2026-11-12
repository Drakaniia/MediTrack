import { qrPayloadForBatch } from "@shared/batch-code";
import { encode } from "uqr";

/**
 * Client-side QR for a batch label. The QR carries ONLY the normalised batch code
 * (`qrPayloadForBatch`): no name, no quantity, nothing that could go stale or leak.
 */

/** Medium error correction survives a smudged or creased label. */
const ERROR_CORRECTION = "M";

export interface QrMatrix {
  /** `true` = dark module. */
  modules: boolean[][];
  payload: string;
  size: number;
}

export function qrMatrixForBatch(code: string): QrMatrix {
  const payload = qrPayloadForBatch(code);
  const { data, size } = encode(payload, { border: 0, ecc: ERROR_CORRECTION });
  return { modules: data, payload, size };
}

/** SVG path data with one rectangle per horizontal run of dark modules. */
export function qrPathData(modules: readonly (readonly boolean[])[]): string {
  const parts: string[] = [];
  for (const [y, row] of modules.entries()) {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < row.length && row[x]) {
        x += 1;
      }
      parts.push(`M${start} ${y}h${x - start}v1h-${x - start}z`);
    }
  }
  return parts.join("");
}
