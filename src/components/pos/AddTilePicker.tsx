'use client'

import { useMemo, useState } from 'react'
import Modal from '@/components/ui/Modal'
import SearchInput from '@/components/ui/SearchInput'
import { formatCurrency } from '@/lib/utils'
import { findProducts, searchIndex } from '@/lib/product-search'
import type { CatalogProduct } from '@/lib/catalog-shape'

interface AddTilePickerProps {
  isOpen: boolean
  onClose: () => void
  products: CatalogProduct[]
  /** Puts the product on the tiles; resolves once the server has saved it. */
  onAdd: (product: CatalogProduct) => Promise<void>
}

/** Products that can still be added: not kg (tiles anyway), not added yet. */
const addable = (p: CatalogProduct) => p.njesia !== 'kg' && !p.neArke

/**
 * "+ Shto produkt": search the catalogue and add a product to the POS tiles.
 * Stays open after an add, so several products (all the bread) go in one go.
 */
export default function AddTilePicker({ isOpen, onClose, products, onAdd }: AddTilePickerProps) {
  const [query, setQuery] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)
  const index = useMemo(() => searchIndex(products), [products])
  const results = useMemo(() => findProducts(index, query, 20, addable), [index, query])

  function close() {
    setQuery('')
    onClose()
  }

  async function add(product: CatalogProduct) {
    if (busyId !== null) return
    setBusyId(product.id)
    try {
      await onAdd(product)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={close} title="Shto produkt te pllakat" size="sm">
      <div className="space-y-3">
        {isOpen && (
          <SearchInput
            value={query}
            onChange={setQuery}
            onSubmit={() => results[0] && add(results[0])}
            autoFocus="always"
            placeholder="Kërko sipas emrit ose barkodit..."
            inputClassName="text-sm"
          />
        )}
        {query.trim() === '' ? (
          <p className="text-xs text-slate-400 px-1">
            Shkruaj emrin e produktit. Produktet me kg shfaqen gjithmonë, nuk kanë nevojë të shtohen.
          </p>
        ) : results.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-6">Nuk u gjet asnjë produkt për t&apos;u shtuar</p>
        ) : (
          <ul className="divide-y divide-slate-100 -mx-2">
            {results.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => add(p)}
                  disabled={busyId !== null}
                  className="w-full flex items-center gap-3 px-2 py-2 text-left rounded-lg hover:bg-blue-50 disabled:opacity-50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900 truncate">{p.emri}</p>
                    <p className="text-xs text-slate-400 truncate">
                      {p.kategoria}
                      {p.barcodes[0] && <span className="font-mono"> · {p.barcodes[0]}</span>}
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-slate-900 whitespace-nowrap">
                    {busyId === p.id ? '...' : formatCurrency(p.cmimiShitjes)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}
