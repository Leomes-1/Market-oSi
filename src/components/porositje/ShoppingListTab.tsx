'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import BarcodeField, { type BarcodeFieldHandle } from '@/components/pos/BarcodeField'
import Modal from '@/components/ui/Modal'
import ErrorState from '@/components/ui/ErrorState'
import { lookupBarcode, refreshCatalog, useCatalog, type CatalogProduct } from '@/lib/catalog'
import { findProducts, searchIndex } from '@/lib/product-search'
import {
  groupBySupplier,
  listTotals,
  planSupplies,
  type ListGroup,
  type PlannedSupply,
  type ShoppingListLine,
} from '@/lib/shopping-list'
import { formatCurrency } from '@/lib/utils'
import { isWeightedUnit } from '@/lib/validation'
import { rowDelayStyle } from '@/lib/animation'
import {
  RiAddLine,
  RiCheckLine,
  RiCloseCircleLine,
  RiDeleteBin6Line,
  RiEditLine,
  RiLayoutGridLine,
  RiListUnordered,
  RiLoader4Line,
  RiRefreshLine,
  RiShoppingCart2Line,
  RiTimeLine,
  RiTruckLine,
} from 'react-icons/ri'

/** Quantity and price edits are saved after this pause in typing. */
const SAVE_PAUSE_MS = 500

type Editable = Partial<Pick<ShoppingListLine, 'sasia' | 'cmimiBlerjes'>>

/** Plain list, or "Ndaj sipas furnitorit". Remembered per browser. */
type View = 'list' | 'grouped'
const VIEW_KEY = 'market-os:lista-blerjeve:view'
/** How long the lines take to slide out before the other view comes in. */
const SWAP_MS = 200

function readView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'grouped' ? 'grouped' : 'list'
  } catch {
    return 'list'
  }
}

