import { useEffect, useState, type CSSProperties } from 'react'

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

/** Inline style that staggers a CSS entry animation (globals.css `anim-*`). */
export function rowDelayStyle(index: number, step = 0.02): CSSProperties {
  return { animationDelay: `${rowDelay(index, step)}s` }
}

/**
 * Mount/unmount with an exit transition, without an animation library.
 *
 * `entering` is the first frame after mounting (render the hidden state, so
 * the browser has something to transition from); `entered` is shown;
 * `leaving` is the exit, after which the element is unmounted. Style each
 * phase with plain CSS transitions.
 */
export type PresencePhase = 'entering' | 'entered' | 'leaving'

export function usePresence(open: boolean, exitMs: number) {
  const [mounted, setMounted] = useState(open)
  const [phase, setPhase] = useState<PresencePhase>(open ? 'entering' : 'leaving')

  useEffect(() => {
    if (open) {
      setMounted(true)
      setPhase((p) => (p === 'entered' ? p : 'entering'))
      // Two frames: the hidden state must be painted before switching.
      let second = 0
      const first = requestAnimationFrame(() => {
        second = requestAnimationFrame(() => setPhase('entered'))
      })
      return () => {
        cancelAnimationFrame(first)
        cancelAnimationFrame(second)
      }
    }
    setPhase('leaving')
    const t = setTimeout(() => setMounted(false), exitMs)
    return () => clearTimeout(t)
  }, [open, exitMs])

  return { mounted, phase }
}
