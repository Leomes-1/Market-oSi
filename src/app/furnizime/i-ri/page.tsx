'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { useRole } from '@/contexts/RoleContext'
import AccessDenied from '@/components/AccessDenied'
import SearchInput from '@/components/ui/SearchInput'
import SupplyLineTable, { type SupplyLine } from '@/components/ui/SupplyLineTable'
import { useCatalog } from '@/lib/catalog'
import { formatCurrency } from '@/lib/utils'
import {
  RiArrowLeftLine,
  RiTruckLine,
  RiSearchLine,
  RiCheckLine,
  RiLoader4Line,
} from 'react-icons/ri'

const NO_SUPPLIER = '__pa_furnitor__'

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
  const [updatePrice, setUpdatePrice] = useState<Record<number, boolean>>({})
  const [saving, setSaving] = useState(false)

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
    return products.filter(
      (p) => (p.furnitorId == null ? NO_SUPPLIER : String(p.furnitorId)) === supplierKey
    )
  }, [products, supplierKey])

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
        updatePrice: updatePrice[p.id] ?? false,
      }))
  }, [supplierProducts, productSearch, qty, price, updatePrice])

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
          updatePrice: updatePrice[p.id] ?? false,
        })),
    [supplierProducts, qty, price, updatePrice]
  )

  const total = entered.reduce((s, i) => s + i.sasia * i.cmimiBlerjes, 0)

  function chooseSupplier(key: string) {
    setSupplierKey(key)
    setProductSearch('')
    setQty({})
    setUpdatePrice({})
    setStep('lines')
  }

  // A scanned barcode belonging to this supplier bumps that row by one.
  function handleScan(code: string) {
    const match = supplierProducts.find((p) => p.barcodes.includes(code))
    if (!match) {
      toast.error('Produkti nuk u gjet te ky furnitor')
      setProductSearch('')
      return
    }
    setQty((prev) => ({ ...prev, [match.id]: (prev[match.id] ?? 0) + 1 }))
    setProductSearch('')
    toast.success(`${match.emri} +1`)
  }

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
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body.error || 'Gabim gjatë ruajtjes')
        return
      }
      toast.success('Furnizimi u ruajt me sukses')
      await refresh()
      router.push('/furnizime')
    } catch {
      toast.error('Gabim gjatë ruajtjes')
    } finally {
      setSaving(false)
    }
  }

  if (!role || !['admin', 'staff'].includes(role)) return <AccessDenied />

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
              onToggleUpdatePrice={(id) =>
                setUpdatePrice((p) => ({ ...p, [id]: !p[id] }))
              }
              emptyMessage="Asnjë produkt për këtë furnitor"
            />
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
                  disabled={saving || entered.length === 0}
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
    </div>
  )
}
