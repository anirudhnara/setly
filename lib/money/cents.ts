/**
 * Splits `total` cents across `weights`.
 * Each share is the floor of its proportion. Leftover cents go one each to the
 * largest weights, and equal weights break toward the earlier index.
 */
export function splitCents(total: number, weights: number[]): number[] {
  if (weights.length === 0 || total <= 0) return weights.map(() => 0);
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  if (weightTotal <= 0) return weights.map(() => 0);
  const shares = weights.map((weight) => Math.floor((total * weight) / weightTotal));
  let remainder = total - shares.reduce((sum, share) => sum + share, 0);
  const order = weights
    .map((weight, index) => ({ weight, index }))
    .sort((left, right) => right.weight - left.weight || left.index - right.index);
  for (const entry of order) {
    if (remainder <= 0) break;
    shares[entry.index] += 1;
    remainder -= 1;
  }
  return shares;
}
