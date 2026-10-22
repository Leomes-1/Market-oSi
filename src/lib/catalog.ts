'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CatalogProduct } from './catalog-shape'

export type { CatalogProduct }

/**
 * One shared copy of the product catalogue for the whole app.
 *
 * ~600 products is small enough to hold on the client, so searching and
 * resolving a barcode cost nothing — no request, no debounce, no race. The
 * store lives at module scope, so moving between the POS, products, supplies
 * and personal-use screens reuses the same data instead of refetching it.
 *
 * Stale-while-revalidate: a refresh never empties or blanks the cache. The old
 * copy keeps answering every lookup until the new one has fully arrived, and
 * a failed refresh just leaves the old copy in place.
 *
 * Call `refresh()` after anything that changes products or stock.
 */

type Listener = () => void

/** Stable identity so an empty catalogue doesn't invalidate memos each render. */
const EMPTY: CatalogProduct[] = []

let cache: CatalogProduct[] | null = null
let inflight: Promise<CatalogProduct[]> | null = null
let lastError = false
const listeners = new Set<Listener>()

/**
 * Rows fetched one at a time by `lookupBarcode` before the full catalogue has
 * arrived. Folded into the catalogue when it lands, so a product found during
 * the first load isn't forgotten if that load was read before it existed.
 */
const early = new Map<number, CatalogProduct>()

function emit() {
  listeners.forEach((l) => l())
}

async function load(force: boolean): Promise<CatalogProduct[]> {
  if (!force && cache) return cache
  // Collapse concurrent callers (several components mounting at once) onto a
  // single request.
  if (!force && inflight) return inflight

  inflight = (async () => {
    try {
      const res = await fetch('/api/products/catalog')
      if (res.status === 401) {
        window.location.href = '/login'
        return cache ?? []
      }
      if (!res.ok) throw new Error('catalog request failed')
      const data = (await res.json()) as CatalogProduct[]
      const next = Array.isArray(data) ? data : []
      if (early.size) {
        const ids = new Set(next.map((p) => p.id))
        early.forEach((p) => {
          if (!ids.has(p.id)) next.push(p)
        })
        early.clear()
      }
      // Swapped in only now, complete — never replaced by a partial or empty copy.
      cache = next
      lastError = false
      return cache
    } catch {
      lastError = true
      // Keep serving the previous copy rather than blanking the screen.
      return cache ?? []
    } finally {
      inflight = null
      emit()
    }
  })()

  return inflight
}

/** Refetches in the background; the current copy stays in use meanwhile. */
export async function refreshCatalog(): Promise<CatalogProduct[]> {
  return load(true)
}

/** Lets non-React code (or a page that already has fresh rows) seed the cache. */
export function primeCatalog(products: CatalogProduct[]) {
  cache = products
  emit()
}

/** Inserts or replaces rows by id, keeping everything else as it is. */
function upsert(rows: CatalogProduct[]) {
  if (rows.length === 0) return
  if (!cache) {
    rows.forEach((p) => early.set(p.id, p))
    emit()
    return
  }
  const byId = new Map(rows.map((p) => [p.id, p]))
  const next = cache.map((p) => {
    const row = byId.get(p.id)
    if (!row) return p
    byId.delete(p.id)
    return row
  })
  // Rows that are new to this copy: slot them in by name, like the server's order.
  byId.forEach((p) => {
    const at = next.findIndex((q) => q.emri.localeCompare(p.emri) > 0)
    if (at === -1) next.push(p)
    else next.splice(at, 0, p)
  })
  cache = next
  emit()
}

const lookups = new Map<string, Promise<CatalogProduct | null>>()

/**
 * Asks the server for one barcode the cached copy doesn't know — a product
 * added elsewhere since this page loaded. A hit is added to the cache, so the
 * next scan of it is answered locally. Resolves null when no product has the
 * barcode; rejects when the request itself failed.
 *
 * Concurrent scans of the same code share one request.
 */
export function lookupBarcode(code: string): Promise<CatalogProduct | null> {
  const key = code.trim()
  const pending = lookups.get(key)
  if (pending) return pending

  const request = (async () => {
    try {
      const res = await fetch(`/api/products/barcode?code=${encodeURIComponent(key)}`)
      if (res.status === 401) {
        window.location.href = '/login'
        return null
      }
      if (res.status === 404) return null
      if (!res.ok) throw new Error('barcode lookup failed')
      const product = (await res.json()) as CatalogProduct
      upsert([product])
      return product
    } finally {
      lookups.delete(key)
    }
  })()
  lookups.set(key, request)
  return request
}

export interface UseCatalog {
  products: CatalogProduct[]
  loading: boolean
  error: boolean
  /** Exact barcode match. O(1), no network. */
  findByBarcode: (code: string) => CatalogProduct | undefined
  /** Substring match on name, category or barcode. */
  search: (query: string) => CatalogProduct[]
  refresh: () => Promise<CatalogProduct[]>
}

export function useCatalog(): UseCatalog {
  const [, forceRender] = useState(0)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    const listener = () => {
      if (mounted.current) forceRender((n) => n + 1)
    }
    listeners.add(listener)
    void load(false)
    return () => {
      mounted.current = false
      listeners.delete(listener)
    }
  }, [])

  const products = cache ?? EMPTY
  // Size is part of the key: rows looked up before the catalogue arrived
  // still have to resolve locally.
  const earlyCount = early.size

  const barcodeIndex = useMemo(() => {
    const map = new Map<string, CatalogProduct>()
    const index = (p: CatalogProduct) => {
      for (const code of p.barcodes) {
        const trimmed = code.trim()
        if (trimmed) map.set(trimmed, p)
      }
    }
    products.forEach(index)
    early.forEach(index)
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, earlyCount])

  const findByBarcode = useCallback(
    (code: string) => barcodeIndex.get(code.trim()),
    [barcodeIndex]
  )

  const search = useCallback(
    (query: string) => {
      const q = query.trim().toLowerCase()
      if (!q) return products
      return products.filter(
        (p) =>
          p.emri.toLowerCase().includes(q) ||
          p.kategoria.toLowerCase().includes(q) ||
          p.barcodes.some((b) => b.includes(q))
      )
    },
    [products]
  )

  return {
    products,
    loading: cache === null && !lastError,
    error: lastError && cache === null,
    findByBarcode,
    search,
    refresh: refreshCatalog,
  }
}
