import type { CatalogProduct } from './catalog-shape'

/**
 * Name search for the POS field and the "+ Shto produkt" picker, run against
 * the cached catalogue in the browser — no request per keystroke.
 */

/** Lower-case, without ë/ç and other accents, so "Qepë" and "qepe" match alike. */
export function plain(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export interface SearchEntry {
  product: CatalogProduct
  name: string
}

/** Accent-free names, computed once per catalogue rather than per keystroke. */
export function searchIndex(products: CatalogProduct[]): SearchEntry[] {
  return products.map((product) => ({ product, name: plain(product.emri) }))
}

/**
 * Products whose name contains every typed word (accents ignored), names that
 * start with the query first. A query of digits also matches barcodes by
 * prefix, so a partly typed code still finds its product.
 */
export function findProducts(
  index: SearchEntry[],
  query: string,
  limit: number,
  accept: (p: CatalogProduct) => boolean = () => true
): CatalogProduct[] {
  const q = plain(query).trim()
  if (!q) return []
  const words = q.split(/\s+/)
  const digits = /^\d+$/.test(q)

  const first: CatalogProduct[] = []
  const rest: CatalogProduct[] = []
  for (const { product, name } of index) {
    if (!accept(product)) continue
    const byName = words.every((w) => name.includes(w))
    if (!byName && !(digits && product.barcodes.some((b) => b.startsWith(q)))) continue
    if (name.startsWith(q)) {
      first.push(product)
      if (first.length === limit) break
    } else if (rest.length < limit) {
      rest.push(product)
    }
  }
  return [...first, ...rest].slice(0, limit)
}
