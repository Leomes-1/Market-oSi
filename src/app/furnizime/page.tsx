'use client'

import Link from 'next/link'

import { useEffect, useState, useCallback } from 'react'
import { useRole } from '@/contexts/RoleContext'
import AccessDenied from '@/components/AccessDenied'
import toast from 'react-hot-toast'
import Modal from '@/components/ui/Modal'
import PageHeader from '@/components/ui/PageHeader'
import { formatCurrency, formatDate, toArray } from '@/lib/utils'
import { rowDelayStyle } from '@/lib/animation'
import TableSkeleton from '@/components/ui/TableSkeleton'
import ErrorState from '@/components/ui/ErrorState'
import {
  RiBox3Line,
  RiAddLine,
  RiDeleteBin6Line,
  RiArrowDownLine,
} from 'react-icons/ri'

interface SupplyItemData {
  id: number
  productId: number
  emriProduktit: string
  sasia: number
  njesia: string
  cmimiBlerjes: number
  totali: number
  product: { id: number; emri: string; njesia: string } | null
}

interface Supply {
  id: number
  furnitorId: number | null
  furnitor: { id: number; emri: string } | null
  data: string
  shenime: string | null
  totali: number
  createdAt: string
  items: SupplyItemData[]
}

function isWeighted(njesia: string) {
  return njesia === 'kg' || njesia === 'gram' || njesia === 'litër'
}

const PERIUDHAT = [
  { value: 'te-gjitha', label: 'Të Gjitha' },
  { value: 'muaj', label: 'Ky Muaj' },
  { value: 'jave', label: 'Kjo Javë' },
  { value: 'sot', label: 'Sot' },
]

