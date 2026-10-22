import type { Prisma } from '@prisma/client'

/**
 * The catalogue row as the UI receives it, shared by the full catalogue and
 * the single-barcode lookup so both hand the client the identical shape.
 *
 * Trimmed vs. the full product: no createdAt/updatedAt, no nested supplier
 * object (just id + name), and barcodes flattened from rows to plain strings.
 */
export interface CatalogProduct {
  id: number
  emri: string
  kategoria: string
  sasia: number
  stokuMinimal: number
  njesia: string
  cmimiShitjes: number
  /** Omitted for cashiers — cost price would let them derive the margin. */
  cmimiBlerjes?: number
  furnitorId: number | null
  furnitorEmri: string | null
  barcodes: string[]
  /** Pending price change waiting for the old stock to run out, if any. */
  cmimiShitjesRi: number | null
  cmimiBlerjesRi?: number | null
  sasiaVjeter: number | null
}

export const CATALOG_SELECT = {
  id: true,
  emri: true,
  kategoria: true,
  sasia: true,
  stokuMinimal: true,
  njesia: true,
  cmimiShitjes: true,
  cmimiBlerjes: true,
  furnitorId: true,
  furnitor: { select: { emri: true } },
  barcodes: { select: { barcode: true } },
  cmimiShitjesRi: true,
  cmimiBlerjesRi: true,
  sasiaVjeter: true,
} satisfies Prisma.ProductSelect

type CatalogRow = Prisma.ProductGetPayload<{ select: typeof CATALOG_SELECT }>

export function toCatalogProduct(p: CatalogRow, showCost: boolean): CatalogProduct {
  return {
    id: p.id,
    emri: p.emri,
    kategoria: p.kategoria,
    sasia: p.sasia,
    stokuMinimal: p.stokuMinimal,
    njesia: p.njesia,
    cmimiShitjes: p.cmimiShitjes,
    ...(showCost ? { cmimiBlerjes: p.cmimiBlerjes } : {}),
    furnitorId: p.furnitorId,
    furnitorEmri: p.furnitor?.emri ?? null,
    barcodes: p.barcodes.map((b) => b.barcode),
    cmimiShitjesRi: p.cmimiShitjesRi,
    ...(showCost ? { cmimiBlerjesRi: p.cmimiBlerjesRi } : {}),
    sasiaVjeter: p.sasiaVjeter,
  }
}
