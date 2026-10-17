'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRole } from '@/contexts/RoleContext'
import AccessDenied from '@/components/AccessDenied'
import toast from 'react-hot-toast'
import PageHeader from '@/components/ui/PageHeader'
import SearchInput from '@/components/ui/SearchInput'
import SupplyLineTable, { type SupplyLine } from '@/components/ui/SupplyLineTable'
import TableSkeleton from '@/components/ui/TableSkeleton'
import ErrorState from '@/components/ui/ErrorState'
import { refreshCatalog } from '@/lib/catalog'
import { formatCurrency } from '@/lib/utils'
import {
  RiRefreshLine,
  RiFileListLine,
  RiTruckLine,
  RiCheckLine,
  RiLoader4Line,
} from 'react-icons/ri'

function getTodayString() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

interface ProductSuggestion {
  id: number
  emri: string
  kategoria: string
  sasia: number
  stokuMinimal: number
  njesia: string
  cmimiBlerjes: number
  cmimiShitjes: number
  sasiaSugjeruar: number
}

interface SupplierGroup {
  furnitorId: number | null
  furnitorEmri: string
  products: ProductSuggestion[]
}

/** Per-product edits, keyed by product id and shared across all groups. */
interface Edit {
  sasia: number
  cmimiBlerjes: number
  cmimiShitjes: number
  removed: boolean
}

