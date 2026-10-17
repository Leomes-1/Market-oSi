/**
 * Entry-animation delay for a row at `index`.
 *
 * The delay used to be `index * step` with no ceiling, so a 389-row product
 * table only finished animating 7.8 seconds after it rendered — and because
 * the list re-mounts on every search keystroke, the whole thing restarted on
 * each character. That read as "the page is slow and the rows keep flickering".
 *
 * Capping the stagger keeps the effect on the rows a person actually sees
 * first, and makes everything below appear immediately.
 */
const MAX_STAGGERED_ROWS = 12

export function rowDelay(index: number, step = 0.02): number {
  return Math.min(index, MAX_STAGGERED_ROWS) * step
}
