'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import { useRole } from '@/contexts/RoleContext'
import AccessDenied from '@/components/AccessDenied'
import PageHeader from '@/components/ui/PageHeader'
import SearchInput from '@/components/ui/SearchInput'
import TableSkeleton from '@/components/ui/TableSkeleton'
import ErrorState from '@/components/ui/ErrorState'
import Modal from '@/components/ui/Modal'
import { useCatalog, type CatalogProduct } from '@/lib/catalog'
import { formatCurrency, formatDate } from '@/lib/utils'
import { rowDelay } from '@/lib/animation'
import { isWeightedUnit } from '@/lib/validation'
import {
  RiHomeHeartLine,
  RiDeleteBin6Line,
  RiAddLine,
  RiLoader4Line,
} from 'react-icons/ri'

interface Entry {
  id: number
  productId: number
  emriProduktit: string
  sasia: number
  njesia: string
  cmimiBlerjes: number
  totali: number
  data: string
  userEmail: string
  shenime: string | null
}

interface MonthTotal {
  muaji: string
  totali: number
  numri: number
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

  // Entry form
  const [kerkimi, setKerkimi] = useState('')
  const [selected, setSelected] = useState<CatalogProduct | null>(null)
  const [sasia, setSasia] = useState('1')
  const [data, setData] = useState(todayString())
  const [shenime, setShenime] = useState('')
  const [saving, setSaving] = useState(false)
  const [toDelete, setToDelete] = useState<Entry | null>(null)
  const [deleting, setDeleting] = useState(false)

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

  const suggestions = useMemo(() => {
    if (selected || !kerkimi.trim()) return []
    return search(kerkimi).slice(0, 8)
  }, [search, kerkimi, selected])

  function choose(p: CatalogProduct) {
    setSelected(p)
    setKerkimi('')
    setSasia(isWeightedUnit(p.njesia) ? '1' : '1')
  }

  // A scan picks the product outright and skips the suggestion list.
  function handleScan(code: string) {
    const match = findByBarcode(code)
    if (match) {
      choose(match)
      toast.success(match.emri)
    } else {
      const hits = search(code)
      if (hits.length === 1) choose(hits[0])
      else if (hits.length === 0) toast.error('Produkti nuk u gjet')
    }
  }

  async function save() {
    if (!selected) {
      toast.error('Zgjidh një produkt')
      return
    }
    const qty = Number(sasia)
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error('Sasia duhet të jetë pozitive')
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/personal-use', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: selected.id,
          sasia: qty,
          data,
          shenime: shenime || null,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body.error || 'Gabim gjatë ruajtjes')
        return
      }
      toast.success('U regjistrua')
      setSelected(null)
      setSasia('1')
      setShenime('')
      await Promise.all([fetchEntries(), refreshCatalog()])
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

  if (!role || role !== 'admin') return <AccessDenied />

  const current = selected ? products.find((p) => p.id === selected.id) ?? selected : null
  const previewCost = current && Number(sasia) > 0 ? (current.cmimiBlerjes ?? 0) * Number(sasia) : 0

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Përdorim Vetjak"
        subtitle="Produkte të marra për përdorim personal — ulin stokun, nuk janë shitje"
      />

      {/* Entry form */}
      <div className="card p-4 mb-6">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_120px_160px_minmax(0,1fr)_auto] gap-3 items-start">
          <div className="relative">
            {selected ? (
              <div className="flex items-center gap-2 h-[42px] px-3 rounded-xl border border-blue-200 bg-blue-50">
                <span className="font-medium text-slate-800 truncate">{selected.emri}</span>
                <span className="text-xs text-slate-400">{selected.njesia}</span>
                <button
                  onClick={() => setSelected(null)}
                  className="ml-auto text-xs text-blue-600 hover:underline whitespace-nowrap"
                >
                  Ndrysho
                </button>
              </div>
            ) : (
              <>
                <SearchInput
                  variant="barcode"
                  value={kerkimi}
                  onChange={setKerkimi}
                  onSubmit={handleScan}
                  autoFocus
                  placeholder="Kërko ose skano produktin..."
                />
                {suggestions.length > 0 && (
                  <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-64 overflow-y-auto">
                    {suggestions.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => choose(p)}
                        className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-blue-50"
                      >
                        <span className="truncate text-slate-800">{p.emri}</span>
                        <span className="text-xs text-slate-400 whitespace-nowrap">
                          {p.sasia} {p.njesia}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <input
            type="number"
            min="0"
            step={current && isWeightedUnit(current.njesia) ? '0.001' : '1'}
            value={sasia}
            onChange={(e) => setSasia(e.target.value)}
            className="input text-center tabular-nums"
            aria-label="Sasia"
            placeholder="Sasia"
          />

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

          <button
            onClick={save}
            disabled={saving || !selected}
            className="btn-primary flex items-center gap-2 whitespace-nowrap h-[42px]"
          >
            {saving ? <RiLoader4Line className="animate-spin" /> : <RiAddLine className="text-lg" />}
            Regjistro
          </button>
        </div>

        {current && (
          <p className="text-xs text-slate-500 mt-2.5 pl-0.5">
            Stoku aktual: <strong className="text-slate-700">{current.sasia} {current.njesia}</strong>
            {previewCost > 0 && (
              <>
                {' · '}Kosto: <strong className="text-slate-700">{formatCurrency(previewCost)}</strong>
              </>
            )}
          </p>
        )}
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
          <input type="date" value={nga} onChange={(e) => setNga(e.target.value)} className="input sm:w-44" />
          <label className="text-sm text-slate-500 whitespace-nowrap">Deri</label>
          <input type="date" value={deri} onChange={(e) => setDeri(e.target.value)} className="input sm:w-44" />
          {(nga || deri) && (
            <button onClick={() => { setNga(''); setDeri('') }} className="btn-secondary text-sm">
              Pastro
            </button>
          )}
          <div className="sm:ml-auto text-sm">
            <span className="text-slate-500">Kosto totale</span>
            <span className="ml-2 font-bold text-slate-900 tabular-nums">{formatCurrency(totali)}</span>
          </div>
        </div>
      </div>

      {/* History */}
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
                  <th className="table-th">Data</th>
                  <th className="table-th">Produkti</th>
                  <th className="table-th text-center">Sasia</th>
                  <th className="table-th text-right">Kosto</th>
                  <th className="table-th">Shënim</th>
                  <th className="table-th text-center">Fshi</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e, idx) => (
                  <motion.tr
                    key={e.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: rowDelay(idx) }}
                    className="table-row"
                  >
                    <td className="table-td text-slate-500 whitespace-nowrap">{formatDate(e.data)}</td>
                    <td className="table-td font-medium text-slate-800">{e.emriProduktit}</td>
                    <td className="table-td text-center tabular-nums">
                      {e.sasia} <span className="text-slate-400 text-xs">{e.njesia}</span>
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
                  </motion.tr>
                ))}
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
        <p className="text-slate-600 mb-5">
          Fshi regjistrimin për{' '}
          <strong className="text-slate-900">{toDelete?.emriProduktit}</strong>? Sasia{' '}
          <strong>{toDelete?.sasia} {toDelete?.njesia}</strong> do t&apos;i kthehet stokut.
        </p>
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
