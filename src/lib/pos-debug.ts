'use client'

import { useSyncExternalStore } from 'react'

/**
 * TEMPORARY scan instrumentation for the POS, on only with `?debug=1`.
 *
 * Measures the last barcode scan: first keystroke → Enter; Enter → the cart
 * committed; the style/layout that commit cost; Enter → main thread free; how
 * many times each instrumented component rendered while typing and after
 * Enter; and main-thread long tasks in that window. requestAnimationFrame is
 * deliberately not used: Chrome throttles it to 1 Hz in a window that isn't
 * on screen, which would make the numbers meaningless.
 * Every function is a no-op when debug is off, so it costs nothing otherwise.
 *
 * Remove this file and its calls once the scan path is confirmed fast.
 */

export interface ScanReport {
  code: string
  chars: number
  typingMs: number
  enterToCommitMs: number | null
  /** Style + layout the browser needed for that commit (forced right after it). */
  layoutMs: number | null
  /** Enter until the main thread is free again: what the cashier waits for. */
  enterToIdleMs: number | null
  rendersTyping: Record<string, number>
  rendersAfterEnter: Record<string, number>
  longTasksMs: number
  longTasks: number
}

let enabled: boolean | null = null

export function posDebugEnabled(): boolean {
  if (enabled === null) {
    try {
      enabled = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === '1'
    } catch {
      enabled = false
    }
  }
  return enabled
}

let counts: Record<string, number> = {}
let typingCounts: Record<string, number> = {}
let scan: { firstKey: number; enter: number | null; chars: number; code: string; committed: number | null } | null = null
let longTaskMs = 0
let longTaskCount = 0
let observer: PerformanceObserver | null = null

let report: ScanReport | null = null
const listeners = new Set<() => void>()

function startObserver() {
  if (observer || typeof PerformanceObserver === 'undefined') return
  try {
    observer = new PerformanceObserver((list) => {
      if (!scan) return
      for (const entry of list.getEntries()) {
        if (entry.startTime >= scan.firstKey - 1) {
          longTaskMs += entry.duration
          longTaskCount++
        }
      }
    })
    observer.observe({ type: 'longtask', buffered: false })
  } catch {
    observer = null
  }
}

/** Call at the top of a component's render. */
export function countRender(name: string) {
  if (!posDebugEnabled()) return
  counts[name] = (counts[name] ?? 0) + 1
}

/** A character arrived in the barcode field. The first one starts a scan. */
export function markKey() {
  if (!posDebugEnabled()) return
  startObserver()
  if (!scan || scan.enter !== null) {
    counts = {}
    longTaskMs = 0
    longTaskCount = 0
    scan = { firstKey: performance.now(), enter: null, chars: 0, code: '', committed: null }
  }
  scan.chars++
}

/** Enter was pressed with `code`. */
export function markEnter(code: string) {
  if (!posDebugEnabled() || !scan || scan.enter !== null) return
  scan.enter = performance.now()
  scan.code = code
  typingCounts = { ...counts }
}

/** The cart changed and was committed to the DOM (call from a layout effect). */
export function markCartCommitted() {
  if (!posDebugEnabled() || !scan || scan.enter === null || scan.committed !== null) return
  const s = scan
  s.committed = performance.now()
  // Force style + layout now, to time what the commit costs the browser.
  const layoutStart = performance.now()
  void document.body.getBoundingClientRect().height
  const layoutMs = performance.now() - layoutStart
  // A message-channel task runs as soon as the main thread is free.
  const channel = new MessageChannel()
  channel.port1.onmessage = () => {
    const after: Record<string, number> = {}
    for (const [k, v] of Object.entries(counts)) {
      const d = v - (typingCounts[k] ?? 0)
      if (d) after[k] = d
    }
    report = {
      code: s.code,
      chars: s.chars,
      typingMs: (s.enter ?? s.firstKey) - s.firstKey,
      enterToCommitMs: s.committed! - s.enter!,
      layoutMs,
      enterToIdleMs: performance.now() - s.enter!,
      rendersTyping: { ...typingCounts },
      rendersAfterEnter: after,
      longTasksMs: Math.round(longTaskMs),
      longTasks: longTaskCount,
    }
    ;(window as unknown as { __posScanReport?: ScanReport }).__posScanReport = report
    listeners.forEach((l) => l())
  }
  channel.port2.postMessage(null)
}

export function useScanReport(): ScanReport | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => report,
    () => null
  )
}