export default function FurnizimePage() {
  const { role } = useRole()
  const [supplies, setSupplies] = useState<Supply[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [periudha, setPeriudha] = useState('te-gjitha')

  // Create modal

  // Detail / delete modals
  const [selectedSupply, setSelectedSupply] = useState<Supply | null>(null)
  const [supplyToDelete, setSupplyToDelete] = useState<Supply | null>(null)
  const [deleting, setDeleting] = useState(false)

  const fetchSupplies = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const res = await fetch('/api/supplies')
      if (res.status === 401) { window.location.href = '/login'; return }
      if (!res.ok) throw new Error()
      const data = await res.json()
      setSupplies(toArray<Supply>(data, 'supplies'))
    } catch {
      setError(true)
      toast.error('Gabim gjatë ngarkimit')
    } finally {
      setLoading(false)
    }
  }, [])


  useEffect(() => {
    fetchSupplies()
  }, [fetchSupplies])



  const handleDelete = async () => {
    if (!supplyToDelete) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/supplies/${supplyToDelete.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      toast.success('Furnizimi u fshi. Stoku u përditësua.')
      setSupplyToDelete(null)
      fetchSupplies()
    } catch {
      toast.error('Fshirja dështoi')
    } finally {
      setDeleting(false)
    }
  }

  // Client-side period filter
  const filteredSupplies = supplies.filter((s) => {
    if (periudha === 'te-gjitha') return true
    const now = new Date()
    const sDate = new Date(s.data)
    if (periudha === 'sot') {
      return (
        sDate.getFullYear() === now.getFullYear() &&
        sDate.getMonth() === now.getMonth() &&
        sDate.getDate() === now.getDate()
      )
    }
    if (periudha === 'jave') {
      const weekAgo = new Date(now)
      weekAgo.setDate(weekAgo.getDate() - 7)
      weekAgo.setHours(0, 0, 0, 0)
      return sDate >= weekAgo
    }
    if (periudha === 'muaj') {
      return sDate.getMonth() === now.getMonth() && sDate.getFullYear() === now.getFullYear()
    }
    return true
  })

  const totalCost = filteredSupplies.reduce((sum, s) => sum + s.totali, 0)
  const totalItems = filteredSupplies.reduce((sum, s) => sum + s.items.length, 0)

  if (!role || !['admin', 'staff'].includes(role)) return <AccessDenied />

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Furnizime"
        subtitle={`${filteredSupplies.length} furnizime · Historia e Stokut`}
        action={
          <Link href="/furnizime/i-ri" className="btn-primary flex items-center gap-2">
            <RiAddLine className="text-base" />
            Shto Furnizim
          </Link>
        }
      />

      {/* Period Filter */}
      <div className="flex flex-wrap gap-2 mb-6">
        {PERIUDHAT.map((p) => (
          <button
            key={p.value}
            onClick={() => setPeriudha(p.value)}
            className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
              periudha === p.value
                ? 'bg-blue-600 text-white'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Summary Cards */}
      {filteredSupplies.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-4 mb-6">
          <div className="card p-3 sm:p-4">
            <p className="text-xs font-medium text-slate-500 mb-1">Furnizime</p>
            <p className="text-base sm:text-xl font-bold text-slate-900">{filteredSupplies.length}</p>
          </div>
          <div className="card p-3 sm:p-4">
            <p className="text-xs font-medium text-slate-500 mb-1">Kostoja</p>
            <p className="text-base sm:text-xl font-bold text-slate-900">{formatCurrency(totalCost)}</p>
          </div>
          <div className="card p-3 sm:p-4 col-span-2 sm:col-span-1">
            <p className="text-xs font-medium text-slate-500 mb-1">Produkte Furnizuara</p>
            <p className="text-base sm:text-xl font-bold text-slate-900">{totalItems}</p>
          </div>
        </div>
      )}

      {/* Supply History Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <TableSkeleton rows={5} cols={7} />
        ) : error ? (
          <ErrorState message="Gabim gjatë ngarkimit të furnizimeve" onRetry={fetchSupplies} />
        ) : filteredSupplies.length === 0 ? (
          <div className="p-12 text-center">
            <RiBox3Line className="text-4xl text-slate-200 mx-auto mb-3" />
            <p className="text-slate-400 mb-4">Nuk ka furnizime për këtë periudhë</p>
            <Link href="/furnizime/i-ri" className="btn-primary">
              Shto Furnizimin e Parë
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="table-th">Furnizimi #</th>
                  <th className="table-th">Data</th>
                  <th className="table-th">Furnitori</th>
                  <th className="table-th">Produktet</th>
                  <th className="table-th text-center">Artikuj</th>
                  <th className="table-th text-right">Totali</th>
                  <th className="table-th text-center">Detaje</th>
                  <th className="table-th text-center">Fshi</th>
                </tr>
              </thead>
              <tbody>
                {filteredSupplies.map((supply, idx) => (
                  <tr
                    key={supply.id}
                    style={rowDelayStyle(idx)}
                    className="table-row anim-fade-in"
                  >
                    <td className="table-td font-mono font-semibold text-blue-600">
                      #{supply.id}
                    </td>
                    <td className="table-td text-slate-500">
                      {formatDate(supply.data)}
                    </td>
                    <td className="table-td">
                      {supply.furnitor?.emri ? (
                        <span className="font-medium text-slate-700">{supply.furnitor.emri}</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="table-td">
                      <span className="text-slate-700">
                        {supply.items.slice(0, 2).map((i) => i.emriProduktit).join(', ')}
                        {supply.items.length > 2 ? ` +${supply.items.length - 2} të tjerë` : ''}
                      </span>
                    </td>
                    <td className="table-td text-center">
                      <span className="badge-gray">{supply.items.length}</span>
                    </td>
                    <td className="table-td text-right font-semibold text-slate-900">
                      {formatCurrency(supply.totali)}
                    </td>
                    <td className="table-td text-center">
                      <button
                        onClick={() => setSelectedSupply(supply)}
                        className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title="Shiko detajet"
                      >
                        <RiArrowDownLine className="text-lg" />
                      </button>
                    </td>
                    <td className="table-td text-center">
                      <button
                        onClick={() => setSupplyToDelete(supply)}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Fshi furnizimin"
                      >
                        <RiDeleteBin6Line className="text-lg" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Supply Detail Modal ── */}
      <Modal
        isOpen={!!selectedSupply}
        onClose={() => setSelectedSupply(null)}
        title={`Detajet e Furnizimit #${selectedSupply?.id}`}
        size="lg"
      >
        {selectedSupply && (
          <div>
            <div className="grid grid-cols-2 gap-3 mb-5 p-4 bg-slate-50 rounded-xl text-sm">
              <div>
                <p className="text-xs text-slate-400 mb-0.5">Furnitori</p>
                <p className="font-medium text-slate-900">
                  {selectedSupply.furnitor?.emri || '—'}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-0.5">Data</p>
                <p className="font-medium text-slate-900">{formatDate(selectedSupply.data)}</p>
              </div>
              {selectedSupply.shenime && (
                <div className="col-span-2">
                  <p className="text-xs text-slate-400 mb-0.5">Shënime</p>
                  <p className="text-slate-700">{selectedSupply.shenime}</p>
                </div>
              )}
            </div>

            <div className="border border-slate-200 rounded-xl overflow-hidden mb-4">
              <table className="w-full">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="table-th">Produkti</th>
                    <th className="table-th text-center">Sasia</th>
                    <th className="table-th text-center">Njësia</th>
                    <th className="table-th text-right">Çm. Blerjes</th>
                    <th className="table-th text-right">Totali</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedSupply.items.map((item) => (
                    <tr key={item.id} className="border-t border-slate-100">
                      <td className="table-td font-medium">{item.emriProduktit}</td>
                      <td className="table-td text-center">
                        {isWeighted(item.njesia)
                          ? item.sasia.toFixed(3)
                          : item.sasia}
                      </td>
                      <td className="table-td text-center text-slate-400">{item.njesia}</td>
                      <td className="table-td text-right">{formatCurrency(item.cmimiBlerjes)}</td>
                      <td className="table-td text-right font-semibold">
                        {formatCurrency(item.totali)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="bg-slate-50 rounded-xl p-4 mb-4">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Totali i Furnizimit</span>
                <span className="font-bold text-slate-900 text-base">
                  {formatCurrency(selectedSupply.totali)}
                </span>
              </div>
              <div className="flex justify-between text-xs text-slate-400 mt-1">
                <span>{selectedSupply.items.length} produkte të furnizuara</span>
              </div>
            </div>

            <button onClick={() => setSelectedSupply(null)} className="btn-secondary w-full">
              Mbyll
            </button>
          </div>
        )}
      </Modal>

      {/* ── Delete Confirmation Modal ── */}
      <Modal
        isOpen={!!supplyToDelete}
        onClose={() => !deleting && setSupplyToDelete(null)}
        title="Fshi Furnizimin"
        size="sm"
      >
        {supplyToDelete && (
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                <RiDeleteBin6Line className="text-red-600 text-xl" />
              </div>
              <p className="text-slate-700 text-sm leading-relaxed">
                A je i sigurt që dëshiron ta fshish këtë furnizim?
              </p>
            </div>
            <div className="bg-slate-50 rounded-xl p-3 mb-4 text-sm space-y-1">
              <div className="flex justify-between text-slate-600">
                <span>Furnizimi</span>
                <span className="font-mono font-semibold text-blue-600">
                  #{supplyToDelete.id}
                </span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Totali</span>
                <span className="font-semibold">{formatCurrency(supplyToDelete.totali)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Produkte</span>
                <span>{supplyToDelete.items.length} artikuj</span>
              </div>
            </div>
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-5">
              Stoku i produkteve do të ulet automatikisht pas fshirjes.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setSupplyToDelete(null)}
                disabled={deleting}
                className="btn-secondary flex-1"
              >
                Anulo
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm font-medium rounded-xl transition-colors"
              >
                {deleting ? 'Duke fshirë...' : 'Fshi Furnizimin'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
