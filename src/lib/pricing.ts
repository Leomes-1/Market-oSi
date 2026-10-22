import type { Prisma, Product } from '@prisma/client'

/**
 * Deferred price changes.
 *
 * When a delivery arrives with new prices while units bought at the old price
 * are still on the shelf, overwriting the product's prices immediately would
 * silently re-cost that existing stock and restate the margin already earned
 * on it. Instead the new prices wait in `cmimiBlerjesRi` / `cmimiShitjesRi`,
 * and `sasiaVjeter` records how many units still belong to the old prices.
 *
 * Every sale and personal-use entry draws `sasiaVjeter` down. When it reaches
 * zero the pending prices are promoted and the three columns are cleared, so
 * the switch happens on its own with nobody having to remember.
 */

/** Anything with the price/stock columns — a full Product or a narrow select. */
export interface PricedProduct {
  id: number
  sasia: number
  cmimiBlerjes: number
  cmimiShitjes: number
  cmimiBlerjesRi: number | null
  cmimiShitjesRi: number | null
  sasiaVjeter: number | null
}

export interface PendingPrice {
  cmimiBlerjesRi: number
  cmimiShitjesRi: number
  /** Units still priced at the old rates. */
  sasiaVjeter: number
}

/** The pending change, or null when there isn't one. */
export function pendingPrice(p: PricedProduct): PendingPrice | null {
  if (p.sasiaVjeter == null || p.sasiaVjeter <= 0) return null
  if (p.cmimiBlerjesRi == null && p.cmimiShitjesRi == null) return null
  return {
    cmimiBlerjesRi: p.cmimiBlerjesRi ?? p.cmimiBlerjes,
    cmimiShitjesRi: p.cmimiShitjesRi ?? p.cmimiShitjes,
    sasiaVjeter: p.sasiaVjeter,
  }
}

export interface ConsumePricing {
  /** Unit sale price charged for the whole line. */
  cmimiShitjes: number
  /** Blended unit cost: exact split across the boundary, averaged over the line. */
  cmimiBlerjes: number
  /** Units drawn from the old-price stock. */
  njesiVjetra: number
  /** Units drawn at the pending prices. */
  njesiTeReja: number
  /** True when this consumption exhausts the old stock and promotes the prices. */
  promovon: boolean
}

/**
 * Prices one line that consumes `sasia` units of `product`.
 *
 * Boundary rule, chosen deliberately: a line that straddles the change is
 * charged entirely at the HIGHER of the old and new sale price, while the cost
 * is split exactly — old units at the old purchase price, new units at the new
 * one. The customer is never charged two prices for the same item in one
 * basket, and the shop never sells a more expensive unit at the old price.
 * The stored `cmimiBlerjes` is therefore a blended per-unit figure, which keeps
 * `sasia * cmimiBlerjes` equal to the true cost of the line.
 */
export function priceConsumption(product: PricedProduct, sasia: number): ConsumePricing {
  const pending = pendingPrice(product)

  if (!pending) {
    return {
      cmimiShitjes: product.cmimiShitjes,
      cmimiBlerjes: product.cmimiBlerjes,
      njesiVjetra: sasia,
      njesiTeReja: 0,
      promovon: false,
    }
  }

  const njesiVjetra = Math.min(sasia, pending.sasiaVjeter)
  const njesiTeReja = Math.max(0, sasia - njesiVjetra)

  const kostoTotale =
    njesiVjetra * product.cmimiBlerjes + njesiTeReja * pending.cmimiBlerjesRi

  return {
    // Only reach for the new sale price once the line actually crosses over.
    cmimiShitjes:
      njesiTeReja > 0
        ? Math.max(product.cmimiShitjes, pending.cmimiShitjesRi)
        : product.cmimiShitjes,
    cmimiBlerjes: sasia > 0 ? kostoTotale / sasia : product.cmimiBlerjes,
    njesiVjetra,
    njesiTeReja,
    promovon: sasia >= pending.sasiaVjeter,
  }
}

type Tx = Prisma.TransactionClient

