'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { useRole } from '@/contexts/RoleContext'
import AccessDenied from '@/components/AccessDenied'
import PageHeader from '@/components/ui/PageHeader'
import SearchInput from '@/components/ui/SearchInput'
import TableSkeleton from '@/components/ui/TableSkeleton'
import ErrorState from '@/components/ui/ErrorState'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import { RiDownloadLine, RiArchiveLine } from 'react-icons/ri'

/**
 * Inventari (admin only).
 *
 *   Inventari i plotë  every product: stock, purchase value, sale value
 *   Me faturë          invoiced ("Me TVSH") stock, plus a month/year summary
 *
 * No VAT rates or VAT amounts: prices are as entered from the invoices.
 */

interface InventoryRow {
  id: number
  emri: string
  kategoria: string
  njesia: string
  tracked: boolean
  sasia: number | null
  sasiaFaturuar: number
  vleraBlerje: number | null
  vleraShitje: number | null
  vleraFaturuar: number
}

interface InvoiceLine {
  productId: number
  emriProduktit: string
  kategoria: string
  sasia: number
  njesia: string
  cmimiBlerjes: number
  totali: number
}

interface Invoice {
  id: number
  data: string
  nrFatures: string | null
  furnitor: string | null
  totali: number
  items: InvoiceLine[]
}

interface SummaryRow {
  productId: number
  emri: string
  kategoria: string
  njesia: string
  tracked: boolean
  bleraNjesi: number
  bleraVlera: number
  shituraNjesi: number
  shituraTeArdhura: number
  vetjakNjesi: number
  vetjakKosto: number
  stokFundNjesi: number
  stokFundVlera: number
}

interface Summary {
  periudha: { lloji: 'muaj' | 'vit'; label: string; nga: string; deri: string }
  faturat: Invoice[]
  produktet: SummaryRow[]
}

type Tab = 'plote' | 'fature'

const ALL = '__te_gjitha__'

function qty(n: number): string {
  return String(Number(n.toFixed(3)))
}

function thisMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function periodLabel(p: Summary['periudha'] | null): string {
  if (!p) return ''
  if (p.lloji === 'vit') return `viti ${p.label}`
  const [y, m] = p.label.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('sq-AL', { month: 'long', year: 'numeric' })
}

// ── CSV ────────────────────────────────────────────────────────────────────

type Cell = string | number | null | undefined

