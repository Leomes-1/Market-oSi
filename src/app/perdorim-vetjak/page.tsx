'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { useRole } from '@/contexts/RoleContext'
import AccessDenied from '@/components/AccessDenied'
import PageHeader from '@/components/ui/PageHeader'
import SearchInput, { type SearchInputHandle } from '@/components/ui/SearchInput'
import TableSkeleton from '@/components/ui/TableSkeleton'
import ErrorState from '@/components/ui/ErrorState'
import Modal from '@/components/ui/Modal'
import { useCatalog, type CatalogProduct } from '@/lib/catalog'
import { formatCurrency, formatDate } from '@/lib/utils'
import { rowDelayStyle } from '@/lib/animation'
import Collapse from '@/components/ui/Collapse'
import { isWeightedUnit, tracksStock } from '@/lib/validation'
import {
  RiHomeHeartLine,
  RiDeleteBin6Line,
  RiAddLine,
  RiLoader4Line,
  RiArrowRightSLine,
  RiShoppingBasket2Line,
} from 'react-icons/ri'

interface EntryItem {
  id: number
  productId: number
  emriProduktit: string
  sasia: number
  njesia: string
  cmimiBlerjes: number
  totali: number
}

interface Entry {
  id: number
  data: string
  userEmail: string
  shenime: string | null
  totali: number
  items: EntryItem[]
}

interface MonthTotal {
  muaji: string
  totali: number
  numri: number
}

/** One product queued for the current registration. */
interface CartLine {
  productId: number
  emri: string
  njesia: string
  cmimiBlerjes: number
  sasiaAktuale: number
  sasia: number
}

const MUAJT = ['Jan', 'Shk', 'Mar', 'Pri', 'Maj', 'Qer', 'Kor', 'Gus', 'Sht', 'Tet', 'Nën', 'Dhj']

function monthLabel(key: string) {
  const [y, m] = key.split('-')
  return `${MUAJT[Number(m) - 1] ?? m} ${y}`
}

function todayString() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function qtyStep(njesia: string) {
  return isWeightedUnit(njesia) ? '0.001' : '1'
}

/**
 * Personal use, entered like the POS cart: one scan field, a list of lines,
 * and a single save. Several products therefore land in one registration
 * instead of forcing a separate one per product.
 */
