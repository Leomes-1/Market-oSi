'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { useRole } from '@/contexts/RoleContext'
import AccessDenied from '@/components/AccessDenied'
import SearchInput from '@/components/ui/SearchInput'
import SupplyLineTable, { type SupplyLine } from '@/components/ui/SupplyLineTable'
import Modal from '@/components/ui/Modal'
import type { ShoppingListLine } from '@/lib/shopping-list'
import { useCatalog, type CatalogProduct } from '@/lib/catalog'
import { formatCurrency } from '@/lib/utils'
import { pendingLabel } from '@/lib/pricing'
import {
  RiArrowLeftLine,
  RiTruckLine,
  RiSearchLine,
  RiCheckLine,
  RiLoader4Line,
  RiShoppingCart2Line,
} from 'react-icons/ri'

const NO_SUPPLIER = '__pa_furnitor__'

/** Opened from "Lista e blerjeve" (Porositje të Sugjeruara)? */
function openedFromList(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('lista') === '1'
  } catch {
    return false
  }
}

/**
 * The shopping list as this page uses it. Only lines ticked ✓ (bought) count:
 * their catalogue products prefill the supply, and after saving the ticked
 * lines are what may be removed. Unticked lines stay for next time.
 */
interface FromList {
  productIds: number[]
  /** Every ticked line, free text included: what "remove the bought lines" removes. */
  boughtLineIds: number[]
  /** Ticked free-text lines: not in the catalogue, so not in a supply. */
  skippedFree: string[]
  /** Ticked catalogue lines left at quantity 0. */
  skippedZero: number
  /** Lines not ticked, left on the list. */
  unticked: number
}

