'use client'

import { useState } from 'react'
import Modal from '@/components/ui/Modal'
import { TILE_GROUPS, isTileGroupKey, tileGroupLabel, type TileGroupKey } from '@/lib/tile-groups'
import type { CatalogProduct } from '@/lib/catalog-shape'
import { autoTileGroup, tileEmoji } from './tile-look'

interface TileGroupSelectProps {
  product: CatalogProduct
  /** null = Automatik. */
  value: TileGroupKey | null
  onChange: (value: TileGroupKey | null) => void
}

/**
 * Picks a tile's group: "Automatik" (showing which group the name and
 * category would give) or one of the fixed groups.
 */
export function TileGroupSelect({ product, value, onChange }: TileGroupSelectProps) {
  const auto = autoTileGroup(product.emri, product.kategoria)
  const options: Array<{ key: TileGroupKey | null; label: string }> = [
    { key: null, label: `Automatik (${tileGroupLabel(auto)})` },
    ...TILE_GROUPS.map((g) => ({ key: g.key, label: g.label })),
  ]
  return (
    <div role="radiogroup" aria-label="Grupi i pllakës" className="grid grid-cols-2 gap-2">
      {options.map((o) => {
        const selected = o.key === value
        return (
          <button
            key={o.key ?? 'auto'}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(o.key)}
            className={`text-left text-sm px-3 py-2 rounded-lg border-2 transition-colors ${
              o.key === null ? 'col-span-2' : ''
            } ${
              selected
                ? 'border-blue-500 bg-blue-50 text-blue-800 font-medium'
                : 'border-slate-200 bg-white text-slate-700 hover:border-blue-300'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** The product a selector is for, shown above it. */
export function TileGroupProductLine({ product }: { product: CatalogProduct }) {
  return (
    <div className="px-1">
      <p className="text-sm font-medium text-slate-900">
        <span className="mr-1" aria-hidden>{tileEmoji(product.emri, product.kategoria)}</span>
        {product.emri}
      </p>
      <p className="text-xs text-slate-400">{product.kategoria}</p>
    </div>
  )
}

interface TileGroupDialogProps {
  /** The tile being moved; null = closed. */
  product: CatalogProduct | null
  onClose: () => void
  /** Saves the group (null = Automatik); resolves once the server has it. */
  onSave: (product: CatalogProduct, grupiArke: TileGroupKey | null) => Promise<void>
}

/** ⋯ on a tile: move it to another group, or back to Automatik. */
export function TileGroupDialog({ product, onClose, onSave }: TileGroupDialogProps) {
  return (
    <Modal isOpen={!!product} onClose={onClose} title="Grupi i pllakës" size="sm">
      {/* Keyed so the choice starts from the tile's current group each time. */}
      {product && <TileGroupForm key={product.id} product={product} onClose={onClose} onSave={onSave} />}
    </Modal>
  )
}

function TileGroupForm({
  product,
  onClose,
  onSave,
}: {
  product: CatalogProduct
  onClose: () => void
  onSave: TileGroupDialogProps['onSave']
}) {
  const current = isTileGroupKey(product.grupiArke) ? product.grupiArke : null
  const [value, setValue] = useState<TileGroupKey | null>(current)
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      await onSave(product, value)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <TileGroupProductLine product={product} />
      <TileGroupSelect product={product} value={value} onChange={setValue} />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="btn-secondary text-sm">
          Anulo
        </button>
        <button type="button" onClick={save} disabled={busy || value === current} className="btn-primary text-sm">
          {busy ? 'Duke ruajtur...' : 'Ruaj'}
        </button>
      </div>
    </div>
  )
}
