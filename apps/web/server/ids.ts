/** A new random id (UUID v4) for any row with a TEXT primary key. */
export function newId(): string {
  return crypto.randomUUID();
}