export default function PerdorimVetjakPage() {
  const { role } = useRole()
  const { products, findByBarcode, search, refresh: refreshCatalog } = useCatalog()

  const [entries, setEntries] = useState<Entry[]>([])
  const [muajt, setMuajt] = useState<MonthTotal[]>([])
  const [totali, setTotali] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const [nga, setNga] = useState('')
  const [deri, setDeri] = useState('')

  // Current registration
  const [kerkimi, setKerkimi] = useState('')
  const [lines, setLines] = useState<CartLine[]>([])
  const [data, setData] = useState(todayString())
  const [shenime, setShenime] = useState('')
  const [saving, setSaving] = useState(false)

  const [toDelete, setToDelete] = useState<Entry | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  const searchRef = useRef<SearchInputHandle>(null)
  const qtyRefs = useRef<Map<number, HTMLInputElement>>(new Map())

  const fetchEntries = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const params = new URLSearchParams()
      if (nga) params.set('nga', nga)
      if (deri) params.set('deri', deri)
      const res = await fetch(`/api/personal-use?${params}`)
      if (res.status === 401) {
        window.location.href = '/login'
        return
      }
      if (!res.ok) throw new Error()
      const body = await res.json()
      setEntries(body.entries ?? [])
      setMuajt(body.muajt ?? [])
      setTotali(body.totali ?? 0)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [nga, deri])

  useEffect(() => {
    fetchEntries()
  }, [fetchEntries])

  // The catalogue withholds cost from cashiers, but personal use shows it to
  // them, so the preview reads costs from their own endpoint instead.
  const [costs, setCosts] = useState<Record<number, number>>({})
  const fetchCosts = useCallback(async () => {
    try {
      const res = await fetch('/api/personal-use/costs')
      if (res.ok) setCosts(await res.json())
    } catch {
      // Preview falls back to the catalogue's cost, if it has one.
    }
  }, [])

  useEffect(() => {
    fetchCosts()
  }, [fetchCosts])

  // Read at render, so a line added before the costs arrived still updates.
  const lineCost = useCallback(
    (l: CartLine) => costs[l.productId] ?? l.cmimiBlerjes,
    [costs]
  )

  const suggestions = useMemo(() => {
    if (!kerkimi.trim()) return []
    return search(kerkimi).slice(0, 8)
  }, [search, kerkimi])

  /** Adds the product, or bumps its quantity when it is already in the list. */
  const addLine = useCallback((p: CatalogProduct) => {
    setLines((prev) => {
      const at = prev.findIndex((l) => l.productId === p.id)
      if (at >= 0) {
        const next = [...prev]
        next[at] = { ...next[at], sasia: Number((next[at].sasia + 1).toFixed(3)) }
        return next
      }
      return [
        ...prev,
        {
          productId: p.id,
          emri: p.emri,
          njesia: p.njesia,
          cmimiBlerjes: p.cmimiBlerjes ?? 0,
          sasiaAktuale: p.sasia,
          sasia: 1,
        },
      ]
    })
    setKerkimi('')
    searchRef.current?.focus()
  }, [])

  // A scan resolves outright and skips the suggestion list.
  function handleScan(code: string) {
    const match = findByBarcode(code)
    if (match) {
      addLine(match)
      toast.success(match.emri)
      return
    }
    const hits = search(code)
    if (hits.length === 1) addLine(hits[0])
    else if (hits.length === 0) toast.error('Produkti nuk u gjet')
  }

  function setQty(productId: number, sasia: number) {
    setLines((prev) => prev.map((l) => (l.productId === productId ? { ...l, sasia } : l)))
  }

  function removeLine(productId: number) {
    setLines((prev) => prev.filter((l) => l.productId !== productId))
  }

  function focusQty(index: number) {
    const target = lines[index]
    if (!target) return
    const el = qtyRefs.current.get(target.productId)
    if (el) {
      el.focus()
      el.select()
    }
  }

  // Enter walks down the quantity column and returns to the scan field at the
  // end, so a whole registration can be typed without reaching for the mouse.
  function handleQtyKeyDown(e: React.KeyboardEvent<HTMLInputElement>, index: number) {
    if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault()
      if (index + 1 < lines.length) focusQty(index + 1)
      else searchRef.current?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      focusQty(index - 1)
    }
  }

  const kostoTotale = useMemo(
    () => lines.reduce((s, l) => s + lineCost(l) * (l.sasia > 0 ? l.sasia : 0), 0),
    [lines, lineCost]
  )

  async function save() {
    const valid = lines.filter((l) => l.sasia > 0)
    if (valid.length === 0) {
      toast.error('Shto të paktën një produkt')
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/personal-use', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data,
          shenime: shenime || null,
          items: valid.map((l) => ({ productId: l.productId, sasia: l.sasia })),
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body.error || 'Gabim gjatë ruajtjes')
        return
      }
      toast.success(`U regjistrua — ${valid.length} produkte`)
      setLines([])
      setShenime('')
      await Promise.all([fetchEntries(), refreshCatalog(), fetchCosts()])
      searchRef.current?.focus()
    } catch {
      toast.error('Gabim gjatë ruajtjes')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!toDelete) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/personal-use/${toDelete.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body.error || 'Fshirja dështoi')
        return
      }
      toast.success('U fshi. Stoku u kthye.')
      setToDelete(null)
      await Promise.all([fetchEntries(), refreshCatalog()])
    } catch {
      toast.error('Fshirja dështoi')
    } finally {
      setDeleting(false)
    }
  }

  function toggleExpanded(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (!role || !['admin', 'cashier'].includes(role)) return <AccessDenied />

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Përdorim Vetjak"
        subtitle="Produkte të marra për përdorim personal — ulin stokun, nuk janë shitje"
      />

      {/* Current registration */}
      <div className="card mb-6 overflow-hidden">
        <div className="p-4 border-b border-slate-100">
          <div className="relative">
            <SearchInput
              ref={searchRef}
              variant="barcode"
              value={kerkimi}
              onChange={setKerkimi}
              onSubmit={handleScan}
              autoFocus
              placeholder="Skano ose kërko produktin për ta shtuar..."
            />
            {suggestions.length > 0 && (
              <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-64 overflow-y-auto">
                {suggestions.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => addLine(p)}
                    className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-blue-50"
                  >
                    <span className="truncate text-slate-800">{p.emri}</span>
                    <span className="text-xs text-slate-400 whitespace-nowrap">
                      {tracksStock(p.njesia) ? `${p.sasia} ${p.njesia}` : p.njesia}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {lines.length === 0 ? (
          <div className="p-10 text-center">
            <RiShoppingBasket2Line className="text-4xl text-slate-200 mx-auto mb-3" />
            <p className="text-slate-400 text-sm">
              Skano ose kërko produktet. Një regjistrim mund të ketë disa produkte.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="table-th">Produkti</th>
                  <th className="table-th text-center whitespace-nowrap">Stoku</th>
                  <th className="table-th text-center w-28">Sasia</th>
                  <th className="table-th text-right w-32">Kosto</th>
                  <th className="table-th w-10" />
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => {
                  const live = products.find((p) => p.id === line.productId)
                  const stoku = live ? live.sasia : line.sasiaAktuale
                  const tracked = tracksStock(line.njesia)
                  const mbingarkese = tracked && line.sasia > stoku
                  return (
                    <tr key={line.productId} className="border-b border-slate-100">
                      <td className="table-td">
                        <span className="font-medium text-slate-800">{line.emri}</span>
                        <span className="text-slate-400 text-xs ml-1.5">{line.njesia}</span>
                      </td>
                      <td className="table-td text-center">
                        {tracked ? (
                          <span className={mbingarkese ? 'badge-red' : 'badge-gray'}>{stoku}</span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="table-td">
                        <input
                          ref={(el) => {
                            if (el) qtyRefs.current.set(line.productId, el)
                            else qtyRefs.current.delete(line.productId)
                          }}
                          type="number"
                          min="0"
                          step={qtyStep(line.njesia)}
                          value={line.sasia === 0 ? '' : line.sasia}
                          placeholder="0"
                          onChange={(e) => setQty(line.productId, Number(e.target.value) || 0)}
                          onKeyDown={(e) => handleQtyKeyDown(e, index)}
                          onFocus={(e) => e.target.select()}
                          className="input py-1.5 text-sm text-center w-full tabular-nums"
                        />
                      </td>
                      <td className="table-td text-right font-medium text-slate-800 tabular-nums">
                        {line.sasia > 0 ? (
                          formatCurrency(lineCost(line) * line.sasia)
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="table-td text-center">
                        <button
                          type="button"
                          onClick={() => removeLine(line.productId)}
                          title="Hiq nga lista"
                          className="p-1 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                        >
                          <RiDeleteBin6Line />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="p-4 border-t border-slate-100 bg-slate-50/60">
          <div className="grid grid-cols-1 sm:grid-cols-[160px_minmax(0,1fr)_auto] gap-3 items-center">
            <input
              type="date"
              value={data}
              onChange={(e) => setData(e.target.value)}
              className="input"
              aria-label="Data"
            />
            <input
              type="text"
              value={shenime}
              onChange={(e) => setShenime(e.target.value)}
              placeholder="Shënim (opsional)"
              className="input"
              aria-label="Shënim"
            />
            <div className="flex items-center gap-4 justify-end">
              <div className="text-right">
                <p className="text-xs text-slate-400">Kosto totale</p>
                <p className="font-bold text-slate-900 tabular-nums">
                  {formatCurrency(kostoTotale)}
                </p>
              </div>
              <button
                onClick={save}
                disabled={saving || lines.length === 0}
                className="btn-primary flex items-center gap-2 whitespace-nowrap h-[42px]"
              >
                {saving ? (
                  <RiLoader4Line className="animate-spin" />
                ) : (
                  <RiAddLine className="text-lg" />
                )}
                Regjistro
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Monthly cost summary */}
      {muajt.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          {muajt.slice(0, 6).map((m) => (
            <div key={m.muaji} className="card px-3.5 py-2">
              <p className="text-xs text-slate-400">{monthLabel(m.muaji)}</p>
              <p className="font-bold text-slate-900 tabular-nums">{formatCurrency(m.totali)}</p>
              <p className="text-xs text-slate-400">{m.numri} regjistrime</p>
            </div>
          ))}
        </div>
      )}

      {/* Date filter */}
      <div className="card p-4 mb-6">
        <div className="flex flex-col sm:flex-row gap-3 items-center">
          <label className="text-sm text-slate-500 whitespace-nowrap">Nga</label>
          <input
            type="date"
            value={nga}
            onChange={(e) => setNga(e.target.value)}
            className="input sm:w-44"
          />
          <label className="text-sm text-slate-500 whitespace-nowrap">Deri</label>
          <input
            type="date"
            value={deri}
            onChange={(e) => setDeri(e.target.value)}
            className="input sm:w-44"
          />
          {(nga || deri) && (
            <button
              onClick={() => {
                setNga('')
                setDeri('')
              }}
              className="btn-secondary text-sm"
            >
              Pastro
            </button>
          )}
          <div className="sm:ml-auto text-sm">
            <span className="text-slate-500">Kosto totale</span>
            <span className="ml-2 font-bold text-slate-900 tabular-nums">
              {formatCurrency(totali)}
            </span>
          </div>
        </div>
      </div>

      {/* History — one row per registration, expandable to its lines */}
      <div className="card overflow-hidden">
        {loading ? (
          <TableSkeleton rows={5} cols={6} />
        ) : error ? (
          <ErrorState message="Gabim gjatë ngarkimit" onRetry={fetchEntries} />
        ) : entries.length === 0 ? (
          <div className="p-12 text-center">
            <RiHomeHeartLine className="text-4xl text-slate-200 mx-auto mb-3" />
            <p className="text-slate-400">Asnjë regjistrim për këtë periudhë</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="table-th w-10" />
                  <th className="table-th">Data</th>
                  <th className="table-th">Produktet</th>
                  <th className="table-th text-right">Kosto</th>
                  <th className="table-th">Shënim</th>
                  <th className="table-th text-center">Fshi</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e, idx) => {
                  const open = expanded.has(e.id)
                  return (
                    <tr
                      key={e.id}
                      style={rowDelayStyle(idx)}
                      className="table-row align-top anim-fade-in"
                    >
                      <td className="table-td">
                        <button
                          onClick={() => toggleExpanded(e.id)}
                          aria-label={open ? 'Mbyll' : 'Shfaq produktet'}
                          className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors"
                        >
                          <RiArrowRightSLine
                            className={`text-lg transition-transform ${open ? 'rotate-90' : ''}`}
                          />
                        </button>
                      </td>
                      <td className="table-td text-slate-500 whitespace-nowrap">
                        {formatDate(e.data)}
                      </td>
                      <td className="table-td">
                        <button
                          onClick={() => toggleExpanded(e.id)}
                          className="font-medium text-slate-800 hover:text-blue-600 text-left"
                        >
                          {e.items.length === 1
                            ? e.items[0].emriProduktit
                            : `${e.items.length} produkte`}
                        </button>
                        <Collapse open={open}>
                          <ul className="mt-2 space-y-1 border-l-2 border-slate-100 pl-3">
                            {e.items.map((it) => (
                              <li
                                key={it.id}
                                className="flex items-baseline justify-between gap-4 text-sm"
                              >
                                <span className="text-slate-600">{it.emriProduktit}</span>
                                <span className="text-slate-400 tabular-nums whitespace-nowrap">
                                  {it.sasia} {it.njesia} · {formatCurrency(it.totali)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </Collapse>
                      </td>
                      <td className="table-td text-right tabular-nums font-medium">
                        {formatCurrency(e.totali)}
                      </td>
                      <td className="table-td text-slate-400 text-sm">{e.shenime || '—'}</td>
                      <td className="table-td text-center">
                        <button
                          onClick={() => setToDelete(e)}
                          title="Fshi dhe kthe stokun"
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <RiDeleteBin6Line className="text-lg" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        isOpen={!!toDelete}
        onClose={() => !deleting && setToDelete(null)}
        title="Konfirmo Fshirjen"
        size="sm"
      >
        <p className="text-slate-600 mb-3">
          Fshi këtë regjistrim me{' '}
          <strong className="text-slate-900">{toDelete?.items.length ?? 0} produkte</strong>? I
          gjithë stoku do t&apos;i kthehet produkteve.
        </p>
        {toDelete && (
          <ul className="mb-5 space-y-1 border-l-2 border-slate-100 pl-3">
            {toDelete.items.map((it) => (
              <li key={it.id} className="flex items-baseline justify-between gap-4 text-sm">
                <span className="text-slate-600">{it.emriProduktit}</span>
                <span className="text-slate-400 tabular-nums whitespace-nowrap">
                  {it.sasia} {it.njesia}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-3">
          <button onClick={remove} disabled={deleting} className="btn-danger flex-1">
            {deleting ? 'Duke fshirë...' : 'Po, Fshi'}
          </button>
          <button onClick={() => setToDelete(null)} className="btn-secondary">
            Anulo
          </button>
        </div>
      </Modal>
    </div>
  )
}