/**
 * Records that `sasia` units left the shelf: draws down `sasiaVjeter` and
 * promotes the pending prices when it runs out.
 *
 * Both statements are self-referential SQL so they stay correct under
 * concurrent sales — neither depends on a value read earlier in the request.
 * Call this only after the caller's own atomic stock decrement has succeeded
 * (or `lockProduct` for an untracked product), so the row is already locked
 * by this transaction.
 */
export async function applyConsumption(tx: Tx, productId: number, sasia: number) {
  await tx.$executeRaw`
    UPDATE "Product"
       SET "sasiaVjeter" = GREATEST(0, "sasiaVjeter" - ${sasia})
     WHERE id = ${productId}
       AND "sasiaVjeter" IS NOT NULL
  `

  await tx.$executeRaw`
    UPDATE "Product"
       SET "cmimiBlerjes"   = COALESCE("cmimiBlerjesRi", "cmimiBlerjes"),
           "cmimiShitjes"   = COALESCE("cmimiShitjesRi", "cmimiShitjes"),
           "cmimiBlerjesRi" = NULL,
           "cmimiShitjesRi" = NULL,
           "sasiaVjeter"    = NULL
     WHERE id = ${productId}
       AND "sasiaVjeter" IS NOT NULL
       AND "sasiaVjeter" <= 0
  `
}

/**
 * Takes the product's row lock without changing it. Untracked (kg) lines have
 * no stock decrement to take it for them, but still need it before re-reading
 * prices and calling `applyConsumption`.
 */
