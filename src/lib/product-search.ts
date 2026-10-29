import type { CatalogProduct } from './catalog-shape'

/**
 * Product search for the POS field and the "+ Shto produkt" picker, run
 * against the cached catalogue in the browser — no request per keystroke.
 */

/** Lower-case, without ë/ç and other accents, so "Qepë" and "qepe" match alike. */
export function plain(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export interface SearchEntry {
  product: CatalogProduct
  name: string
  /** Name and category together, for multi-word queries across both. */
  text: string
}

/** Accent-free names, computed once per catalogue rather than per keystroke. */
export function searchIndex(products: CatalogProduct[]): SearchEntry[] {
  return products.map((product) => {
    const name = plain(product.emri)
    return { product, name, text: `${name} ${plain(product.kategoria)}` }
  })
}

/**
 * Products whose name or category contains every typed word (accents
 * ignored), or whose barcode contains the typed digits. Names that start with
 * the query come first.
 */
export function findProducts(
  index: SearchEntry[],
  query: string,
  limit = Infinity,
  accept: (p: CatalogProduct) => boolean = () => true
): CatalogProduct[] {
  const q = plain(query).trim()
  if (!q) return []
  const words = q.split(/\s+/)
  const digits = /^\d+$/.test(q)

  const first: CatalogProduct[] = []
  const rest: CatalogProduct[] = []
  for (const { product, name, text } of index) {
    if (!accept(product)) continue
    const byText = words.every((w) => text.includes(w))
    if (!byText && !(digits && product.barcodes.some((b) => b.includes(q)))) continue
    if (name.startsWith(q)) {
      first.push(product)
      if (first.length === limit) break
    } else if (rest.length < limit) {
      rest.push(product)
    }
  }
  return [...first, ...rest].slice(0, limit)
}
