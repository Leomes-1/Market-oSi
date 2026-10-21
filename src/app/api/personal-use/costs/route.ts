import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/auth-helpers'
import { handleApiError } from '@/lib/api'

export const dynamic = 'force-dynamic'

/**
 * Current cost price per product, for the live cost preview on Përdorim
 * Vetjak.
 *
 * The catalogue withholds cost from cashiers so the POS can't reveal margins,
 * but cashiers have full access to personal use, costs included. This gives
 * that page the one figure it needs without changing the catalogue for every
 * other screen. The saved cost is still computed on the server at recording.
 */
export async function GET() {
  const { error } = await requireRole(['admin', 'cashier'])
  if (error) return error

  try {
    const products = await prisma.product.findMany({
      select: { id: true, cmimiBlerjes: true },
    })
    return NextResponse.json(Object.fromEntries(products.map((p) => [p.id, p.cmimiBlerjes])))
  } catch (error) {
    return handleApiError(error, 'PersonalUse costs GET')
  }
}
