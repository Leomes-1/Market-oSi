'use client'

import { useMemo, useState } from 'react'
import Modal from '@/components/ui/Modal'
import SearchInput from '@/components/ui/SearchInput'
import { formatCurrency } from '@/lib/utils'
import { findProducts, searchIndex } from '@/lib/product-search'
import type { TileGroupKey } from '@/lib/tile-groups'
import type { CatalogProduct } from '@/lib/catalog-shape'
import { TileGroupProductLine, TileGroupSelect } from './TileGroupSelect'

interface AddTilePickerProps {
  isOpen: boolean
  onClose: () => void
  products: CatalogProduct[]
  /**
   * Puts the product on the tiles in the given group (null = Automatik);
   * resolves once the server has saved it.
   */
  onAdd: (product: CatalogProduct, grupiArke: TileGroupKey | null) => Promise<void>
}

/** Products that can still be added: everything not on the tiles yet. */
const addable = (p: CatalogProduct) => !p.neArke

/**
 * "+ Shto produkt": search the catalogue, pick a product, choose its group
 * (Automatik by default), add it to the POS tiles. Goes back to the search
 * after an add, so several products (all the bread) go in one go. A kg
 * product taken off with × can be put back here too.
 */
export default function AddTilePicker({ isOpen, onClose, products, onAdd }: AddTilePickerProps) {
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<CatalogProduct | null>(null)
  const [group, setGroup] = useState<TileGroupKey | null>(null)
  const [busy, setBusy] = useState(false)
  const index = useMemo(() => searchIndex(products), [products])
  const results = useMemo(() => findProducts(index, query, 20, addable), [index, query])

  function close() {
    setQuery('')
    setPicked(null)
    onClose()
  }

  function pick(product: CatalogProduct) {
    setPicked(product)
    setGroup(null)
  }

  async function add() {
    if (!picked || busy) return
    setBusy(true)
    try {
      await onAdd(picked, group)
      setPicked(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={close} title="Shto produkt te pllakat" size="sm">
      {picked ? (
        <div className="space-y-4">
          <TileGroupProductLine product={picked} />
          <TileGroupSelect product={picked} value={group} onChange={setGroup} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setPicked(null)} className="btn-secondary text-sm">
              Kthehu
            </button>
            <button type="button" onClick={add} disabled={busy} className="btn-primary text-sm">
              {busy ? 'Duke ruajtur...' : 'Shto te pllakat'}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {isOpen && (
            <SearchInput
              value={query}
              onChange={setQuery}
              onSubmit={() => results[0] && pick(results[0])}
              autoFocus="always"
              placeholder="Kërko sipas emrit ose barkodit..."
              inputClassName="text-sm"
            />
          )}
          {query.trim() === '' ? (
            <p className="text-xs text-slate-400 px-1">
              Shkruaj emrin ose barkodin e produktit që do të shfaqet si pllakë.
            </p>
          ) : results.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">Nuk u gjet asnjë produkt për t&apos;u shtuar</p>
          ) : (
            <ul className="divide-y divide-slate-100 -mx-2">
              {results.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => pick(p)}
                    className="w-full flex items-center gap-3 px-2 py-2 text-left rounded-lg hover:bg-blue-50"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-900 truncate">{p.emri}</p>
                      <p className="text-xs text-slate-400 truncate">
                        {p.kategoria}
                        {p.barcodes[0] && <span className="font-mono"> · {p.barcodes[0]}</span>}
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-slate-900 whitespace-nowrap">
                      {formatCurrency(p.cmimiShitjes)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  )
}
