import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth-helpers'
import { handleApiError } from '@/lib/api'

export const dynamic = 'force-dynamic'

/**
 * The whole product catalogue in the smallest shape the UI actually needs.
 *
 * The screens fetch this once and then search, filter and resolve barcodes
 * locally. That is what makes a scan instant: no request is made at all.
 *
 * `GET /api/products` still exists for server-side search, but no screen calls
 * it per keystroke any more — that was firing one request per character, with
 * partial matches racing each other onto the screen.
 *
 * Trimmed vs. the full endpoint: no createdAt/updatedAt, no nested supplier
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

export async function GET() {
  const { role, error } = await requireAuth()
  if (error) return error

  try {
    const products = await prisma.product.findMany({
      select: {
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
      },
      orderBy: { emri: 'asc' },
    })

    const showCost = role !== 'cashier'

    const catalog: CatalogProduct[] = products.map((p) => ({
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
    }))

    return NextResponse.json(catalog)
  } catch (error) {
    return handleApiError(error, 'Products catalog GET')
  }
}
