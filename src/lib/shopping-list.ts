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
  /** The product's supplier now (null: none, or a free-text line). */
  furnitorId: number | null
  furnitorEmri: string | null
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

/**
 * "Ndaj sipas furnitorit": one group per supplier (alphabetical), then
 * "Pa furnitor" (catalogue products with no supplier), then "Të tjera"
 * (free-text lines). Lines keep their list order inside a group. Empty
 * groups are left out.
 */
export type ListGroupKind = 'supplier' | 'none' | 'free'

export interface ListGroup {
  key: string
  kind: ListGroupKind
  /** The supply's furnitorId: the supplier's id, null for "Pa furnitor" (and "Të tjera"). */
  furnitorId: number | null
  title: string
  lines: ShoppingListLine[]
}

export const NO_SUPPLIER_TITLE = 'Pa furnitor'
export const FREE_TEXT_TITLE = 'Të tjera'

export function groupBySupplier(lines: ShoppingListLine[]): ListGroup[] {
  const suppliers = new Map<number, ListGroup>()
  const none: ListGroup = { key: 'none', kind: 'none', furnitorId: null, title: NO_SUPPLIER_TITLE, lines: [] }
  const free: ListGroup = { key: 'free', kind: 'free', furnitorId: null, title: FREE_TEXT_TITLE, lines: [] }
  for (const l of lines) {
    if (l.productId === null) free.lines.push(l)
    else if (l.furnitorId === null) none.lines.push(l)
    else {
      let g = suppliers.get(l.furnitorId)
      if (!g) {
        g = {
          key: `s${l.furnitorId}`,
          kind: 'supplier',
          furnitorId: l.furnitorId,
          title: l.furnitorEmri ?? `Furnitori ${l.furnitorId}`,
          lines: [],
        }
        suppliers.set(l.furnitorId, g)
      }
      g.lines.push(l)
    }
  }
  const sorted = Array.from(suppliers.values()).sort((a, b) => a.title.localeCompare(b.title, 'sq'))
  return [...sorted, none, free].filter((g) => g.lines.length > 0)
}

/** A supply to create from one group: its ✓ catalogue lines with a quantity. */
export interface PlannedSupply {
  key: string
  furnitorId: number | null
  title: string
  lines: ShoppingListLine[]
  total: number
}

/**
 * What "Krijo furnizimin" / "Krijo të gjitha furnizimet" would create from
 * these groups. Free-text ✓ lines can't go into a supply and are named in
 * `skippedFree`; ✓ catalogue lines at quantity 0 are counted in `skippedZero`.
 */
export function planSupplies(groups: ListGroup[]) {
  const supplies: PlannedSupply[] = []
  const skippedFree: string[] = []
  let skippedZero = 0
  for (const g of groups) {
    const ticked = g.lines.filter((l) => l.blere)
    if (g.kind === 'free') {
      skippedFree.push(...ticked.map((l) => l.emri))
      continue
    }
    skippedZero += ticked.filter((l) => l.sasia <= 0).length
    const usable = ticked.filter((l) => l.sasia > 0)
    if (usable.length === 0) continue
    supplies.push({
      key: g.key,
      furnitorId: g.furnitorId,
      title: g.title,
      lines: usable,
      total: usable.reduce((s, l) => s + l.sasia * l.cmimiBlerjes, 0),
    })
  }
  return { supplies, skippedFree, skippedZero }
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
