import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/auth-helpers'
import { badRequest, handleApiError, parseId } from '@/lib/api'
import { CATALOG_SELECT, toCatalogProduct } from '@/lib/catalog-shape'
import { scheduleSnapshot } from '@/lib/backups/snapshot'

/**
 * Puts a product on the POS tiles or takes it off ("+ Shto produkt" / ×).
 * Only flips `neArke`; the product itself is untouched. Admin only — cashiers
 * just see the tiles.
 *
 * Returns the catalogue row so the POS can drop it straight into its cache.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { role, error } = await requireRole(['admin'])
  if (error) return error

  try {
    const id = parseId(params.id)
    if (id === null) return badRequest('ID i pavlefshëm')

    const body = await req.json().catch(() => null)
    if (typeof body?.neArke !== 'boolean') return badRequest('neArke duhet true ose false')

    const product = await prisma.product.update({
      where: { id },
      data: { neArke: body.neArke },
      select: CATALOG_SELECT,
    })

    scheduleSnapshot()
    return NextResponse.json(toCatalogProduct(product, role !== 'cashier'))
  } catch (error) {
    return handleApiError(error, 'Product tile PUT')
  }
}
