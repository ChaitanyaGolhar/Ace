/** Key-order-independent equality of two flat rows (used to detect "did anything change"). */
export function sameRow(a: object, b: object): boolean {
  const canonical = (row: object) =>
    JSON.stringify(Object.entries(row).sort(([x], [y]) => (x < y ? -1 : 1)));
  return canonical(a) === canonical(b);
}
