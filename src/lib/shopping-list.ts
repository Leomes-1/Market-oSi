import { isWeightedUnit } from './validation'

/**
 * Lista e blerjeve — the shared shopping list (table "ShoppingListItem").
 * Shared by the API routes and the page.
 */

/** A list line as the page receives it. */
export interface ShoppingListLine {
  id: number
  /** null for a free-text line. */
  productId: number | null
  /** The product's current name for a catalogue line; the typed name otherwise. */
  emri: string
  njesia: string
  sasia: number
  cmimiBlerjes: number
  blere: boolean
  /** Stock on hand, for catalogue lines whose stock is counted; else null. */
  stoku: number | null
}

/** Upper bound for a quantity or price, to catch a scanner typing into the wrong field. */
export const LIST_MAX_VALUE = 10_000_000

/** Longest free-text name accepted. */
export const LIST_MAX_NAME = 120

type Checked<T> = { ok: true; value: T } | { ok: false; error: string }

function toNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw.replace(',', '.'))
    return Number.isFinite(n) ? n : null
  }
  return null
}

/**
 * A list quantity: 0 or more (0 = typed nothing yet), whole for counted
 * units and at most 3 decimals for weighed ones — the same rule a supply
 * enforces, so a list line always goes into "Shto Furnizim" as it is.
 * Free-text lines have no unit rule beyond the 3 decimals.
 */
export function checkListQuantity(raw: unknown, njesia: string, freeText: boolean): Checked<number> {
  const n = toNumber(raw)
  if (n === null || n < 0) return { ok: false, error: 'Sasia e pavlefshme' }
  if (n > LIST_MAX_VALUE) return { ok: false, error: 'Sasia është shumë e madhe' }
  const rounded = Number(n.toFixed(3))
  if (!freeText && !isWeightedUnit(njesia) && !Number.isInteger(n)) {
    return { ok: false, error: 'Sasia duhet të jetë numër i plotë për këtë produkt' }
  }
  return { ok: true, value: rounded }
}

export function checkListPrice(raw: unknown): Checked<number> {
  const n = toNumber(raw)
  if (n === null || n < 0) return { ok: false, error: 'Çmimi i pavlefshëm' }
  if (n > LIST_MAX_VALUE) return { ok: false, error: 'Çmimi është shumë i madh' }
  return { ok: true, value: Number(n.toFixed(2)) }
}

export function checkListName(raw: unknown): Checked<string> {
  const name = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : ''
  if (!name) return { ok: false, error: 'Shkruaj emrin' }
  if (name.length > LIST_MAX_NAME) return { ok: false, error: `Emri lejon deri në ${LIST_MAX_NAME} shkronja` }
  return { ok: true, value: name }
}

/** Line totals for the header: everything, ticked, and what is left. */
export function listTotals(lines: Pick<ShoppingListLine, 'sasia' | 'cmimiBlerjes' | 'blere'>[]) {
  let total = 0
  let blere = 0
  for (const l of lines) {
    const t = l.sasia * l.cmimiBlerjes
    total += t
    if (l.blere) blere += t
  }
  return { total, blere, mbetur: total - blere }
}
