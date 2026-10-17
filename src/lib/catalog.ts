'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export interface CatalogProduct {
  id: number
  emri: string
  kategoria: string
  sasia: number
  stokuMinimal: number
  njesia: string
  cmimiShitjes: number
  /** Absent for cashiers — the API withholds cost price from them. */
  cmimiBlerjes?: number
  furnitorId: number | null
  furnitorEmri: string | null
  barcodes: string[]
  /** Pending price change waiting for the old stock to run out, if any. */
  cmimiShitjesRi: number | null
  cmimiBlerjesRi?: number | null
  sasiaVjeter: number | null
}

/**
 * One shared copy of the product catalogue for the whole app.
 *
 * ~390 products is small enough to hold on the client, so searching and
 * resolving a barcode cost nothing — no request, no debounce, no race. The
 * store lives at module scope, so moving between the POS, products, supplies
 * and personal-use screens reuses the same data instead of refetching it.
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
      cache = Array.isArray(data) ? data : []
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

/** Drops the cached copy and refetches. Call after any product/stock change. */
export async function refreshCatalog(): Promise<CatalogProduct[]> {
  return load(true)
}

/** Lets non-React code (or a page that already has fresh rows) seed the cache. */
export function primeCatalog(products: CatalogProduct[]) {
  cache = products
  emit()
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

  const barcodeIndex = useMemo(() => {
    const map = new Map<string, CatalogProduct>()
    for (const p of products) {
      for (const code of p.barcodes) {
        const trimmed = code.trim()
        if (trimmed) map.set(trimmed, p)
      }
    }
    return map
  }, [products])

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
