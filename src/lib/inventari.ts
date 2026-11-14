import type { Prisma } from '@prisma/client'
import { ApiFailure } from './api'

/**
 * Inventari — invoiced ("Me TVSH") stock.
 *
 * A supply ticked "Me TVSH" adds its units to normal stock exactly as before,
 * and also to `Product.sasiaFaturuar`. Sales and personal use take invoiced
 * units first (lib/pricing `takeAndLock`) and record how many on the line, so
 * a delete or edit can give them back. There are no VAT rates or VAT
 * amounts anywhere: prices stay exactly as entered from the invoice, and
 * profit is unchanged.
 *
 * The database keeps 0 <= sasiaFaturuar <= sasia with two CHECK constraints
 * (migration 8_inventari). A CHECK is evaluated per statement, so every write
 * that lowers `sasia` lowers `sasiaFaturuar` in the same UPDATE.
 */

type Tx = Prisma.TransactionClient

/**
 * Floating-point slack for the guards below. Quantities have at most three
 * decimals, so this never lets a real shortfall through; it only stops
 * 0.1 + 0.2 from being refused against a stored 0.3. The writes clamp with
 * LEAST/GREATEST so the CHECK constraints still hold exactly.
 */
const EPS = 1e-9

export const NR_FATURES_MAX = 60

export type InvoiceFields =
  | { ok: true; meTvsh: boolean; nrFatures: string | null }
  | { ok: false; error: string }

/** Reads `meTvsh` and `nrFatures` off a request body. */
export function parseInvoiceFields(body: unknown): InvoiceFields {
  const b = (body ?? {}) as { meTvsh?: unknown; nrFatures?: unknown }
  if (b.meTvsh !== undefined && typeof b.meTvsh !== 'boolean') {
    return { ok: false, error: 'meTvsh duhet true ose false' }
  }
  let nrFatures: string | null = null
  if (b.nrFatures !== undefined && b.nrFatures !== null) {
    if (typeof b.nrFatures !== 'string') return { ok: false, error: 'Numri i faturës i pavlefshëm' }
    nrFatures = b.nrFatures.trim() || null
    if (nrFatures && nrFatures.length > NR_FATURES_MAX) {
      return { ok: false, error: `Numri i faturës mund të ketë deri në ${NR_FATURES_MAX} shkronja` }
    }
  }
  return { ok: true, meTvsh: b.meTvsh === true, nrFatures }
}

/** Drops the invoice fields for non-admins — Inventari is admin-only. */
export function hideInvoiceFields<T extends { meTvsh: boolean; nrFatures: string | null }>(
  supply: T
): Omit<T, 'meTvsh' | 'nrFatures'> {
  const { meTvsh: _m, nrFatures: _n, ...rest } = supply
  return rest
}

function fmtQty(n: number): string {
  return String(Number(n.toFixed(3)))
}

async function stockOf(tx: Tx, productId: number) {
  return tx.product.findUnique({
    where: { id: productId },
    select: { sasia: true, sasiaFaturuar: true },
  })
}

/**
 * Takes a deleted supply line's units back off the shelf. For a "Me TVSH"
 * supply they also come out of invoiced stock — refused if fewer invoiced
 * units are left than the line brought, because the rest were already sold.
 */
export async function removeSupplyLine(
  tx: Tx,
  line: { productId: number; sasia: number; emriProduktit: string },
  meTvsh: boolean
) {
  const n = line.sasia
  const updated = meTvsh
    ? await tx.$executeRaw`
        UPDATE "Product"
           SET sasia = sasia - ${n}::double precision,
               "sasiaFaturuar" = GREATEST(0, "sasiaFaturuar" - ${n}::double precision),
               "updatedAt" = (${new Date().toISOString()}::timestamptz AT TIME ZONE 'UTC')
         WHERE id = ${line.productId}
           AND sasia >= ${n}::double precision
           AND "sasiaFaturuar" >= ${n - EPS}::double precision
      `
    : (
        await tx.product.updateMany({
          where: { id: line.productId, sasia: { gte: n } },
          data: { sasia: { decrement: n } },
        })
      ).count
  if (updated === 1) return

  const current = await stockOf(tx, line.productId)
  if (meTvsh && current && current.sasia >= n) {
    throw new ApiFailure(
      `Nuk mund të fshihet: nga "${line.emriProduktit}" kanë mbetur vetëm ` +
        `${fmtQty(current.sasiaFaturuar)} njësi me faturë, më pak se ${fmtQty(n)} që solli ky ` +
        `furnizim me TVSH — pjesa tjetër është shitur.`,
      409,
      'INSUFFICIENT_STOCK'
    )
  }
  throw new ApiFailure(
    `Nuk mund të fshihet: stoku i "${line.emriProduktit}" është ${fmtQty(current?.sasia ?? 0)}, ` +
      `më pak se ${fmtQty(n)} që solli ky furnizim. Korrigjo stokun më parë.`,
    409,
    'INSUFFICIENT_STOCK'
  )
}

