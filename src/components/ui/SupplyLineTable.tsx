'use client'

import { useCallback, useRef } from 'react'
import { RiDeleteBin6Line } from 'react-icons/ri'
import { formatCurrency } from '@/lib/utils'
import { isWeightedUnit } from '@/lib/validation'

export interface SupplyLine {
  productId: number
  emriProduktit: string
  njesia: string
  /** Stock on hand right now, shown so the operator can judge the quantity. */
  sasiaAktuale: number
  /** Reorder point, shown only where there is one (reorder suggestions). */
  stokuMinimal?: number
  /** Suggested quantity, shown as a hint next to the input. */
  sasiaSugjeruar?: number
  sasia: number
  cmimiBlerjes: number
  updatePrice?: boolean
}

interface SupplyLineTableProps {
  lines: SupplyLine[]
  onChangeQty: (productId: number, sasia: number) => void
  onChangePrice: (productId: number, cmimiBlerjes: number) => void
  onToggleUpdatePrice?: (productId: number) => void
  onRemove?: (productId: number) => void
  /** Shows the "current stock" and "suggested" columns. */
  showSuggestion?: boolean
  emptyMessage?: string
}

function qtyStep(njesia: string) {
  return isWeightedUnit(njesia) ? '0.001' : '1'
}

/**
 * Compact quantity-entry grid shared by "Shto Furnizim" and
 * "Porositje të Sugjeruara".
 *
 * Built for fast keyboard entry: Enter moves to the next quantity field rather
 * than submitting the form, so a whole delivery can be typed without touching
 * the mouse. Rows left at 0 are ignored by the caller on save.
 */
export default function SupplyLineTable({
  lines,
  onChangeQty,
  onChangePrice,
  onToggleUpdatePrice,
  onRemove,
  showSuggestion = false,
  emptyMessage = 'Asnjë produkt',
}: SupplyLineTableProps) {
  const qtyRefs = useRef<Map<number, HTMLInputElement>>(new Map())

  const registerQty = useCallback((productId: number, el: HTMLInputElement | null) => {
    if (el) qtyRefs.current.set(productId, el)
    else qtyRefs.current.delete(productId)
  }, [])

  // Enter behaves like Tab within the quantity column: next row, select its
  // contents so typing replaces rather than appends.
  const focusRow = useCallback(
    (index: number) => {
      const target = lines[index]
      if (!target) return
      const el = qtyRefs.current.get(target.productId)
      if (el) {
        el.focus()
        el.select()
      }
    },
    [lines]
  )

  function handleQtyKeyDown(e: React.KeyboardEvent<HTMLInputElement>, index: number) {
    if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault()
      focusRow(index + 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      focusRow(index - 1)
    }
  }

  if (lines.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-slate-400">{emptyMessage}</div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
          <tr>
            <th className="table-th">Produkti</th>
            <th className="table-th text-center whitespace-nowrap">Stoku</th>
            {showSuggestion && (
              <th className="table-th text-center whitespace-nowrap">Sugjeruar</th>
            )}
            <th className="table-th text-center w-28">Sasia</th>
            <th className="table-th text-right w-32">Çm. Blerjes</th>
            {onToggleUpdatePrice && <th className="table-th text-center w-20">Përditëso</th>}
            <th className="table-th text-right w-28">Totali</th>
            {onRemove && <th className="table-th w-10" />}
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => {
            const total = line.sasia * line.cmimiBlerjes
            const low = line.stokuMinimal != null && line.sasiaAktuale <= line.stokuMinimal
            return (
              <tr
                key={line.productId}
                className={`border-b border-slate-100 ${line.sasia > 0 ? 'bg-blue-50/40' : ''}`}
              >
                <td className="table-td">
                  <span className="font-medium text-slate-800">{line.emriProduktit}</span>
                  <span className="text-slate-400 text-xs ml-1.5">{line.njesia}</span>
                </td>

                <td className="table-td text-center">
                  <span className={low ? 'badge-red' : 'badge-gray'}>{line.sasiaAktuale}</span>
                </td>

                {showSuggestion && (
                  <td className="table-td text-center text-slate-500 tabular-nums">
                    {line.sasiaSugjeruar ?? '—'}
                  </td>
                )}

                <td className="table-td">
                  <input
                    ref={(el) => registerQty(line.productId, el)}
                    id={`qty-${line.productId}`}
                    type="number"
                    min="0"
                    step={qtyStep(line.njesia)}
                    value={line.sasia === 0 ? '' : line.sasia}
                    placeholder="0"
                    onChange={(e) => onChangeQty(line.productId, Number(e.target.value) || 0)}
                    onKeyDown={(e) => handleQtyKeyDown(e, index)}
                    onFocus={(e) => e.target.select()}
                    className="input py-1.5 text-sm text-center w-full tabular-nums"
                  />
                </td>

                <td className="table-td">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={line.cmimiBlerjes}
                    onChange={(e) => onChangePrice(line.productId, Math.max(0, Number(e.target.value) || 0))}
                    onFocus={(e) => e.target.select()}
                    className="input py-1.5 text-sm text-right w-full tabular-nums"
                  />
                </td>

                {onToggleUpdatePrice && (
                  <td className="table-td text-center">
                    <input
                      type="checkbox"
                      checked={line.updatePrice ?? false}
                      onChange={() => onToggleUpdatePrice(line.productId)}
                      title="Përditëso çmimin e blerjes te produkti"
                      className="w-4 h-4 accent-blue-600 cursor-pointer"
                    />
                  </td>
                )}

                <td className="table-td text-right font-medium text-slate-800 tabular-nums">
                  {total > 0 ? formatCurrency(total) : <span className="text-slate-300">—</span>}
                </td>

                {onRemove && (
                  <td className="table-td text-center">
                    <button
                      type="button"
                      onClick={() => onRemove(line.productId)}
                      title="Hiq nga lista"
                      className="p-1 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                    >
                      <RiDeleteBin6Line />
                    </button>
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