function getTodayString() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function FurnizimIRiPage() {
  const { role } = useRole()
  const router = useRouter()
  const { products, loading, refresh } = useCatalog()

  // Step 1 picks the supplier, step 2 enters quantities. Keeping it on a page
  // rather than in a modal gives the table the vertical space it needs and
  // survives a reload.
  const [step, setStep] = useState<'supplier' | 'lines'>('supplier')
  const [supplierKey, setSupplierKey] = useState<string | null>(null)
  const [supplierSearch, setSupplierSearch] = useState('')
  const [productSearch, setProductSearch] = useState('')
  const [data, setData] = useState(getTodayString())
  const [shenime, setShenime] = useState('')
  const [qty, setQty] = useState<Record<number, number>>({})
  const [price, setPrice] = useState<Record<number, number>>({})
  const [salePrice, setSalePrice] = useState<Record<number, number>>({})
  const [updatePrice, setUpdatePrice] = useState<Record<number, boolean>>({})
  const [extraIds, setExtraIds] = useState<number[]>([])
  // Inventari (admin only): the supply came with a VAT invoice.
  const [meTvsh, setMeTvsh] = useState(false)
  const [nrFatures, setNrFatures] = useState('')
  const [saving, setSaving] = useState(false)
  // Set when the page was opened from the shopping list and the list loaded.
  const [fromList, setFromList] = useState<FromList | null>(null)
  const [listLoading, setListLoading] = useState(false)
  const autoChosen = useRef(false)
  // After saving a supply made from the list: ask whether to remove the bought lines.
  const [askClear, setAskClear] = useState(false)
  const [clearingList, setClearingList] = useState(false)

  // Prefill from the shopping list: its quantities and its own prices.
  useEffect(() => {
    if (!openedFromList()) return
    let cancelled = false
    setListLoading(true)
    ;(async () => {
      try {
        const res = await fetch('/api/shopping-list')
        if (!res.ok) throw new Error()
        const items = ((await res.json()).items ?? []) as ShoppingListLine[]
        if (cancelled) return
        const bought = items.filter((l) => l.blere)
        const usable = bought.filter((l) => l.productId !== null && l.sasia > 0)
        const ids = usable.map((l) => l.productId as number)
        setQty(Object.fromEntries(usable.map((l) => [l.productId, l.sasia])))
        setPrice((prev) => ({
          ...prev,
          ...Object.fromEntries(usable.map((l) => [l.productId, l.cmimiBlerjes])),
        }))
        setExtraIds(ids)
        setFromList({
          productIds: ids,
          boughtLineIds: bought.map((l) => l.id),
          skippedFree: bought.filter((l) => l.productId === null).map((l) => l.emri),
          skippedZero: bought.filter((l) => l.productId !== null && l.sasia <= 0).length,
          unticked: items.length - bought.length,
        })
      } catch {
        if (!cancelled) toast.error('Lista e blerjeve nuk u ngarkua')
      } finally {
        if (!cancelled) setListLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Suppliers are derived from the catalogue, so the page needs no extra fetch.
  const suppliers = useMemo(() => {
    const map = new Map<string, { key: string; id: number | null; emri: string; count: number }>()
    for (const p of products) {
      const key = p.furnitorId == null ? NO_SUPPLIER : String(p.furnitorId)
      const existing = map.get(key)
      if (existing) existing.count++
      else
        map.set(key, {
          key,
          id: p.furnitorId,
          emri: p.furnitorEmri ?? 'Pa furnitor',
          count: 1,
        })
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.id === null) return 1
      if (b.id === null) return -1
      return a.emri.localeCompare(b.emri)
    })
  }, [products])

  const visibleSuppliers = useMemo(() => {
    const q = supplierSearch.trim().toLowerCase()
    return q ? suppliers.filter((s) => s.emri.toLowerCase().includes(q)) : suppliers
  }, [suppliers, supplierSearch])

  const chosen = suppliers.find((s) => s.key === supplierKey) ?? null

  const supplierProducts = useMemo(() => {
    if (!supplierKey) return []
    const own = products.filter(
      (p) => (p.furnitorId == null ? NO_SUPPLIER : String(p.furnitorId)) === supplierKey
    )
    // The old modal searched the whole catalogue, so a delivery could carry a
    // product assigned to a different supplier. Those are kept here, appended
    // to the supplier's own list, so mixed deliveries remain possible.
    const extras = extraIds
      .map((id) => products.find((p) => p.id === id))
      .filter((p): p is CatalogProduct => !!p && !own.some((o) => o.id === p.id))
    if (fromList) {
      // From the shopping list: its products first, in list order, then the
      // rest of the supplier's catalogue.
      const listedIds = new Set(fromList.productIds)
      const listed = fromList.productIds
        .map((id) => products.find((p) => p.id === id))
        .filter((p): p is CatalogProduct => !!p)
      return [
        ...listed,
        ...own.filter((p) => !listedIds.has(p.id)),
        ...extras.filter((p) => !listedIds.has(p.id)),
      ]
    }
    return [...own, ...extras]
  }, [products, supplierKey, extraIds, fromList])

  // Seed the per-row purchase price from the product once the supplier is set.
  useEffect(() => {
    if (!supplierKey) return
    setPrice((prev) => {
      const next = { ...prev }
      for (const p of supplierProducts) {
        if (next[p.id] === undefined) next[p.id] = p.cmimiBlerjes ?? 0
      }
      return next
    })
    setSalePrice((prev) => {
      const next = { ...prev }
      for (const p of supplierProducts) {
        if (next[p.id] === undefined) next[p.id] = p.cmimiShitjes
      }
      return next
    })
  }, [supplierKey, supplierProducts])

  const lines: SupplyLine[] = useMemo(() => {
    const q = productSearch.trim().toLowerCase()
    return supplierProducts
      .filter(
        (p) =>
          !q ||
          p.emri.toLowerCase().includes(q) ||
          p.kategoria.toLowerCase().includes(q) ||
          p.barcodes.some((b) => b.includes(q))
      )
      .map((p) => ({
        productId: p.id,
        emriProduktit: p.emri,
        njesia: p.njesia,
        sasiaAktuale: p.sasia,
        stokuMinimal: p.stokuMinimal,
        sasia: qty[p.id] ?? 0,
        cmimiBlerjes: price[p.id] ?? p.cmimiBlerjes ?? 0,
        cmimiShitjes: salePrice[p.id] ?? p.cmimiShitjes,
        updatePrice: updatePrice[p.id] ?? false,
        pendingLabel: pendingLabel(
          {
            id: p.id,
            sasia: p.sasia,
            cmimiBlerjes: p.cmimiBlerjes ?? 0,
            cmimiShitjes: p.cmimiShitjes,
            cmimiBlerjesRi: p.cmimiBlerjesRi ?? null,
            cmimiShitjesRi: p.cmimiShitjesRi,
            sasiaVjeter: p.sasiaVjeter,
          },
          p.njesia
        ),
      }))
  }, [supplierProducts, productSearch, qty, price, salePrice, updatePrice])

  // Totals cover every entered row, not just the rows currently filtered in.
  const entered = useMemo(
    () =>
      supplierProducts
        .filter((p) => (qty[p.id] ?? 0) > 0)
        .map((p) => ({
          productId: p.id,
          emriProduktit: p.emri,
          njesia: p.njesia,
          sasia: qty[p.id],
          cmimiBlerjes: price[p.id] ?? p.cmimiBlerjes ?? 0,
          cmimiShitjes: salePrice[p.id] ?? p.cmimiShitjes,
          updatePrice: updatePrice[p.id] ?? false,
        })),
    [supplierProducts, qty, price, salePrice, updatePrice]
  )

  const total = entered.reduce((s, i) => s + i.sasia * i.cmimiBlerjes, 0)

  function chooseSupplier(key: string) {
    setSupplierKey(key)
    setProductSearch('')
    // From the list the quantities are the point: changing the supplier keeps them.
    if (!fromList) {
      setQty({})
      setUpdatePrice({})
    }
    setStep('lines')
  }

  // Every listed product has the same supplier: pick it and go to the lines.
  useEffect(() => {
    if (!fromList || autoChosen.current || loading || fromList.productIds.length === 0) return
    autoChosen.current = true
    const keys = new Set(
      fromList.productIds
        .map((id) => products.find((p) => p.id === id))
        .filter((p): p is CatalogProduct => !!p)
        .map((p) => (p.furnitorId == null ? NO_SUPPLIER : String(p.furnitorId)))
    )
    if (keys.size === 1) chooseSupplier(Array.from(keys)[0])
    // chooseSupplier only sets state; this runs once, when the list and catalogue are in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromList, loading, products])

  // A scanned barcode belonging to this supplier bumps that row by one.
  function handleScan(code: string) {
    let match = supplierProducts.find((p) => p.barcodes.includes(code))

    if (!match) {
      // Fall back to the whole catalogue: a delivery may legitimately include
      // a product that belongs to another supplier.
      const elsewhere = products.find((p) => p.barcodes.includes(code))
      if (!elsewhere) {
        toast.error('Produkti nuk u gjet')
        setProductSearch('')
        return
      }
      setExtraIds((prev) => (prev.includes(elsewhere.id) ? prev : [...prev, elsewhere.id]))
      toast.success(`${elsewhere.emri} u shtua (${elsewhere.furnitorEmri ?? 'pa furnitor'})`)
      match = elsewhere
    }

    setQty((prev) => ({ ...prev, [match!.id]: (prev[match!.id] ?? 0) + 1 }))
    setProductSearch('')
  }

  /** Products from other suppliers matching the filter, offered as extras. */
  const otherMatches = useMemo(() => {
    const q = productSearch.trim().toLowerCase()
    if (!q) return []
    return products
      .filter(
        (p) =>
          !supplierProducts.some((sp) => sp.id === p.id) &&
          (p.emri.toLowerCase().includes(q) || p.barcodes.some((b) => b.includes(q)))
      )
      .slice(0, 5)
  }, [products, supplierProducts, productSearch])

  async function save() {
    if (entered.length === 0) {
      toast.error('Shto sasi për të paktën një produkt')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/supplies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          furnitorId: chosen?.id ?? null,
          data,
          shenime: shenime || null,
          items: entered,
          ...(role === 'admin' ? { meTvsh, nrFatures: nrFatures.trim() || null } : {}),
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body.error || 'Gabim gjatë ruajtjes')
        return
      }
      toast.success('Furnizimi u ruajt me sukses')
      await refresh()
      if (fromList) {
        setAskClear(true)
        return
      }
      router.push('/furnizime')
    } catch {
      toast.error('Gabim gjatë ruajtjes')
    } finally {
      setSaving(false)
    }
  }

  async function finishFromList(removeBought: boolean) {
    if (removeBought && fromList && fromList.boughtLineIds.length > 0) {
      setClearingList(true)
      try {
        // Only lines still ticked are removed; unticked ones stay for next time.
        const res = await fetch(
          `/api/shopping-list?bought=${fromList.boughtLineIds.join(',')}`,
          { method: 'DELETE' }
        )
        if (!res.ok) throw new Error()
        const body = await res.json().catch(() => ({}))
        const n = typeof body.removed === 'number' ? body.removed : fromList.boughtLineIds.length
        toast.success(n === 1 ? '1 rresht i blerë u hoq nga lista' : `${n} rreshta të blerë u hoqën nga lista`)
      } catch {
        toast.error('Rreshtat e blerë nuk u hoqën nga lista')
      } finally {
        setClearingList(false)
      }
    }
    setAskClear(false)
    router.push('/furnizime')
  }

  if (!role || !['admin', 'staff'].includes(role)) return <AccessDenied />

  const listBanner = (listLoading || fromList) && (
    <div className="px-4 sm:px-6 lg:px-8 py-2.5 border-b border-blue-100 bg-blue-50 text-sm text-blue-800 flex-shrink-0">
      <p className="flex items-center gap-2">
        <RiShoppingCart2Line className="flex-shrink-0" />
        {!fromList
          ? 'Duke ngarkuar listën e blerjeve...'
          : `Nga lista e blerjeve: ${fromList.productIds.length} produkte të blera (✓)${
              step === 'supplier' ? ' — zgjidh furnitorin' : ''
            }`}
      </p>
      {fromList && fromList.unticked > 0 && (
        <p className="text-xs text-blue-700/80 mt-1 pl-6">
          {fromList.unticked} {fromList.unticked === 1 ? 'rresht pa ✓ mbetet' : 'rreshta pa ✓ mbeten'} në listë
        </p>
      )}
      {fromList && fromList.skippedFree.length > 0 && (
        <p className="text-xs text-amber-700 mt-1 pl-6">
          Nuk janë në katalog, prandaj nuk shtohen në furnizim: {fromList.skippedFree.join(', ')}
        </p>
      )}
      {fromList && fromList.skippedZero > 0 && (
        <p className="text-xs text-blue-700/80 mt-1 pl-6">
          {fromList.skippedZero} produkte me sasi 0 u lanë jashtë
        </p>
      )}
    </div>
  )

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 sm:px-6 lg:px-8 pt-5 pb-4 border-b border-slate-200 bg-white flex-shrink-0">
        <div className="flex items-center gap-3 mb-1">
          <Link
            href="/furnizime"
            className="p-1.5 -ml-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            aria-label="Kthehu te furnizimet"
          >
            <RiArrowLeftLine className="text-xl" />
          </Link>
          <h1 className="text-xl font-bold text-slate-900">Shto Furnizim</h1>
        </div>
        <p className="text-sm text-slate-500 pl-7">
          {step === 'supplier'
            ? 'Zgjidh furnitorin për të vazhduar'
            : `${chosen?.emri} · ${supplierProducts.length} produkte`}
        </p>
      </div>

      {listBanner}

      {/* Step 1 — supplier picker */}
      {step === 'supplier' && (
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <div className="max-w-2xl mx-auto">
            <SearchInput
              className="mb-4"
              value={supplierSearch}
              onChange={setSupplierSearch}
              autoFocus
              placeholder="Kërko furnitor..."
              selectOnScan
            />

            {loading ? (
              <div className="p-10 text-center text-slate-400 text-sm">Duke ngarkuar...</div>
            ) : (
              <div className="card divide-y divide-slate-100 overflow-hidden">
                {visibleSuppliers.length === 0 ? (
                  <div className="p-8 text-center text-slate-400 text-sm">
                    Asnjë furnitor nuk përputhet
                  </div>
                ) : (
                  visibleSuppliers.map((s) => (
                    <button
                      key={s.key}
                      onClick={() => chooseSupplier(s.key)}
                      className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left hover:bg-blue-50 transition-colors group"
                    >
                      <span className="flex items-center gap-3 min-w-0">
                        <RiTruckLine
                          className={`text-lg flex-shrink-0 ${
                            s.id === null ? 'text-slate-300' : 'text-slate-400'
                          } group-hover:text-blue-500`}
                        />
                        <span className="font-medium text-slate-800 truncate">{s.emri}</span>
                      </span>
                      <span className="text-xs text-slate-400 whitespace-nowrap">
                        {s.count} produkte
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Step 2 — quantity entry */}
      {step === 'lines' && (
        <>
          <div className="px-4 sm:px-6 lg:px-8 py-3 border-b border-slate-100 bg-white flex-shrink-0">
            <div className="flex flex-col sm:flex-row gap-3">
              <SearchInput
                className="flex-1"
                variant="barcode"
                value={productSearch}
                onChange={setProductSearch}
                onSubmit={handleScan}
                autoFocus
                placeholder="Filtro ose skano barkod..."
                icon={<RiSearchLine />}
              />
              <input
                type="date"
                value={data}
                onChange={(e) => setData(e.target.value)}
                className="input sm:w-44"
                aria-label="Data e furnizimit"
              />
              <button
                onClick={() => setStep('supplier')}
                className="btn-secondary whitespace-nowrap"
              >
                Ndrysho furnitorin
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            <SupplyLineTable
              lines={lines}
              onChangeQty={(id, v) => setQty((p) => ({ ...p, [id]: v }))}
              onChangePrice={(id, v) => setPrice((p) => ({ ...p, [id]: v }))}
              onChangeSalePrice={(id, v) => setSalePrice((p) => ({ ...p, [id]: v }))}
              onToggleUpdatePrice={(id) =>
                setUpdatePrice((p) => ({ ...p, [id]: !p[id] }))
              }
              emptyMessage="Asnjë produkt për këtë furnitor"
            />

            {otherMatches.length > 0 && (
              <div className="border-t border-slate-100 bg-slate-50 px-4 py-3">
                <p className="text-xs text-slate-500 mb-2">
                  Nga furnitorë të tjerë — kliko për ta shtuar në këtë furnizim:
                </p>
                <div className="flex flex-wrap gap-2">
                  {otherMatches.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        setExtraIds((prev) => (prev.includes(p.id) ? prev : [...prev, p.id]))
                        setProductSearch('')
                      }}
                      className="text-sm px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50 transition-colors"
                    >
                      {p.emri}
                      <span className="text-xs text-slate-400 ml-1.5">
                        {p.furnitorEmri ?? 'pa furnitor'}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Sticky footer */}
          <div className="border-t border-slate-200 bg-white px-4 sm:px-6 lg:px-8 py-3 flex-shrink-0">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <input
                type="text"
                value={shenime}
                onChange={(e) => setShenime(e.target.value)}
                placeholder="Shënime (opsionale)"
                className="input flex-1 text-sm"
                aria-label="Shënime"
              />
              {role === 'admin' && (
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-700 whitespace-nowrap cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={meTvsh}
                      onChange={(e) => setMeTvsh(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    Me TVSH
                  </label>
                  <input
                    type="text"
                    value={nrFatures}
                    onChange={(e) => setNrFatures(e.target.value)}
                    placeholder="Nr. i faturës (opsional)"
                    maxLength={60}
                    className="input text-sm w-full sm:w-48"
                    aria-label="Numri i faturës"
                  />
                </div>
              )}
              <div className="flex items-center gap-4 sm:ml-auto">
                <div className="text-sm">
                  <span className="text-slate-500">{entered.length} produkte</span>
                  <span className="mx-2 text-slate-300">·</span>
                  <span className="font-bold text-slate-900 tabular-nums">
                    {formatCurrency(total)}
                  </span>
                </div>
                <button
                  onClick={save}
                  disabled={saving || askClear || entered.length === 0}
                  className="btn-primary flex items-center gap-2 whitespace-nowrap"
                >
                  {saving ? (
                    <>
                      <RiLoader4Line className="animate-spin" />
                      Duke ruajtur...
                    </>
                  ) : (
                    <>
                      <RiCheckLine className="text-lg" />
                      Ruaj Furnizimin
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      <Modal
        isOpen={askClear}
        onClose={() => {
          if (!clearingList) void finishFromList(false)
        }}
        title="Furnizimi u ruajt"
        size="sm"
      >
        <p className="text-sm text-slate-600 mb-5">
          Të hiqen nga lista e blerjeve rreshtat e blerë (✓)?
          {fromList && fromList.unticked > 0 && ' Rreshtat pa ✓ mbeten për herën tjetër.'}
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => void finishFromList(false)}
            disabled={clearingList}
            className="btn-secondary"
          >
            Jo, mbaje
          </button>
          <button
            type="button"
            onClick={() => void finishFromList(true)}
            disabled={clearingList}
            className="btn-danger flex items-center gap-2"
          >
            {clearingList && <RiLoader4Line className="animate-spin" />}
            Po, hiqi
          </button>
        </div>
      </Modal>
    </div>
  )
}