/**
 * A supply edited to "Me TVSH": its units on the shelf become invoiced.
 * Refused when the product doesn't have that many non-invoiced units left.
 */
export async function markLineInvoiced(
  tx: Tx,
  line: { productId: number; sasia: number; emriProduktit: string }
) {
  const n = line.sasia
  const updated = await tx.$executeRaw`
    UPDATE "Product"
       SET "sasiaFaturuar" = LEAST(sasia, "sasiaFaturuar" + ${n}::double precision),
           "updatedAt" = (${new Date().toISOString()}::timestamptz AT TIME ZONE 'UTC')
     WHERE id = ${line.productId}
       AND "sasiaFaturuar" + ${n}::double precision <= sasia + ${EPS}::double precision
  `
  if (updated === 1) return
  const current = await stockOf(tx, line.productId)
  const free = Math.max(0, (current?.sasia ?? 0) - (current?.sasiaFaturuar ?? 0))
  throw new ApiFailure(
    `Nuk mund të shënohet me TVSH: "${line.emriProduktit}" ka vetëm ${fmtQty(free)} njësi ` +
      `pa faturë në stok, më pak se ${fmtQty(n)} të këtij furnizimi — pjesa tjetër është shitur.`,
    409,
    'INSUFFICIENT_STOCK'
  )
}

/**
 * A supply edited from "Me TVSH" to without: its units leave invoiced stock
 * (they stay in normal stock). Refused if they were already sold.
 */
export async function unmarkLineInvoiced(
  tx: Tx,
  line: { productId: number; sasia: number; emriProduktit: string }
) {
  const n = line.sasia
  const updated = await tx.$executeRaw`
    UPDATE "Product"
       SET "sasiaFaturuar" = GREATEST(0, "sasiaFaturuar" - ${n}::double precision),
           "updatedAt" = (${new Date().toISOString()}::timestamptz AT TIME ZONE 'UTC')
     WHERE id = ${line.productId}
       AND "sasiaFaturuar" >= ${n - EPS}::double precision
  `
  if (updated === 1) return
  const current = await stockOf(tx, line.productId)
  throw new ApiFailure(
    `Nuk mund të hiqet TVSH-ja: nga "${line.emriProduktit}" kanë mbetur vetëm ` +
      `${fmtQty(current?.sasiaFaturuar ?? 0)} njësi me faturë, më pak se ${fmtQty(n)} që solli ky ` +
      `furnizim — pjesa tjetër është shitur.`,
    409,
    'INSUFFICIENT_STOCK'
  )
}

// ── Valuation (pure, used by the page and the API) ─────────────────────────

export interface ValuedProduct {
  sasia: number
  cmimiBlerjes: number
  cmimiShitjes: number
  cmimiBlerjesRi: number | null
  cmimiShitjesRi: number | null
  sasiaVjeter: number | null
}

/**
 * Value of the stock on hand at purchase and at sale prices. While a price
 * change is pending, the `sasiaVjeter` oldest units are still at the old
 * prices and the rest at the new ones — the same split sales use.
 */
export function stockValue(p: ValuedProduct): { blerje: number; shitje: number } {
  const sasia = Math.max(0, p.sasia)
  const vjeter =
    p.sasiaVjeter != null && p.sasiaVjeter > 0 ? Math.min(sasia, p.sasiaVjeter) : sasia
  const reja = sasia - vjeter
  return {
    blerje: vjeter * p.cmimiBlerjes + reja * (p.cmimiBlerjesRi ?? p.cmimiBlerjes),
    shitje: vjeter * p.cmimiShitjes + reja * (p.cmimiShitjesRi ?? p.cmimiShitjes),
  }
}

/**
 * Purchase value of `njesi` invoiced units: the stock's average unit cost.
 * Invoiced and old-price units are separate counters with no link between
 * them, so the average is the honest figure.
 */
export function invoicedValue(p: ValuedProduct, njesi: number): number {
  if (p.sasia <= 0 || njesi <= 0) return 0
  return (stockValue(p).blerje / p.sasia) * njesi
}
