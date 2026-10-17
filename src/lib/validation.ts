/**
 * Server-side validation for anything that moves stock or money.
 *
 * Quantity rules follow how the shop actually sells:
 *   - weighted units (kg, gram, litër) may be fractional, up to 3 decimals,
 *     which is what the POS sends (it steps by 0.250 and rounds with toFixed(3));
 *   - every other unit (copë, kuti, paketë, …) must be a whole number.
 * Both must be finite and strictly greater than zero.
 */

export const WEIGHTED_UNITS = ['kg', 'gram', 'litër', 'liter'] as const

export function isWeightedUnit(njesia: string | null | undefined): boolean {
  if (!njesia) return false
  return (WEIGHTED_UNITS as readonly string[]).includes(njesia)
}

/** Max decimal places accepted for a weighted quantity. */
const WEIGHTED_DECIMALS = 3

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string }

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Coerces unknown input to a finite number, rejecting NaN, Infinity and '' . */
export function toFiniteNumber(value: unknown): number | null {
  if (isFiniteNumber(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

export function validateQuantity(
  raw: unknown,
  njesia: string | null | undefined,
  label: string
): Validated<number> {
  const sasia = toFiniteNumber(raw)

  if (sasia === null) {
    return { ok: false, error: `Sasia e pavlefshme për: ${label}` }
  }
  if (sasia <= 0) {
    return { ok: false, error: `Sasia duhet të jetë pozitive për: ${label}` }
  }

  if (isWeightedUnit(njesia)) {
    const rounded = Number(sasia.toFixed(WEIGHTED_DECIMALS))
    if (Math.abs(rounded - sasia) > Number.EPSILON) {
      return {
        ok: false,
        error: `Sasia për ${label} lejon maksimumi ${WEIGHTED_DECIMALS} shifra pas presjes`,
      }
    }
    return { ok: true, value: rounded }
  }

  if (!Number.isInteger(sasia)) {
    return {
      ok: false,
      error: `Sasia për ${label} duhet të jetë numër i plotë (njësia: ${njesia || 'copë'})`,
    }
  }

  return { ok: true, value: sasia }
}

export function validatePrice(raw: unknown, label: string): Validated<number> {
  const price = toFiniteNumber(raw)

  if (price === null) {
    return { ok: false, error: `Çmimi i pavlefshëm për: ${label}` }
  }
  if (price < 0) {
    return { ok: false, error: `Çmimi nuk mund të jetë negativ për: ${label}` }
  }
  return { ok: true, value: price }
}

/**
 * Collapses repeated productIds into one line, summing their quantities, so a
 * cart holding the same product twice is checked against stock once rather
 * than each line passing independently.
 */
export function mergeByProductId<T extends { productId: number; sasia: number }>(
  items: T[]
): T[] {
  const merged = new Map<number, T>()
  for (const item of items) {
    const existing = merged.get(item.productId)
    if (existing) {
      existing.sasia = Number((existing.sasia + item.sasia).toFixed(3))
    } else {
      merged.set(item.productId, { ...item })
    }
  }
  return Array.from(merged.values())
}