function csvCell(v: Cell): string {
  if (v === null || v === undefined) return ''
  const s = typeof v === 'number' ? String(Number(v.toFixed(3))) : v
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function downloadCsv(filename: string, rows: Cell[][]) {
  // BOM so Excel reads the file as UTF-8 (ë, ç).
  const text = '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

const money = (n: number) => Math.round(n * 100) / 100

// ── Page ───────────────────────────────────────────────────────────────────

export default function InventariPage() {
  const { role } = useRole()
  const [tab, setTab] = useState<Tab>('plote')
  const [rows, setRows] = useState<InventoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [search, setSearch] = useState('')
  const [kategoria, setKategoria] = useState(ALL)

  const [mode, setMode] = useState<'muaj' | 'vit'>('muaj')
  const [muaji, setMuaji] = useState(thisMonth())
  const [viti, setViti] = useState(String(new Date().getFullYear()))
  const [summary, setSummary] = useState<Summary | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryError, setSummaryError] = useState(false)

  const isAdmin = role === 'admin'

  const load = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const res = await fetch('/api/inventari')
      if (res.status === 401) { window.location.href = '/login'; return }
      if (!res.ok) throw new Error()
      const data = await res.json()
      setRows(Array.isArray(data?.products) ? data.products : [])
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  const period = mode === 'muaj' ? `muaji=${muaji}` : `viti=${viti}`

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true)
    setSummaryError(false)
    try {
      const res = await fetch(`/api/inventari/permbledhje?${period}`)
      if (res.status === 401) { window.location.href = '/login'; return }
      if (!res.ok) throw new Error()
      setSummary(await res.json())
    } catch {
      setSummaryError(true)
    } finally {
      setSummaryLoading(false)
    }
  }, [period])

  useEffect(() => {
    if (isAdmin) load()
  }, [isAdmin, load])

  useEffect(() => {
    if (isAdmin && tab === 'fature' && /^\d{4}(-\d{2})?$/.test(mode === 'muaj' ? muaji : viti)) {
      loadSummary()
    }
  }, [isAdmin, tab, mode, muaji, viti, loadSummary])

  const kategorite = useMemo(
    () => Array.from(new Set(rows.map((r) => r.kategoria))).sort((a, b) => a.localeCompare(b)),
    [rows]
  )

  const matches = useCallback(
    (emri: string, kat: string) => {
      if (kategoria !== ALL && kat !== kategoria) return false
      const q = search.trim().toLowerCase()
      return !q || emri.toLowerCase().includes(q) || kat.toLowerCase().includes(q)
    },
    [search, kategoria]
  )

  const plote = useMemo(() => rows.filter((r) => matches(r.emri, r.kategoria)), [rows, matches])
  const fature = useMemo(() => plote.filter((r) => r.sasiaFaturuar > 0), [plote])

  const ploteTotals = useMemo(
    () => ({
      produkte: plote.length,
      blerje: plote.reduce((s, r) => s + (r.vleraBlerje ?? 0), 0),
      shitje: plote.reduce((s, r) => s + (r.vleraShitje ?? 0), 0),
    }),
    [plote]
  )
  const fatureTotals = useMemo(
    () => ({
      produkte: fature.length,
      njesi: fature.reduce((s, r) => s + r.sasiaFaturuar, 0),
      blerje: fature.reduce((s, r) => s + r.vleraFaturuar, 0),
    }),
    [fature]
  )

  // The summary follows the same search and category filter. An invoice shows
  // only its matching lines, valued at those lines.
  const sumRows = useMemo(
    () => (summary?.produktet ?? []).filter((r) => matches(r.emri, r.kategoria)),
    [summary, matches]
  )
  const sumInvoices = useMemo(
    () =>
      (summary?.faturat ?? [])
        .map((f) => {
          const items = f.items.filter((i) => matches(i.emriProduktit, i.kategoria))
          return { ...f, items, vlera: items.reduce((s, i) => s + i.totali, 0) }
        })
        .filter((f) => f.items.length > 0),
    [summary, matches]
  )
  const sumTotals = useMemo(
    () => ({
      faturaVlera: sumInvoices.reduce((s, f) => s + f.vlera, 0),
      shituraNjesi: sumRows.reduce((s, r) => s + r.shituraNjesi, 0),
      shituraTeArdhura: sumRows.reduce((s, r) => s + r.shituraTeArdhura, 0),
      vetjakNjesi: sumRows.reduce((s, r) => s + r.vetjakNjesi, 0),
      stokFundNjesi: sumRows.reduce((s, r) => s + r.stokFundNjesi, 0),
      stokFundVlera: sumRows.reduce((s, r) => s + r.stokFundVlera, 0),
    }),
    [sumInvoices, sumRows]
  )

  const filterNote =
    search.trim() || kategoria !== ALL
      ? [`Filtri: ${search.trim() || '—'}`, kategoria !== ALL ? `kategoria ${kategoria}` : ''].filter(Boolean).join(', ')
      : null
  const today = new Date().toISOString().slice(0, 10)

  function exportPlote() {
    const out: Cell[][] = [
      ['Produkti', 'Kategoria', 'Njësia', 'Stoku', 'Vlera blerje (L)', 'Vlera shitje (L)'],
      ...plote.map((r) => [
        r.emri,
        r.kategoria,
        r.njesia,
        r.tracked ? r.sasia : 'pa stok (kg)',
        r.vleraBlerje === null ? null : money(r.vleraBlerje),
        r.vleraShitje === null ? null : money(r.vleraShitje),
      ]),
      [],
      ['TOTALI', `${ploteTotals.produkte} produkte`, '', '', money(ploteTotals.blerje), money(ploteTotals.shitje)],
    ]
    if (filterNote) out.push([filterNote])
    downloadCsv(`inventari-i-plote-${today}.csv`, out)
  }

  function exportFature() {
    const out: Cell[][] = [
      ['STOKU ME FATURË (sot)'],
      ['Produkti', 'Kategoria', 'Njësia', 'Njësi me faturë', 'Vlera blerje (L)'],
      ...fature.map((r) => [r.emri, r.kategoria, r.njesia, r.sasiaFaturuar, money(r.vleraFaturuar)]),
      ['TOTALI', `${fatureTotals.produkte} produkte`, '', fatureTotals.njesi, money(fatureTotals.blerje)],
    ]
    if (summary) {
      out.push(
        [],
        [`PËRMBLEDHJA — ${periodLabel(summary.periudha)}`],
        [],
        ['BLERJE ME FATURË'],
        ['Data', 'Furnizimi #', 'Nr. i faturës', 'Furnitori', 'Vlera (L)'],
        ...sumInvoices.map((f) => [
          formatDate(f.data),
          f.id,
          f.nrFatures ?? '',
          f.furnitor ?? '',
          money(f.vlera),
        ]),
        ['TOTALI', `${sumInvoices.length} fatura`, '', '', money(sumTotals.faturaVlera)],
        [],
        ['SIPAS PRODUKTIT'],
        [
          'Produkti',
          'Kategoria',
          'Njësia',
          'Blerë me faturë (njësi)',
          'Blerë me faturë (L)',
          'Shitur nga fatura (njësi)',
          'Të ardhura (L)',
          'Përdorim vetjak (njësi)',
          'Stoku me faturë në fund (njësi)',
          'Vlera në fund (L, çmimet e sotme)',
        ],
        ...sumRows.map((r) => [
          r.emri,
          r.kategoria,
          r.njesia,
          r.bleraNjesi,
          money(r.bleraVlera),
          r.shituraNjesi,
          money(r.shituraTeArdhura),
          r.vetjakNjesi,
          r.tracked ? r.stokFundNjesi : 'pa stok (kg)',
          r.tracked ? money(r.stokFundVlera) : null,
        ]),
        [
          'TOTALI',
          '',
          '',
          '',
          money(sumRows.reduce((s, r) => s + r.bleraVlera, 0)),
          sumTotals.shituraNjesi,
          money(sumTotals.shituraTeArdhura),
          sumTotals.vetjakNjesi,
          sumTotals.stokFundNjesi,
          money(sumTotals.stokFundVlera),
        ]
      )
    }
    if (filterNote) out.push([], [filterNote])
    const suffix = summary ? summary.periudha.label : today
    downloadCsv(`inventari-me-fature-${suffix}.csv`, out)
    if (!summary) toast('Përmbledhja nuk është ngarkuar — u eksportua vetëm stoku')
  }

  if (!isAdmin) return <AccessDenied />

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Inventari"
        subtitle="Stoku dhe vlera e tij · pa llogaritje TVSH-je"
        action={
          <button
            onClick={tab === 'plote' ? exportPlote : exportFature}
            disabled={loading || error}
            className="btn-secondary flex items-center gap-2"
          >
            <RiDownloadLine className="text-base" />
            Eksporto CSV
          </button>
        }
      />

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        {(
          [
            { key: 'plote', label: 'Inventari i plotë' },
            { key: 'fature', label: 'Me faturë' },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'px-4 py-2.5 rounded-lg text-sm font-medium transition-all',
              tab === t.key
                ? 'bg-blue-600 text-white'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Filters (shared by both tabs) */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <SearchInput
          className="flex-1"
          value={search}
          onChange={setSearch}
          placeholder="Kërko produkt ose kategori..."
        />
        <select
          value={kategoria}
          onChange={(e) => setKategoria(e.target.value)}
          className="input sm:w-56"
          aria-label="Kategoria"
        >
          <option value={ALL}>Të gjitha kategoritë</option>
          {kategorite.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="card overflow-hidden">
          <TableSkeleton rows={8} cols={5} />
        </div>
      ) : error ? (
        <div className="card overflow-hidden">
          <ErrorState message="Gabim gjatë ngarkimit të inventarit" onRetry={load} />
        </div>
      ) : tab === 'plote' ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-4 mb-6">
            <Stat label="Produkte" value={String(ploteTotals.produkte)} />
            <Stat label="Vlera me çmim blerje" value={formatCurrency(ploteTotals.blerje)} />
            <Stat
              label="Vlera me çmim shitje"
              value={formatCurrency(ploteTotals.shitje)}
              className="col-span-2 sm:col-span-1"
            />
          </div>
          <div className="card overflow-hidden">
            {plote.length === 0 ? (
              <Empty text="Asnjë produkt nuk përputhet" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 border-b border-slate-100">
                    <tr>
                      <th className="table-th">Produkti</th>
                      <th className="table-th">Kategoria</th>
                      <th className="table-th text-right">Stoku</th>
                      <th className="table-th text-right">Vlera blerje</th>
                      <th className="table-th text-right">Vlera shitje</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plote.map((r) => (
                      <tr key={r.id} className="table-row">
                        <td className="table-td font-medium text-slate-800">{r.emri}</td>
                        <td className="table-td text-slate-500">{r.kategoria}</td>
                        <td className="table-td text-right tabular-nums">
                          {r.tracked ? (
                            <>
                              {qty(r.sasia ?? 0)} <span className="text-slate-400">{r.njesia}</span>
                            </>
                          ) : (
                            <span className="text-slate-400" title="Produktet me kg nuk kanë stok">
                              —
                            </span>
                          )}
                        </td>
                        <td className="table-td text-right tabular-nums">
                          {r.vleraBlerje === null ? '—' : formatCurrency(r.vleraBlerje)}
                        </td>
                        <td className="table-td text-right tabular-nums">
                          {r.vleraShitje === null ? '—' : formatCurrency(r.vleraShitje)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-50 border-t border-slate-200">
                    <tr>
                      <td className="table-td font-bold" colSpan={3}>
                        Totali i dyqanit
                      </td>
                      <td className="table-td text-right font-bold tabular-nums">
                        {formatCurrency(ploteTotals.blerje)}
                      </td>
                      <td className="table-td text-right font-bold tabular-nums">
                        {formatCurrency(ploteTotals.shitje)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-3">
            Produktet me kg nuk kanë stok, prandaj nuk hyjnë në vlerë. Kur pret një ndryshim çmimi,
            njësitë e vjetra llogariten me çmimin e vjetër dhe të rejat me të riun.
          </p>
        </>
      ) : (
        <>
          {/* Invoiced stock today */}
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Stoku me faturë sot</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-4 mb-4">
            <Stat label="Produkte" value={String(fatureTotals.produkte)} />
            <Stat label="Njësi me faturë" value={qty(fatureTotals.njesi)} />
            <Stat
              label="Vlera me çmim blerje"
              value={formatCurrency(fatureTotals.blerje)}
              className="col-span-2 sm:col-span-1"
            />
          </div>
          <div className="card overflow-hidden mb-8">
            {fature.length === 0 ? (
              <Empty text="Nuk ka stok me faturë" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 border-b border-slate-100">
                    <tr>
                      <th className="table-th">Produkti</th>
                      <th className="table-th">Kategoria</th>
                      <th className="table-th text-right">Njësi me faturë</th>
                      <th className="table-th text-right">Vlera blerje</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fature.map((r) => (
                      <tr key={r.id} className="table-row">
                        <td className="table-td font-medium text-slate-800">{r.emri}</td>
                        <td className="table-td text-slate-500">{r.kategoria}</td>
                        <td className="table-td text-right tabular-nums">
                          {qty(r.sasiaFaturuar)} <span className="text-slate-400">{r.njesia}</span>
                          <span className="text-xs text-slate-400 ml-1">/ {qty(r.sasia ?? 0)}</span>
                        </td>
                        <td className="table-td text-right tabular-nums">
                          {formatCurrency(r.vleraFaturuar)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-50 border-t border-slate-200">
                    <tr>
                      <td className="table-td font-bold" colSpan={2}>
                        Totali
                      </td>
                      <td className="table-td text-right font-bold tabular-nums">
                        {qty(fatureTotals.njesi)}
                      </td>
                      <td className="table-td text-right font-bold tabular-nums">
                        {formatCurrency(fatureTotals.blerje)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          {/* Period summary */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
            <h2 className="text-sm font-semibold text-slate-700 sm:mr-auto">
              Përmbledhja {summary ? `· ${periodLabel(summary.periudha)}` : ''}
            </h2>
            <div className="flex gap-2">
              {(['muaj', 'vit'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={cn(
                    'px-3 py-2 rounded-lg text-sm font-medium transition-all',
                    mode === m
                      ? 'bg-slate-800 text-white'
                      : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                  )}
                >
                  {m === 'muaj' ? 'Muaj' : 'Vit'}
                </button>
              ))}
            </div>
            {mode === 'muaj' ? (
              <input
                type="month"
                value={muaji}
                onChange={(e) => e.target.value && setMuaji(e.target.value)}
                className="input sm:w-44"
                aria-label="Muaji"
              />
            ) : (
              <select
                value={viti}
                onChange={(e) => setViti(e.target.value)}
                className="input sm:w-32"
                aria-label="Viti"
              >
                {Array.from({ length: new Date().getFullYear() - 2023 }, (_, i) =>
                  String(new Date().getFullYear() - i)
                ).map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            )}
          </div>

          {summaryLoading && !summary ? (
            <div className="card overflow-hidden">
              <TableSkeleton rows={4} cols={5} />
            </div>
          ) : summaryError ? (
            <div className="card overflow-hidden">
              <ErrorState message="Gabim gjatë ngarkimit të përmbledhjes" onRetry={loadSummary} />
            </div>
          ) : summary ? (
            <div className={cn(summaryLoading && 'opacity-60 transition-opacity')}>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4 mb-6">
                <Stat
                  label={`Blerje me faturë · ${sumInvoices.length} fatura`}
                  value={formatCurrency(sumTotals.faturaVlera)}
                />
                <Stat label="Njësi të shitura nga fatura" value={qty(sumTotals.shituraNjesi)} />
                <Stat label="Të ardhurat e tyre" value={formatCurrency(sumTotals.shituraTeArdhura)} />
                <Stat
                  label="Stoku me faturë në fund"
                  value={`${qty(sumTotals.stokFundNjesi)} njësi`}
                  hint={formatCurrency(sumTotals.stokFundVlera)}
                />
              </div>

              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
                Faturat e blerjes
              </h3>
              <div className="card overflow-hidden mb-6">
                {sumInvoices.length === 0 ? (
                  <Empty text="Asnjë furnizim me TVSH në këtë periudhë" />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-slate-50 border-b border-slate-100">
                        <tr>
                          <th className="table-th">Data</th>
                          <th className="table-th">Furnizimi</th>
                          <th className="table-th">Nr. i faturës</th>
                          <th className="table-th">Furnitori</th>
                          <th className="table-th text-center">Artikuj</th>
                          <th className="table-th text-right">Vlera</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sumInvoices.map((f) => (
                          <tr key={f.id} className="table-row">
                            <td className="table-td text-slate-500">{formatDate(f.data)}</td>
                            <td className="table-td font-mono font-semibold text-blue-600">#{f.id}</td>
                            <td className="table-td">{f.nrFatures ?? <span className="text-slate-400">—</span>}</td>
                            <td className="table-td">{f.furnitor ?? <span className="text-slate-400">—</span>}</td>
                            <td className="table-td text-center">
                              <span className="badge-gray">{f.items.length}</span>
                            </td>
                            <td className="table-td text-right font-semibold tabular-nums">
                              {formatCurrency(f.vlera)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-slate-50 border-t border-slate-200">
                        <tr>
                          <td className="table-td font-bold" colSpan={5}>
                            Totali
                          </td>
                          <td className="table-td text-right font-bold tabular-nums">
                            {formatCurrency(sumTotals.faturaVlera)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>

              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
                Sipas produktit
              </h3>
              <div className="card overflow-hidden">
                {sumRows.length === 0 ? (
                  <Empty text="Asnjë lëvizje me faturë në këtë periudhë" />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-slate-50 border-b border-slate-100">
                        <tr>
                          <th className="table-th">Produkti</th>
                          <th className="table-th text-right">Blerë</th>
                          <th className="table-th text-right">Shitur</th>
                          <th className="table-th text-right">Të ardhura</th>
                          <th className="table-th text-right">Vetjak</th>
                          <th className="table-th text-right">Në fund</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sumRows.map((r) => (
                          <tr key={r.productId} className="table-row">
                            <td className="table-td">
                              <span className="font-medium text-slate-800">{r.emri}</span>
                              <span className="block text-xs text-slate-400">{r.kategoria}</span>
                            </td>
                            <td className="table-td text-right tabular-nums">
                              {qty(r.bleraNjesi)} <span className="text-slate-400">{r.njesia}</span>
                            </td>
                            <td className="table-td text-right tabular-nums">{qty(r.shituraNjesi)}</td>
                            <td className="table-td text-right tabular-nums">
                              {formatCurrency(r.shituraTeArdhura)}
                            </td>
                            <td className="table-td text-right tabular-nums">{qty(r.vetjakNjesi)}</td>
                            <td className="table-td text-right tabular-nums">
                              {r.tracked ? qty(r.stokFundNjesi) : <span className="text-slate-400">—</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-3">
                Shitjet marrin fillimisht njësitë me faturë. Produktet me kg shfaqen vetëm te blerjet.
                Vlera e stokut në fund llogaritet me çmimet e sotme të blerjes.
              </p>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  hint,
  className,
}: {
  label: string
  value: string
  hint?: string
  className?: string
}) {
  return (
    <div className={cn('card p-3 sm:p-4', className)}>
      <p className="text-xs font-medium text-slate-500 mb-1">{label}</p>
      <p className="text-base sm:text-xl font-bold text-slate-900 tabular-nums">{value}</p>
      {hint && <p className="text-xs text-slate-400 mt-0.5 tabular-nums">{hint}</p>}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div className="p-12 text-center">
      <RiArchiveLine className="text-4xl text-slate-200 mx-auto mb-3" />
      <p className="text-slate-400">{text}</p>
    </div>
  )
}
