import * as uqr from "uqr";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { qrMatrixForBatch, qrPathData } from "./label-qr";

vi.mock("uqr", async (importOriginal) => {
  const original = await importOriginal<typeof import("uqr")>();
  return { ...original, encode: vi.fn(original.encode) };
});

const encodeSpy = vi.mocked(uqr.encode);

beforeEach(() => {
  encodeSpy.mockClear();
});

describe("qrMatrixForBatch", () => {
  it("encodes only the normalised batch code", () => {
    const matrix = qrMatrixForBatch("mt:abcde-fghjk");
    expect(matrix.payload).toBe("ABCDEFGHJK");
    expect(encodeSpy).toHaveBeenCalledOnce();
    expect(encodeSpy.mock.calls[0]?.[0]).toBe("ABCDEFGHJK");
  });

  it("produces the same square matrix as encoding that payload directly", () => {
    const matrix = qrMatrixForBatch("ABCDEFGHJK");
    const direct = uqr.encode("ABCDEFGHJK", { border: 0, ecc: "M" });
    expect(matrix.modules).toEqual(direct.data);
    expect(matrix.size).toBe(direct.size);
    expect(matrix.modules).toHaveLength(matrix.size);
    expect(matrix.modules.every((row) => row.length === matrix.size)).toBe(true);
  });

  it("fits a ten character code in the smallest symbol", () => {
    expect(qrMatrixForBatch("ABCDEFGHJK").size).toBe(21);
  });
});

describe("qrPathData", () => {
  it("draws each horizontal run of dark modules as one rectangle", () => {
    expect(
      qrPathData([
        [true, true, false, true],
        [false, false, false, false],
        [false, true, true, true],
      ])
    ).toBe("M0 0h2v1h-2zM3 0h1v1h-1zM1 2h3v1h-3z");
  });

  it("is empty for a blank matrix", () => {
    expect(qrPathData([[false, false]])).toBe("");
  });
});
