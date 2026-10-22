import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth-helpers'
import { handleApiError } from '@/lib/api'
import { CATALOG_SELECT, toCatalogProduct } from '@/lib/catalog-shape'

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
 * Row shape and the cashier cost-stripping live in lib/catalog-shape, shared
 * with the single-barcode lookup.
 */
export async function GET() {
  const { role, error } = await requireAuth()
  if (error) return error

  try {
    const products = await prisma.product.findMany({
      select: CATALOG_SELECT,
      orderBy: { emri: 'asc' },
    })

    const showCost = role !== 'cashier'
    return NextResponse.json(products.map((p) => toCatalogProduct(p, showCost)))
  } catch (error) {
    return handleApiError(error, 'Products catalog GET')
  }
}