function saveView(view: View) {
  try {
    localStorage.setItem(VIEW_KEY, view)
  } catch {
    // Private window or storage blocked: the view just isn't remembered.
  }
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

function getTodayString() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** "Krijo furnizimin" / "Krijo të gjitha furnizimet": the confirm-and-report dialog. */
type SupplyStatus = 'waiting' | 'saving' | 'ok' | 'error'
interface Batch {
  supplies: PlannedSupply[]
  skippedFree: string[]
  skippedZero: number
  status: Record<string, SupplyStatus>
  errors: Record<string, string>
  phase: 'confirm' | 'running' | 'done'
  /** Opened from one supplier's card rather than "Krijo të gjitha". */
  single: boolean
}

/**
 * "Lista e blerjeve" tab: one shared shopping list kept in the database, so it
 * can be built on the PC and ticked off on the phone at the market.
 *
 * Edits show at once and are saved in the background: quantity and price
 * after a short pause in typing, the ✓ and removals straight away. Adding a
 * product that is already listed adds 1 on the server in one statement, so
 * two devices scanning the same thing both count. The list reloads whenever
 * the page comes back into view, keeping any edit still waiting to be saved.
 */
export default function ShoppingListTab() {
  const router = useRouter()
  const { products, findByBarcode } = useCatalog()
  const [lines, setLines] = useState<ShoppingListLine[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState<number | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [opening, setOpening] = useState(false)
  const [freeOpen, setFreeOpen] = useState(false)
  const [free, setFree] = useState({ emri: '', sasia: '1', cmimi: '' })
  const [addingFree, setAddingFree] = useState(false)
  const [view, setView] = useState<View>('list')
  // The lines are sliding out before the view switches.
  const [leaving, setLeaving] = useState(false)
  // Set once the view has been switched here, so only a switch animates in —
  // not the first load.
  const [swapped, setSwapped] = useState(false)
  const swapTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [batch, setBatch] = useState<Batch | null>(null)
  const [removingBought, setRemovingBought] = useState(false)

  const barcodeRef = useRef<BarcodeFieldHandle>(null)
  const qtyRefs = useRef<Map<number, HTMLInputElement>>(new Map())
  const rowRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Edits not yet sent, per line, with their timer.
  const pending = useRef<Map<number, { fields: Editable; timer: ReturnType<typeof setTimeout> }>>(
    new Map()
  )
  // Latest "add" request per product: an older response arriving late must
  // not overwrite a newer count.
  const addSeq = useRef<Map<number, number>>(new Map())

  const linesRef = useRef(lines)
  linesRef.current = lines

  /** Server rows, with any edit still waiting to be saved laid over them. */
  const withPending = useCallback((rows: ShoppingListLine[]) => {
    return rows.map((r) => {
      const p = pending.current.get(r.id)
      return p ? { ...r, ...p.fields } : r
    })
  }, [])

  const fetchList = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true)
      try {
        const res = await fetch('/api/shopping-list')
        if (res.status === 401) {
          window.location.href = '/login'
          return
        }
        if (!res.ok) throw new Error()
        const body = await res.json()
        setLines(withPending(body.items ?? []))
        setError(false)
      } catch {
        if (!quiet) setError(true)
        else toast.error('Lista nuk u rifreskua')
      } finally {
        if (!quiet) setLoading(false)
      }
    },
    [withPending]
  )

  useEffect(() => {
    fetchList()
    // Back on the page (phone unlocked, tab switched): show the other device's changes.
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchList(true)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [fetchList])

  // Leaving the tab with edits still waiting: send them now.
  useEffect(() => {
    const map = pending.current
    return () => {
      map.forEach((p, id) => {
        clearTimeout(p.timer)
        void fetch(`/api/shopping-list/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(p.fields),
          keepalive: true,
        })
      })
      map.clear()
      if (highlightTimer.current) clearTimeout(highlightTimer.current)
      if (swapTimer.current) clearTimeout(swapTimer.current)
    }
  }, [])

  // The remembered view, read once mounted (localStorage isn't there on the server).
  useEffect(() => {
    setView(readView())
  }, [])

  /**
   * Plain list ⇄ grouped. The lines slide right and fade, then the other view
   * comes in (cards one after another). With reduced motion it just switches.
   */
  function toggleView() {
    if (leaving) return
    const next: View = view === 'list' ? 'grouped' : 'list'
    saveView(next)
    setSwapped(true)
    if (prefersReducedMotion()) {
      setView(next)
      return
    }
    setLeaving(true)
    swapTimer.current = setTimeout(() => {
      setView(next)
      setLeaving(false)
    }, SWAP_MS)
  }

  const replaceLine = useCallback((line: ShoppingListLine) => {
    setLines((prev) => {
      const at = prev.findIndex((l) => l.id === line.id)
      if (at < 0) return [...prev, line]
      const next = [...prev]
      next[at] = line
      return next
    })
  }, [])

  function flashLine(id: number) {
    setHighlight(id)
    if (highlightTimer.current) clearTimeout(highlightTimer.current)
    highlightTimer.current = setTimeout(() => setHighlight(null), 1200)
    requestAnimationFrame(() =>
      rowRefs.current.get(id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    )
  }

  // ── Saving edits ─────────────────────────────────────────────────────────

  const flush = useCallback(
    async (id: number) => {
      const p = pending.current.get(id)
      if (!p) return
      clearTimeout(p.timer)
      pending.current.delete(id)
      try {
        const res = await fetch(`/api/shopping-list/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(p.fields),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          toast.error(body.error || 'Ndryshimi nuk u ruajt')
          await fetchList(true)
          return
        }
        const line = (await res.json()) as ShoppingListLine
        // Typed more meanwhile: keep what's on screen, it is queued too.
        if (!pending.current.has(id)) replaceLine(line)
      } catch {
        toast.error('Ndryshimi nuk u ruajt — kontrollo lidhjen')
        await fetchList(true)
      }
    },
    [fetchList, replaceLine]
  )

  const flushAll = useCallback(async () => {
    await Promise.all(Array.from(pending.current.keys()).map((id) => flush(id)))
  }, [flush])

  function edit(id: number, fields: Editable) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...fields } : l)))
    const existing = pending.current.get(id)
    if (existing) clearTimeout(existing.timer)
    pending.current.set(id, {
      fields: { ...existing?.fields, ...fields },
      timer: setTimeout(() => void flush(id), SAVE_PAUSE_MS),
    })
  }

  async function toggleBought(line: ShoppingListLine) {
    const blere = !line.blere
    setLines((prev) => prev.map((l) => (l.id === line.id ? { ...l, blere } : l)))
    try {
      const res = await fetch(`/api/shopping-list/${line.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blere }),
      })
      if (!res.ok) throw new Error()
    } catch {
      toast.error('"Blerë" nuk u ruajt')
      setLines((prev) => prev.map((l) => (l.id === line.id ? { ...l, blere: !blere } : l)))
    }
  }

  async function removeLine(line: ShoppingListLine) {
    const p = pending.current.get(line.id)
    if (p) clearTimeout(p.timer)
    pending.current.delete(line.id)
    setLines((prev) => prev.filter((l) => l.id !== line.id))
    try {
      const res = await fetch(`/api/shopping-list/${line.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
    } catch {
      toast.error('Rreshti nuk u hoq')
      await fetchList(true)
    }
  }

  // ── Adding ───────────────────────────────────────────────────────────────

  async function addProduct(product: CatalogProduct) {
    const listed = linesRef.current.find((l) => l.productId === product.id)

    // A quantity typed on this line and not yet saved: add on top of it here,
    // otherwise the queued value would overwrite the server's +1.
    if (listed && pending.current.get(listed.id)?.fields.sasia !== undefined) {
      const sasia = listed.sasia + 1
      edit(listed.id, { sasia })
      barcodeRef.current?.flash('success', `${product.emri} · ${sasia}`, 900)
      flashLine(listed.id)
      return
    }

    // Show the +1 at once; the server's answer then confirms it.
    if (listed) {
      setLines((prev) => prev.map((l) => (l.id === listed.id ? { ...l, sasia: l.sasia + 1 } : l)))
      flashLine(listed.id)
    }

    const seq = (addSeq.current.get(product.id) ?? 0) + 1
    addSeq.current.set(product.id, seq)
    try {
      const res = await fetch('/api/shopping-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: product.id }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Produkti nuk u shtua')
      }
      const line = (await res.json()) as ShoppingListLine
      if (addSeq.current.get(product.id) === seq && !pending.current.has(line.id)) {
        replaceLine(line)
      }
      barcodeRef.current?.flash('success', `${line.emri} · ${line.sasia}`, 900)
      flashLine(line.id)
    } catch (e) {
      barcodeRef.current?.flash('error', e instanceof Error ? e.message : 'Produkti nuk u shtua', 1500)
      await fetchList(true)
    }
  }

  const onScan = useCallback(
    (code: string) => {
      const found = findByBarcode(code)
      if (found) {
        void addProductRef.current(found)
        return
      }
      barcodeRef.current?.notice('Duke kërkuar...')
      lookupBarcode(code).then(
        (p) => {
          if (p) void addProductRef.current(p)
          else barcodeRef.current?.flash('error', 'Produkti nuk u gjet', 1500)
        },
        () => barcodeRef.current?.flash('error', 'Gabim gjatë kërkimit të barkodit', 1500)
      )
    },
    [findByBarcode]
  )
  // BarcodeField needs stable callbacks; the latest addProduct sits in a ref.
  const addProductRef = useRef(addProduct)
  addProductRef.current = addProduct
  const onPick = useCallback((p: CatalogProduct) => void addProductRef.current(p), [])
  const onQuery = useCallback((q: string) => setQuery(q), [])

  const index = useMemo(() => searchIndex(products), [products])
  const results = useMemo(() => (query.trim() ? findProducts(index, query, 8) : []), [index, query])

  function pickResult(p: CatalogProduct) {
    barcodeRef.current?.clear()
    setQuery('')
    void addProduct(p)
    barcodeRef.current?.focus()
  }

  async function addFreeLine(e: React.FormEvent) {
    e.preventDefault()
    if (!free.emri.trim()) {
      toast.error('Shkruaj emrin')
      return
    }
    setAddingFree(true)
    try {
      const res = await fetch('/api/shopping-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emri: free.emri,
          sasia: free.sasia === '' ? 0 : free.sasia,
          cmimiBlerjes: free.cmimi === '' ? 0 : free.cmimi,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body.error || 'Rreshti nuk u shtua')
        return
      }
      replaceLine(body as ShoppingListLine)
      flashLine((body as ShoppingListLine).id)
      setFree({ emri: '', sasia: '1', cmimi: '' })
    } catch {
      toast.error('Rreshti nuk u shtua — kontrollo lidhjen')
    } finally {
      setAddingFree(false)
    }
  }

  // ── Whole list ───────────────────────────────────────────────────────────

  async function clearList() {
    setClearing(true)
    pending.current.forEach((p) => clearTimeout(p.timer))
    pending.current.clear()
    try {
      const res = await fetch('/api/shopping-list', { method: 'DELETE' })
      if (!res.ok) throw new Error()
      setLines([])
      setConfirmClear(false)
      toast.success('Lista u pastrua')
    } catch {
      toast.error('Lista nuk u pastrua')
      await fetchList(true)
    } finally {
      setClearing(false)
    }
  }

  // Only what was bought (✓) goes into the supply; the rest stays for next time.
  const boughtLines = lines.filter((l) => l.productId !== null && l.blere && l.sasia > 0)
  const boughtFree = lines.filter((l) => l.productId === null && l.blere)

  async function openSupply() {
    if (boughtLines.length === 0) {
      toast.error('Shëno me ✓ produktet që ke blerë, pastaj krijo furnizimin')
      return
    }
    setOpening(true)
    // Shto Furnizim reads the list from the server: save what's typed first.
    await flushAll()
    router.push('/furnizime/i-ri?lista=1')
  }

  // ── Supplies per supplier ────────────────────────────────────────────────

  const groups = useMemo(() => groupBySupplier(lines), [lines])

  /** Opens the confirm dialog for these groups' ✓ lines (one card, or all). */
  function openBatch(target: ListGroup[], single: boolean) {
    const plan = planSupplies(target)
    if (plan.supplies.length === 0) {
      toast.error(
        single
          ? 'Shëno me ✓ produktet e këtij furnitori që ke blerë'
          : 'Shëno me ✓ produktet që ke blerë, pastaj krijo furnizimet'
      )
      return
    }
    setBatch({
      ...plan,
      status: Object.fromEntries(plan.supplies.map((s) => [s.key, 'waiting' as SupplyStatus])),
      errors: {},
      phase: 'confirm',
      single,
    })
  }

  /**
   * One POST /api/supplies per supplier — the same route as Shto Furnizim, so
   * stock, pending prices and the backup snapshot all happen as usual. They
   * run one after another and each stands alone: a failure is recorded and
   * the next one still goes. Not "Me TVSH"; that can be set later on the
   * supply's details. The product's own cost isn't changed (updatePrice off).
   */
  async function runBatch() {
    if (!batch || batch.phase !== 'confirm') return
    const plan = batch.supplies
    setBatch((b) => b && { ...b, phase: 'running' })
    // Edits still waiting are saved first, so the list matches what is sent.
    await flushAll()
    const data = getTodayString()
    let saved = 0

    for (const s of plan) {
      setBatch((b) => b && { ...b, status: { ...b.status, [s.key]: 'saving' } })
      let error: string | null = null
      try {
        const res = await fetch('/api/supplies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            furnitorId: s.furnitorId,
            data,
            shenime: `Nga lista e blerjeve — ${s.title}`,
            items: s.lines.map((l) => ({
              productId: l.productId,
              sasia: l.sasia,
              cmimiBlerjes: l.cmimiBlerjes,
              cmimiShitjes: null,
              updatePrice: false,
            })),
          }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          error = body.error || `Gabim (${res.status})`
        }
      } catch {
        // The request may or may not have reached the server.
        error = 'Gabim rrjeti — kontrollo te Furnizimet nëse u ruajt'
      }
      if (!error) saved++
      setBatch(
        (b) =>
          b && {
            ...b,
            status: { ...b.status, [s.key]: error ? 'error' : 'ok' },
            errors: error ? { ...b.errors, [s.key]: error } : b.errors,
          }
      )
    }

    setBatch((b) => b && { ...b, phase: 'done' })
    if (saved > 0) {
      // Stock changed: the catalogue and the list's "stoku" are stale.
      void refreshCatalog()
      void fetchList(true)
    }
  }

  /** Lines that went into a saved supply. */
  const savedLines = batch
    ? batch.supplies.filter((s) => batch.status[s.key] === 'ok').flatMap((s) => s.lines)
    : []

  async function finishBatch(removeSaved: boolean) {
    if (removeSaved && savedLines.length > 0) {
      setRemovingBought(true)
      try {
        // The server removes only lines that are still ticked.
        const res = await fetch(`/api/shopping-list?bought=${savedLines.map((l) => l.id).join(',')}`, {
          method: 'DELETE',
        })
        if (!res.ok) throw new Error()
        const body = await res.json().catch(() => ({}))
        const n = typeof body.removed === 'number' ? body.removed : savedLines.length
        toast.success(n === 1 ? '1 rresht u hoq nga lista' : `${n} rreshta u hoqën nga lista`)
      } catch {
        toast.error('Rreshtat nuk u hoqën nga lista')
      } finally {
        setRemovingBought(false)
      }
      await fetchList(true)
    }
    setBatch(null)
  }

  // ── Keyboard ─────────────────────────────────────────────────────────────

  // Enter moves down the lines in the order they are on screen.
  const ordered = view === 'grouped' ? groups.flatMap((g) => g.lines) : lines
  const orderIndex = new Map(ordered.map((l, i) => [l.id, i]))

  function focusQty(i: number) {
    const target = ordered[i]
    if (!target) {
      barcodeRef.current?.focus()
      return
    }
    const el = qtyRefs.current.get(target.id)
    if (el) {
      el.focus()
      el.select()
    }
  }

  function onQtyKeyDown(e: React.KeyboardEvent<HTMLInputElement>, i: number) {
    if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault()
      focusQty(i + 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (i > 0) focusQty(i - 1)
    }
  }

  const totals = listTotals(lines)

  /** One line, the same in both views: ✓, name, quantity × price = total, remove. */
  function renderRow(line: ShoppingListLine) {
    const i = orderIndex.get(line.id) ?? 0
    const total = line.sasia * line.cmimiBlerjes
    return (
      <div
        key={line.id}
        ref={(el) => {
          if (el) rowRefs.current.set(line.id, el)
          else rowRefs.current.delete(line.id)
        }}
        className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3 transition-colors ${
          highlight === line.id ? 'bg-blue-50' : line.blere ? 'bg-green-50/50' : ''
        }`}
      >
        <label className="flex items-center justify-center w-8 h-8 -m-1 cursor-pointer flex-shrink-0">
          <input
            type="checkbox"
            checked={line.blere}
            onChange={() => void toggleBought(line)}
            className="w-5 h-5 accent-green-600 cursor-pointer"
            aria-label={`Blerë: ${line.emri}`}
            title="Blerë"
          />
        </label>

        <div className="flex-1 min-w-0 basis-[calc(100%-5.5rem)] sm:basis-0">
          <p
            className={`text-sm font-medium truncate ${
              line.blere ? 'line-through text-slate-400' : 'text-slate-800'
            }`}
          >
            {line.emri}
          </p>
          <p className="text-xs text-slate-400">
            {line.productId === null ? (
              <span className="text-amber-600">jo në katalog</span>
            ) : (
              <>
                {line.njesia}
                {line.stoku !== null && ` · stoku ${line.stoku}`}
              </>
            )}
          </p>
        </div>

        <button
          type="button"
          onClick={() => void removeLine(line)}
          title="Hiq nga lista"
          aria-label={`Hiq ${line.emri}`}
          className="order-2 sm:order-last p-2 -m-1 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
        >
          <RiDeleteBin6Line />
        </button>

        <div className="order-3 sm:order-2 w-full sm:w-auto flex items-center gap-2 pl-10 sm:pl-0">
          <input
            ref={(el) => {
              if (el) qtyRefs.current.set(line.id, el)
              else qtyRefs.current.delete(line.id)
            }}
            type="number"
            inputMode="decimal"
            min="0"
            step={line.productId === null || isWeightedUnit(line.njesia) ? 'any' : '1'}
            value={line.sasia === 0 ? '' : line.sasia}
            placeholder="0"
            onChange={(e) => edit(line.id, { sasia: Math.max(0, Number(e.target.value) || 0) })}
            onKeyDown={(e) => onQtyKeyDown(e, i)}
            onFocus={(e) => e.target.select()}
            enterKeyHint="next"
            className="input py-1.5 text-sm text-center w-20 tabular-nums"
            aria-label={`Sasia: ${line.emri}`}
          />
          <span className="text-slate-300 text-sm">×</span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={line.cmimiBlerjes}
            onChange={(e) => edit(line.id, { cmimiBlerjes: Math.max(0, Number(e.target.value) || 0) })}
            onFocus={(e) => e.target.select()}
            className="input py-1.5 text-sm text-right w-24 tabular-nums"
            aria-label={`Çmimi i blerjes: ${line.emri}`}
            title="Çmimi i blerjes — vetëm për këtë listë, produkti nuk ndryshon"
          />
          <span className="ml-auto sm:ml-0 sm:w-24 text-right text-sm font-semibold text-slate-800 tabular-nums">
            {total > 0 ? formatCurrency(total) : <span className="text-slate-300">—</span>}
          </span>
        </div>
      </div>
    )
  }

  /** One supplier's card in the grouped view. */
  function renderGroup(g: ListGroup, index: number) {
    const t = listTotals(g.lines)
    const ticked = g.lines.filter((l) => l.blere && l.sasia > 0).length
    return (
      <section
        key={g.key}
        className="card overflow-hidden anim-view-in"
        style={rowDelayStyle(index, 0.05)}
        aria-label={g.title}
      >
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5 bg-slate-50 border-b border-slate-100">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {g.kind === 'free' ? (
              <RiEditLine className="text-slate-400 flex-shrink-0" />
            ) : (
              <RiTruckLine className={`flex-shrink-0 ${g.kind === 'none' ? 'text-slate-300' : 'text-slate-400'}`} />
            )}
            <h3 className="font-semibold text-slate-800 truncate">{g.title}</h3>
            <span className="text-xs text-slate-400 whitespace-nowrap">{g.lines.length} rreshta</span>
          </div>
          {g.kind !== 'free' && (
            <button
              type="button"
              onClick={() => openBatch([g], true)}
              disabled={batch !== null}
              className="btn-primary text-sm py-1.5 px-3 flex items-center gap-1.5 whitespace-nowrap"
            >
              <RiTruckLine />
              Krijo furnizimin ({ticked})
            </button>
          )}
          <div className="w-full flex flex-wrap gap-x-4 gap-y-0.5 text-xs tabular-nums">
            <span className="text-slate-600">
              Gjithsej <b className="text-slate-900">{formatCurrency(t.total)}</b>
            </span>
            <span className="text-green-700">
              Blerë <b>{formatCurrency(t.blere)}</b>
            </span>
            <span className="text-amber-700">
              Mbetur <b>{formatCurrency(t.mbetur)}</b>
            </span>
            {g.kind === 'free' && <span className="text-slate-400">nuk shkojnë në furnizim</span>}
          </div>
        </header>
        <div className="divide-y divide-slate-100">{g.lines.map((l) => renderRow(l))}</div>
      </section>
    )
  }

  const batchDone = batch?.phase === 'done'
  const batchFailed = batch ? batch.supplies.filter((s) => batch.status[s.key] === 'error') : []

  return (
    <div className="max-w-4xl">
      {/* Totals — stay in view while scrolling a long list on the phone */}
      <div className="card p-3 sm:p-4 mb-4 sticky top-0 z-20">
        <div className="grid grid-cols-3 gap-2 text-center sm:text-left">
          <div>
            <p className="text-[11px] sm:text-xs text-slate-500 leading-tight">Para që të duhen</p>
            <p className="text-base sm:text-xl font-bold text-slate-900 tabular-nums">
              {formatCurrency(totals.total)}
            </p>
          </div>
          <div>
            <p className="text-[11px] sm:text-xs text-slate-500 leading-tight">Blerë</p>
            <p className="text-base sm:text-xl font-bold text-green-700 tabular-nums">
              {formatCurrency(totals.blere)}
            </p>
          </div>
          <div>
            <p className="text-[11px] sm:text-xs text-slate-500 leading-tight">Mbetur</p>
            <p className="text-base sm:text-xl font-bold text-amber-700 tabular-nums">
              {formatCurrency(totals.mbetur)}
            </p>
          </div>
        </div>
      </div>

      {/* Add: scan or search, in one field like the POS */}
      <div className="card p-3 sm:p-4 mb-4">
        <BarcodeField
          ref={barcodeRef}
          onScan={onScan}
          onPick={onPick}
          onQuery={onQuery}
          products={products}
          findByBarcode={findByBarcode}
          autoFocus
          placeholder="Skano barkodin ose kërko produktin..."
        />

        {results.length > 0 && (
          <ul className="mt-2 divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
            {results.map((p) => {
              const listed = lines.find((l) => l.productId === p.id)
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => pickResult(p)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-blue-50 active:bg-blue-100 transition-colors"
                  >
                    <RiAddLine className="text-blue-500 flex-shrink-0" />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium text-slate-800 truncate">{p.emri}</span>
                      <span className="block text-xs text-slate-400">
                        {p.njesia}
                        {p.cmimiBlerjes != null && ` · ${formatCurrency(p.cmimiBlerjes)}`}
                      </span>
                    </span>
                    {listed && (
                      <span className="badge-gray whitespace-nowrap">në listë: {listed.sasia}</span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        <div className="mt-3">
          {freeOpen ? (
            <form onSubmit={addFreeLine} className="flex flex-wrap gap-2 items-end">
              <input
                type="text"
                value={free.emri}
                onChange={(e) => setFree((f) => ({ ...f, emri: e.target.value }))}
                placeholder="Emri (jo në katalog)"
                maxLength={120}
                autoFocus
                className="input text-sm flex-1 min-w-[10rem]"
                aria-label="Emri i rreshtit të lirë"
              />
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={free.sasia}
                onChange={(e) => setFree((f) => ({ ...f, sasia: e.target.value }))}
                placeholder="Sasia"
                className="input text-sm w-20 text-center tabular-nums"
                aria-label="Sasia"
              />
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={free.cmimi}
                onChange={(e) => setFree((f) => ({ ...f, cmimi: e.target.value }))}
                placeholder="Çmimi"
                className="input text-sm w-24 text-right tabular-nums"
                aria-label="Çmimi i blerjes"
              />
              <button type="submit" disabled={addingFree} className="btn-primary text-sm flex items-center gap-1.5">
                {addingFree ? <RiLoader4Line className="animate-spin" /> : <RiAddLine />}
                Shto
              </button>
              <button type="button" onClick={() => setFreeOpen(false)} className="btn-secondary text-sm">
                Mbyll
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setFreeOpen(true)}
              className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1.5"
            >
              <RiEditLine />
              Shto rresht të lirë (jo në katalog)
            </button>
          )}
        </div>
      </div>

      {/* Lines */}
      {loading ? (
        <div className="card p-10 text-center text-slate-400 text-sm">Duke ngarkuar...</div>
      ) : error ? (
        <div className="card overflow-hidden">
          <ErrorState message="Gabim gjatë ngarkimit të listës" onRetry={() => fetchList()} />
        </div>
      ) : lines.length === 0 ? (
        <div className="card p-12 text-center">
          <RiShoppingCart2Line className="text-4xl text-slate-200 mx-auto mb-3" />
          <p className="text-slate-400 text-sm">Lista është bosh — skano ose kërko një produkt</p>
        </div>
      ) : (
        // Slides right and fades before the view switches; the other view then
        // comes in (anim-view-in, off under reduced motion).
        <div
          className={`transition-[transform,opacity] duration-200 ease-in motion-reduce:transition-none ${
            leaving ? 'translate-x-10 opacity-0' : ''
          }`}
        >
          {view === 'grouped' ? (
            <div key="grouped" className="space-y-4">
              {groups.map((g, gi) => renderGroup(g, gi))}
            </div>
          ) : (
            <div
              key="list"
              className={`card divide-y divide-slate-100 overflow-hidden ${swapped ? 'anim-view-in' : ''}`}
            >
              {lines.map((l) => renderRow(l))}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      {lines.length > 0 && (
        <div className="mt-4 flex flex-col sm:flex-row sm:items-start gap-3">
          <button
            type="button"
            onClick={() => fetchList(true)}
            className="btn-secondary flex items-center justify-center gap-2"
          >
            <RiRefreshLine />
            Rifresko
          </button>
          <button
            type="button"
            onClick={() => setConfirmClear(true)}
            className="btn-secondary flex items-center justify-center gap-2 text-red-600"
          >
            <RiDeleteBin6Line />
            Pastro listën
          </button>
          <div className="sm:ml-auto flex flex-col sm:items-end gap-1">
            <div className="flex flex-col-reverse sm:flex-row gap-2">
              <button
                type="button"
                onClick={toggleView}
                disabled={leaving}
                aria-pressed={view === 'grouped'}
                className="btn-secondary flex items-center justify-center gap-2"
              >
                {view === 'grouped' ? <RiListUnordered /> : <RiLayoutGridLine />}
                {view === 'grouped' ? 'Shfaq listën' : 'Ndaj sipas furnitorit'}
              </button>
              {view === 'grouped' ? (
                <button
                  type="button"
                  onClick={() => openBatch(groups, false)}
                  disabled={batch !== null}
                  className="btn-primary flex items-center justify-center gap-2"
                >
                  <RiTruckLine />
                  Krijo të gjitha furnizimet ({boughtLines.length})
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void openSupply()}
                  disabled={opening}
                  className="btn-primary flex items-center justify-center gap-2"
                >
                  {opening ? <RiLoader4Line className="animate-spin" /> : <RiTruckLine />}
                  Krijo furnizimin ({boughtLines.length})
                </button>
              )}
            </div>
            <p className="text-xs text-slate-500">
              {boughtLines.length === 0
                ? 'Merr vetëm produktet e shënuara me ✓'
                : 'Vetëm produktet e shënuara me ✓'}
              {boughtFree.length > 0 &&
                ` · ${boughtFree.length} ${boughtFree.length === 1 ? 'rresht' : 'rreshta'} jo në katalog nuk shkon${
                  boughtFree.length === 1 ? '' : 'jnë'
                } në furnizim`}
            </p>
          </div>
        </div>
      )}

      <Modal isOpen={confirmClear} onClose={() => !clearing && setConfirmClear(false)} title="Pastro listën" size="sm">
        <p className="text-sm text-slate-600 mb-5">
          Të fshihen të gjitha {lines.length} rreshtat e listës së blerjeve? Kjo nuk kthehet mbrapsht.
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setConfirmClear(false)} disabled={clearing} className="btn-secondary">
            Anulo
          </button>
          <button
            type="button"
            onClick={() => void clearList()}
            disabled={clearing}
            className="btn-danger flex items-center gap-2"
          >
            {clearing && <RiLoader4Line className="animate-spin" />}
            Po, pastro
          </button>
        </div>
      </Modal>

      <Modal
        isOpen={batch !== null}
        onClose={() => {
          // Never while supplies are being saved; once done, closing keeps the lines.
          if (!batch || batch.phase === 'running' || removingBought) return
          void finishBatch(false)
        }}
        title={
          batchDone
            ? 'Furnizimet'
            : batch?.single
            ? `Krijo furnizimin — ${batch.supplies[0]?.title ?? ''}`
            : 'Krijo të gjitha furnizimet'
        }
        size="md"
      >
        {batch && (
          <div>
            {batch.phase === 'confirm' && (
              <p className="text-sm text-slate-600 mb-3">
                {batch.supplies.length === 1
                  ? 'Do të krijohet 1 furnizim nga rreshtat e shënuar me ✓:'
                  : `Do të krijohen ${batch.supplies.length} furnizime, një për çdo furnitor, nga rreshtat e shënuar me ✓:`}
              </p>
            )}

            <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden mb-3">
              {batch.supplies.map((s) => {
                const st = batch.status[s.key]
                return (
                  <li key={s.key} className="flex items-start gap-3 px-3 py-2.5">
                    <span className="mt-0.5 flex-shrink-0" aria-hidden>
                      {st === 'ok' ? (
                        <RiCheckLine className="text-green-600" />
                      ) : st === 'error' ? (
                        <RiCloseCircleLine className="text-red-500" />
                      ) : st === 'saving' ? (
                        <RiLoader4Line className="animate-spin text-blue-500" />
                      ) : batch.phase === 'confirm' ? (
                        <RiTruckLine className="text-slate-400" />
                      ) : (
                        <RiTimeLine className="text-slate-300" />
                      )}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium text-slate-800 truncate">{s.title}</span>
                      <span className="block text-xs text-slate-500">
                        {s.lines.length} {s.lines.length === 1 ? 'rresht' : 'rreshta'}
                        {st === 'ok' && ' · u ruajt'}
                        {st === 'saving' && ' · duke ruajtur...'}
                      </span>
                      {st === 'error' && (
                        <span className="block text-xs text-red-600 mt-0.5">
                          Nuk u ruajt: {batch.errors[s.key]}
                        </span>
                      )}
                    </span>
                    <span className="text-sm font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                      {formatCurrency(s.total)}
                    </span>
                  </li>
                )
              })}
            </ul>

            {batch.phase === 'confirm' && (
              <p className="text-xs text-slate-500 mb-1">
                Gjithsej {formatCurrency(batch.supplies.reduce((sum, s) => sum + s.total, 0))} · data e sotme · pa
                TVSH (mund ta shënosh më vonë te detajet e furnizimit) · çmimi i produktit nuk ndryshon.
              </p>
            )}
            {batch.skippedFree.length > 0 && (
              <p className="text-xs text-amber-700 mb-1">
                Nuk janë në katalog, prandaj nuk shkojnë në furnizim: {batch.skippedFree.join(', ')}
              </p>
            )}
            {batch.skippedZero > 0 && (
              <p className="text-xs text-slate-500 mb-1">
                {batch.skippedZero} {batch.skippedZero === 1 ? 'rresht me ✓ ka' : 'rreshta me ✓ kanë'} sasi 0 dhe
                {batch.skippedZero === 1 ? ' lihet' : ' lihen'} jashtë.
              </p>
            )}

            {batchDone && (
              <div className="mt-3 text-sm">
                {batchFailed.length > 0 && (
                  <p className="text-red-600 mb-2">
                    {batchFailed.length === 1 ? 'Dështoi: ' : 'Dështuan: '}
                    {batchFailed.map((s) => s.title).join(', ')}. Rreshtat e tyre mbeten në listë; të tjerat nuk u
                    prekën.
                  </p>
                )}
                {savedLines.length > 0 ? (
                  <>
                    <p className="text-slate-700">
                      Të hiqen nga lista {savedLines.length === 1 ? '1 rresht' : `${savedLines.length} rreshtat`} me ✓
                      që hynë në furnizime?
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      Nëse i mban, herën tjetër do të përfshihen sërish në furnizim.
                    </p>
                  </>
                ) : (
                  <p className="text-slate-700">Asnjë furnizim nuk u ruajt.</p>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 mt-5">
              {batch.phase === 'confirm' && (
                <>
                  <button type="button" onClick={() => setBatch(null)} className="btn-secondary">
                    Anulo
                  </button>
                  <button
                    type="button"
                    onClick={() => void runBatch()}
                    className="btn-primary flex items-center gap-2"
                  >
                    <RiCheckLine />
                    {batch.supplies.length === 1 ? 'Krijo furnizimin' : `Krijo ${batch.supplies.length} furnizime`}
                  </button>
                </>
              )}
              {batch.phase === 'running' && (
                <span className="text-sm text-slate-500 flex items-center gap-2">
                  <RiLoader4Line className="animate-spin" />
                  Duke ruajtur — mos e mbyll faqen
                </span>
              )}
              {batchDone &&
                (savedLines.length > 0 ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void finishBatch(false)}
                      disabled={removingBought}
                      className="btn-secondary"
                    >
                      Jo, mbaji
                    </button>
                    <button
                      type="button"
                      onClick={() => void finishBatch(true)}
                      disabled={removingBought}
                      className="btn-danger flex items-center gap-2"
                    >
                      {removingBought && <RiLoader4Line className="animate-spin" />}
                      Po, hiqi
                    </button>
                  </>
                ) : (
                  <button type="button" onClick={() => void finishBatch(false)} className="btn-secondary">
                    Mbyll
                  </button>
                ))}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
