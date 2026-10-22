import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth-helpers'
import { badRequest, handleApiError, notFound } from '@/lib/api'
import { CATALOG_SELECT, toCatalogProduct } from '@/lib/catalog-shape'

export const dynamic = 'force-dynamic'

/**
 * One catalogue row by exact barcode.
 *
 * Scans resolve against the cached catalogue in the browser; this is only the
 * fallback for a barcode the cache doesn't know — a product added on another
 * device after the page loaded. Same shape and same cost-stripping as
 * /api/products/catalog, so the result can go straight into that cache.
 */
export async function GET(req: NextRequest) {
  const { role, error } = await requireAuth()
  if (error) return error

  try {
    const code = (new URL(req.url).searchParams.get('code') || '').trim()
    if (!code) return badRequest('Barkodi mungon')

    const row = await prisma.productBarcode.findUnique({
      where: { barcode: code },
      select: { product: { select: CATALOG_SELECT } },
    })
    if (!row) return notFound('Produkti nuk u gjet')

    return NextResponse.json(toCatalogProduct(row.product, role !== 'cashier'))
  } catch (error) {
    return handleApiError(error, 'Product barcode GET')
  }
}
