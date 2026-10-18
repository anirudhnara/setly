/**
 * Distance ↔ priority in the 3D vibe space. The person sits at the center: dragged inside INNER is "this is so me",
 * beyond OUTER is "not me at all". Pure, so the browser and tests share it.
 */
export const INNER = 50;
export const OUTER = 270;

export function weightForDistance(distance: number) {
  return Math.min(1, Math.max(0, 1 - (distance - INNER) / (OUTER - INNER)));
}