export default function PorositjeTeSugjeruaraPage() {
  const { role } = useRole()
  const [groups, setGroups] = useState<SupplierGroup[]>([])
  const [totalProducts, setTotalProducts] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [kerkimi, setKerkimi] = useState('')
  const [data, setData] = useState(getTodayString())
  const [edits, setEdits] = useState<Record<number, Edit>>({})
  const [savingKey, setSavingKey] = useState<string | null>(null)

  const fetchSuggestions = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const res = await fetch('/api/reorder-suggestions')
      if (res.status === 401) {
        window.location.href = '/login'
        return
      }
      if (!res.ok) throw new Error()
      const body = await res.json()
      const nextGroups: SupplierGroup[] = body.groups ?? []
      setGroups(nextGroups)
      setTotalProducts(body.totalProducts ?? 0)
      // Seed each row with the suggested quantity and the current cost price.
      setEdits(
        Object.fromEntries(
          nextGroups.flatMap((g) =>
            g.products.map((p) => [
              p.id,
              {
                sasia: p.sasiaSugjeruar,
                cmimiBlerjes: p.cmimiBlerjes,
                cmimiShitjes: p.cmimiShitjes,
                removed: false,
              },
            ])
          )
        )
      )
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSuggestions()
  }, [fetchSuggestions])

  const setEdit = useCallback((productId: number, patch: Partial<Edit>) => {
    setEdits((prev) => ({
      ...prev,
      [productId]: { ...prev[productId], ...patch },
    }))
  }, [])

  const visibleGroups = useMemo(() => {
    const q = kerkimi.trim().toLowerCase()
    return groups
      .map((g) => ({
        ...g,
        products: g.products.filter(
          (p) =>
            !edits[p.id]?.removed &&
            (!q ||
              p.emri.toLowerCase().includes(q) ||
              p.kategoria.toLowerCase().includes(q))
        ),
      }))
      .filter((g) => g.products.length > 0)
  }, [groups, kerkimi, edits])

  const linesFor = useCallback(
    (g: SupplierGroup): SupplyLine[] =>
      g.products.map((p) => ({
        productId: p.id,
        emriProduktit: p.emri,
        njesia: p.njesia,
        sasiaAktuale: p.sasia,
        stokuMinimal: p.stokuMinimal,
        sasiaSugjeruar: p.sasiaSugjeruar,
        sasia: edits[p.id]?.sasia ?? p.sasiaSugjeruar,
        cmimiBlerjes: edits[p.id]?.cmimiBlerjes ?? p.cmimiBlerjes,
        cmimiShitjes: edits[p.id]?.cmimiShitjes ?? p.cmimiShitjes,
      })),
    [edits]
  )

  const groupItems = useCallback(
    (g: SupplierGroup) =>
      g.products
        .filter((p) => !edits[p.id]?.removed)
        .map((p) => ({
          productId: p.id,
          emriProduktit: p.emri,
          njesia: p.njesia,
          sasia: edits[p.id]?.sasia ?? p.sasiaSugjeruar,
          cmimiBlerjes: edits[p.id]?.cmimiBlerjes ?? p.cmimiBlerjes,
          cmimiShitjes: edits[p.id]?.cmimiShitjes ?? p.cmimiShitjes,
        }))
        .filter((i) => i.sasia > 0),
    [edits]
  )

  const groupTotal = useCallback(
    (g: SupplierGroup) => groupItems(g).reduce((s, i) => s + i.sasia * i.cmimiBlerjes, 0),
    [groupItems]
  )

  /**
   * Creates one supply per supplier.
   *
   * The previous "order everything" button flattened every group into a single
   * request with furnitorId null, producing one mixed delivery attributed to no
   * supplier. Each group is now its own supply under its own supplier.
   */
  async function createSupplies(target: SupplierGroup[], key: string) {
    const payloads = target
      .map((g) => ({ group: g, items: groupItems(g) }))
      .filter((x) => x.items.length > 0)

    if (payloads.length === 0) {
      toast.error('Nuk ka sasi për të porositur')
      return
    }

    setSavingKey(key)
    let created = 0
    const failed: string[] = []

    try {
      for (const { group, items } of payloads) {
        try {
          const res = await fetch('/api/supplies', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              furnitorId: group.furnitorId,
              data,
              shenime: `Porositje e sugjeruar — ${group.furnitorEmri}`,
              items,
            }),
          })
          if (!res.ok) {
            const body = await res.json().catch(() => ({}))
            failed.push(`${group.furnitorEmri}: ${body.error ?? 'gabim'}`)
          } else {
            created++
          }
        } catch {
          failed.push(`${group.furnitorEmri}: gabim rrjeti`)
        }
      }

      if (created > 0) {
        toast.success(
          created === 1 ? 'Furnizimi u krijua' : `${created} furnizime u krijuan`
        )
      }
      // Report partial failures rather than letting them pass silently.
      for (const f of failed) toast.error(f)

      if (created > 0) {
        await Promise.all([refreshCatalog(), fetchSuggestions()])
      }
    } finally {
      setSavingKey(null)
    }
  }

  if (!role || !['admin', 'staff'].includes(role)) return <AccessDenied />

  const allItemCount = groups.reduce((s, g) => s + groupItems(g).length, 0)
  const allTotal = groups.reduce((s, g) => s + groupTotal(g), 0)

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Porositje të Sugjeruara"
        subtitle={`${totalProducts} produkte me stok të ulët · ${groups.length} furnitorë`}
        action={
          <div className="flex gap-2">
            <button
              onClick={fetchSuggestions}
              disabled={loading}
              className="btn-secondary flex items-center gap-2"
            >
              <RiRefreshLine className={loading ? 'animate-spin' : ''} />
              Rifresko
            </button>
            {groups.length > 1 && (
              <button
                onClick={() => createSupplies(groups, '__all__')}
                disabled={savingKey !== null || allItemCount === 0}
                className="btn-primary flex items-center gap-2"
              >
                {savingKey === '__all__' ? (
                  <RiLoader4Line className="animate-spin" />
                ) : (
                  <RiCheckLine className="text-lg" />
                )}
                Porosit të gjitha ({groups.length})
              </button>
            )}
          </div>
        }
      />

      <div className="card p-4 mb-6">
        <div className="flex flex-col sm:flex-row gap-3">
          <SearchInput
            className="flex-1"
            value={kerkimi}
            onChange={setKerkimi}
            placeholder="Filtro produktet..."
          />
          <input
            type="date"
            value={data}
            onChange={(e) => setData(e.target.value)}
            className="input sm:w-44"
            aria-label="Data e furnizimit"
          />
          {allItemCount > 0 && (
            <div className="flex items-center text-sm whitespace-nowrap px-1">
              <span className="text-slate-500">{allItemCount} produkte</span>
              <span className="mx-2 text-slate-300">·</span>
              <span className="font-bold text-slate-900 tabular-nums">
                {formatCurrency(allTotal)}
              </span>
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="card overflow-hidden">
          <TableSkeleton rows={6} cols={6} />
        </div>
      ) : error ? (
        <div className="card overflow-hidden">
          <ErrorState
            message="Gabim gjatë ngarkimit të sugjerimeve"
            onRetry={fetchSuggestions}
          />
        </div>
      ) : visibleGroups.length === 0 ? (
        <div className="card p-12 text-center">
          <RiFileListLine className="text-4xl text-slate-200 mx-auto mb-3" />
          <p className="text-slate-400">
            {kerkimi ? 'Asnjë produkt nuk përputhet' : 'Asnjë produkt nuk ka nevojë për porositje'}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {visibleGroups.map((g) => {
            const key = g.furnitorId === null ? '__none__' : String(g.furnitorId)
            const items = groupItems(g)
            const total = groupTotal(g)
            return (
              <div key={key} className="card overflow-hidden">
                <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-slate-100 bg-slate-50">
                  <RiTruckLine
                    className={`text-lg ${g.furnitorId === null ? 'text-slate-300' : 'text-slate-400'}`}
                  />
                  <span className="font-semibold text-slate-800">{g.furnitorEmri}</span>
                  <span className="text-xs text-slate-400">
                    {g.products.length} produkte
                  </span>

                  <div className="ml-auto flex items-center gap-3">
                    <span className="text-sm font-bold text-slate-900 tabular-nums">
                      {formatCurrency(total)}
                    </span>
                    <button
                      onClick={() => createSupplies([g], key)}
                      disabled={savingKey !== null || items.length === 0}
                      className="btn-primary text-sm py-1.5 px-3 flex items-center gap-1.5 whitespace-nowrap"
                    >
                      {savingKey === key ? (
                        <RiLoader4Line className="animate-spin" />
                      ) : (
                        <RiCheckLine />
                      )}
                      Krijo Furnizimin
                    </button>
                  </div>
                </div>

                <SupplyLineTable
                  lines={linesFor(g)}
                  showSuggestion
                  onChangeQty={(id, v) => setEdit(id, { sasia: v })}
                  onChangePrice={(id, v) => setEdit(id, { cmimiBlerjes: v })}
                  onChangeSalePrice={(id, v) => setEdit(id, { cmimiShitjes: v })}
                  onRemove={(id) => setEdit(id, { removed: true })}
                />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
