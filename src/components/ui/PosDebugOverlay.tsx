'use client'

import { useEffect, useState } from 'react'
import { posDebugEnabled, useScanReport } from '@/lib/pos-debug'

/**
 * TEMPORARY: last-scan timings on the POS, shown only with `?debug=1`.
 * See lib/pos-debug.ts. Re-renders on its own; the POS page never does for it.
 */
export default function PosDebugOverlay() {
  // Decided after mount, so server and first client render agree.
  const [on, setOn] = useState(false)
  useEffect(() => setOn(posDebugEnabled()), [])
  const r = useScanReport()
  if (!on) return null

  const fmt = (n: number | null) => (n === null ? '—' : `${n.toFixed(1)} ms`)
  const list = (o: Record<string, number>) =>
    Object.keys(o).length === 0
      ? 'none'
      : Object.entries(o)
          .map(([k, v]) => `${k} ×${v}`)
          .join(', ')

  return (
    <div className="no-print fixed bottom-3 left-3 z-[60] max-w-md rounded-lg bg-slate-900/90 px-3 py-2 font-mono text-[11px] leading-relaxed text-slate-100 shadow-lg pointer-events-none">
      <div className="font-bold text-amber-300">POS debug — last scan</div>
      {r ? (
        <>
          <div>code {r.code} ({r.chars} chars)</div>
          <div>first key → Enter: {fmt(r.typingMs)}</div>
          <div>Enter → cart committed: {fmt(r.enterToCommitMs)}</div>
          <div>style + layout for it: {fmt(r.layoutMs)}</div>
          <div>Enter → main thread free: {fmt(r.enterToIdleMs)}</div>
          <div>renders while typing: {list(r.rendersTyping)}</div>
          <div>renders after Enter: {list(r.rendersAfterEnter)}</div>
          <div>long tasks: {r.longTasks} ({r.longTasksMs} ms)</div>
        </>
      ) : (
        <div>scan a barcode…</div>
      )}
    </div>
  )
}
