import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/auth-helpers'
import { badRequest, handleApiError, parseId } from '@/lib/api'
import { CATALOG_SELECT, toCatalogProduct } from '@/lib/catalog-shape'
import { isTileGroupKey } from '@/lib/tile-groups'
import { scheduleSnapshot } from '@/lib/backups/snapshot'

/**
 * A product's place on the POS tiles: on or off (`neArke`: "+ Shto produkt" /
 * ×) and its group (`grupiArke`: the group selector / ⋯; null = automatic).
 * Either field may be sent alone; nothing else about the product changes.
 * Admin only — cashiers just see the tiles.
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
    if (!body || typeof body !== 'object') return badRequest('Të dhëna të pavlefshme')

    const data: { neArke?: boolean; grupiArke?: string | null } = {}
    if ('neArke' in body) {
      if (typeof body.neArke !== 'boolean') return badRequest('neArke duhet true ose false')
      data.neArke = body.neArke
    }
    if ('grupiArke' in body) {
      if (body.grupiArke !== null && !isTileGroupKey(body.grupiArke)) {
        return badRequest('Grupi i pllakës i pavlefshëm')
      }
      data.grupiArke = body.grupiArke
    }
    if (Object.keys(data).length === 0) return badRequest('Asgjë për të ndryshuar')

    const product = await prisma.product.update({
      where: { id },
      data,
      select: CATALOG_SELECT,
    })

    scheduleSnapshot()
    return NextResponse.json(toCatalogProduct(product, role !== 'cashier'))
  } catch (error) {
    return handleApiError(error, 'Product tile PUT')
  }
}
