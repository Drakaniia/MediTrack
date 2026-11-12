/** A problem the operator can fix (bad flag, unsafe target, invalid input): printed without a stack. */
export class SeedError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "SeedError";
  }
}