export async function lockProduct(tx: Tx, productId: number) {
  await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${productId} FOR UPDATE`
}

/**
 * Takes `sasia` units of one product and returns its priced columns, read
 * under the row lock — the sale path's single statement per line.
 *
 * Tracked stock: the conditional decrement `sasia >= n` is the guard, the
 * write and the row lock in one atomic statement, exactly like the
 * updateMany it replaces (so stock still cannot go below zero, and the CHECK
 * constraint stays the backstop). RETURNING hands back the row as it stands
 * after the decrement, which is what the separate re-read used to fetch.
 * `updatedAt` is set the way Prisma's updateMany set it.
 *
 * Untracked (kg): nothing to decrement, so SELECT … FOR UPDATE takes the lock
 * and reads in one go.
 *
 * Returns null when there was not enough stock (no row matched the guard).
 */
export async function takeAndLock(
  tx: Tx,
  productId: number,
  sasia: number,
  tracked: boolean
): Promise<PricedProduct | null> {
  const rows = tracked
    ? await tx.$queryRaw<PricedProduct[]>`
        UPDATE "Product"
           SET sasia = sasia - ${sasia}::double precision,
               -- Stored as UTC wall time, like Prisma's own writes, whatever
               -- the session time zone is.
               "updatedAt" = (${new Date().toISOString()}::timestamptz AT TIME ZONE 'UTC')
         WHERE id = ${productId}
           AND sasia >= ${sasia}::double precision
     RETURNING id, sasia, "cmimiBlerjes", "cmimiShitjes",
               "cmimiBlerjesRi", "cmimiShitjesRi", "sasiaVjeter"
      `
    : await tx.$queryRaw<PricedProduct[]>`
        SELECT id, sasia, "cmimiBlerjes", "cmimiShitjes",
               "cmimiBlerjesRi", "cmimiShitjesRi", "sasiaVjeter"
          FROM "Product"
         WHERE id = ${productId}
           FOR UPDATE
      `
  return rows[0] ?? null
}

/**
 * `applyConsumption` in one statement instead of two, for a row this
 * transaction already locked and read (`locked`, from takeAndLock).
 *
 * Same result: draw `sasiaVjeter` down, and when that reaches zero promote
 * the pending prices and clear the three columns. SET expressions all see the
 * row as it was before this UPDATE, so `"sasiaVjeter" - n <= 0` is exactly the
 * old second statement's `GREATEST(0, "sasiaVjeter" - n) <= 0`.
 *
 * No pending change (`sasiaVjeter` null) means both old statements matched no
 * row, so nothing is sent at all. The lock guarantees nobody else changed it
 * since `locked` was read.
 */
export async function applyConsumptionLocked(tx: Tx, locked: PricedProduct, sasia: number) {
  if (locked.sasiaVjeter == null) return

  await tx.$executeRaw`
    UPDATE "Product"
       SET "cmimiBlerjes"   = CASE WHEN "sasiaVjeter" - ${sasia}::double precision <= 0
                                   THEN COALESCE("cmimiBlerjesRi", "cmimiBlerjes") ELSE "cmimiBlerjes" END,
           "cmimiShitjes"   = CASE WHEN "sasiaVjeter" - ${sasia}::double precision <= 0
                                   THEN COALESCE("cmimiShitjesRi", "cmimiShitjes") ELSE "cmimiShitjes" END,
           "cmimiBlerjesRi" = CASE WHEN "sasiaVjeter" - ${sasia}::double precision <= 0
                                   THEN NULL ELSE "cmimiBlerjesRi" END,
           "cmimiShitjesRi" = CASE WHEN "sasiaVjeter" - ${sasia}::double precision <= 0
                                   THEN NULL ELSE "cmimiShitjesRi" END,
           "sasiaVjeter"    = CASE WHEN "sasiaVjeter" - ${sasia}::double precision <= 0
                                   THEN NULL ELSE GREATEST(0, "sasiaVjeter" - ${sasia}::double precision) END
     WHERE id = ${locked.id}
       AND "sasiaVjeter" IS NOT NULL
  `
}

export interface PriceUpdate {
  cmimiBlerjes: number
  /** Omitted when the delivery did not change the sale price. */
  cmimiShitjes?: number
}

/**
 * What a delivery should write to a product when the operator ticked
 * "Përditëso".
 *
 * No stock on hand → nothing to protect, so the prices apply at once.
 * Stock on hand → the prices wait behind the existing units.
 * Stock not tracked (`tracked` false, e.g. kg) → there is no count of old
 * units to wait behind, so the prices apply at once as well.
 *
 * If a change is already pending when another delivery arrives, the newest
 * prices win and `sasiaVjeter` is left alone: those original units are still
 * the old ones, and their count has not changed. Tracking each delivery as its
 * own cost layer would need full FIFO costing, which is a much larger change
 * than this behaviour is worth.
 */
export function planPriceUpdate(
  product: PricedProduct,
  next: PriceUpdate,
  tracked = true
): Prisma.ProductUpdateInput {
  const stokuAktual = tracked ? product.sasia : 0
  const cmimiShitjes = next.cmimiShitjes ?? product.cmimiShitjes

  if (stokuAktual <= 0) {
    return {
      cmimiBlerjes: next.cmimiBlerjes,
      cmimiShitjes,
      cmimiBlerjesRi: null,
      cmimiShitjesRi: null,
      sasiaVjeter: null,
    }
  }

  const alreadyPending = pendingPrice(product)

  return {
    cmimiBlerjesRi: next.cmimiBlerjes,
    cmimiShitjesRi: cmimiShitjes,
    sasiaVjeter: alreadyPending ? alreadyPending.sasiaVjeter : stokuAktual,
  }
}

/** Human-readable note for the UI, e.g. "120 L → 100 L pas 2 copëve". */
export function pendingLabel(p: PricedProduct, njesia: string): string | null {
  const pending = pendingPrice(p)
  if (!pending) return null

  const parts: string[] = []
  if (pending.cmimiShitjesRi !== p.cmimiShitjes) {
    parts.push(`${Math.round(p.cmimiShitjes)} L → ${Math.round(pending.cmimiShitjesRi)} L`)
  }
  if (pending.cmimiBlerjesRi !== p.cmimiBlerjes) {
    parts.push(`blerja ${Math.round(p.cmimiBlerjes)} → ${Math.round(pending.cmimiBlerjesRi)} L`)
  }
  if (parts.length === 0) return null

  return `${parts.join(' · ')} pas ${pending.sasiaVjeter} ${njesia}`
}

/** Narrow select covering everything the pricing helpers need. */
export const PRICED_PRODUCT_SELECT = {
  id: true,
  sasia: true,
  cmimiBlerjes: true,
  cmimiShitjes: true,
  cmimiBlerjesRi: true,
  cmimiShitjesRi: true,
  sasiaVjeter: true,
} satisfies Prisma.ProductSelect

export type { Product }
