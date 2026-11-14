import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/auth-helpers'
import { handleApiError } from '@/lib/api'
import { tracksStock } from '@/lib/validation'
import { invoicedValue, stockValue } from '@/lib/inventari'

export const dynamic = 'force-dynamic'

/**
 * Inventari: every product with its stock and what that stock is worth, at
 * purchase and at sale prices, plus its invoiced ("Me TVSH") part. Admin only.
 * kg products have no stock count, so their stock and values are null.
 */
export async function GET() {
  const { error } = await requireRole(['admin'])
  if (error) return error

  try {
    const products = await prisma.product.findMany({
      select: {
        id: true,
        emri: true,
        kategoria: true,
        njesia: true,
        sasia: true,
        sasiaFaturuar: true,
        cmimiBlerjes: true,
        cmimiShitjes: true,
        cmimiBlerjesRi: true,
        cmimiShitjesRi: true,
        sasiaVjeter: true,
      },
      orderBy: [{ kategoria: 'asc' }, { emri: 'asc' }],
    })

    return NextResponse.json({
      products: products.map((p) => {
        const tracked = tracksStock(p.njesia)
        const value = tracked ? stockValue(p) : null
        return {
          id: p.id,
          emri: p.emri,
          kategoria: p.kategoria,
          njesia: p.njesia,
          tracked,
          sasia: tracked ? p.sasia : null,
          sasiaFaturuar: tracked ? p.sasiaFaturuar : 0,
          vleraBlerje: value?.blerje ?? null,
          vleraShitje: value?.shitje ?? null,
          vleraFaturuar: tracked ? invoicedValue(p, p.sasiaFaturuar) : 0,
        }
      }),
    })
  } catch (error) {
    return handleApiError(error, 'Inventari GET')
  }
}
