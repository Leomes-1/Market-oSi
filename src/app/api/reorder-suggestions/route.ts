import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/auth-helpers'
import { handleApiError } from '@/lib/api'
import { lowStockWhere } from '@/lib/low-stock'

export const dynamic = 'force-dynamic'

export async function GET() {
  const { error } = await requireRole(['admin', 'staff'])
  if (error) return error

  try {
    // Filtered in SQL. Untracked (kg) products have no meaningful count to
    // reorder from, so the filter leaves them out.
    const lowStock = await prisma.product.findMany({
      where: lowStockWhere(),
      select: {
        id: true,
        emri: true,
        kategoria: true,
        sasia: true,
        stokuMinimal: true,
        njesia: true,
        cmimiBlerjes: true,
        cmimiShitjes: true,
        furnitorId: true,
        furnitor: { select: { emri: true } },
      },
      orderBy: { emri: 'asc' },
    })

    type GroupedItem = {
      id: number
      emri: string
      kategoria: string
      sasia: number
      stokuMinimal: number
      njesia: string
      cmimiBlerjes: number
      cmimiShitjes: number
      sasiaSugjeruar: number
    }

    type Group = {
      furnitorId: number | null
      furnitorEmri: string
      products: GroupedItem[]
    }

    const groupMap = new Map<string, Group>()

    for (const p of lowStock) {
      const key = p.furnitorId != null ? String(p.furnitorId) : '__none__'
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          furnitorId: p.furnitorId,
          furnitorEmri: p.furnitor?.emri ?? 'Pa Furnitor',
          products: [],
        })
      }
      const sasiaSugjeruar = Math.max(p.stokuMinimal * 2 - p.sasia, p.stokuMinimal)
      groupMap.get(key)!.products.push({
        id: p.id,
        emri: p.emri,
        kategoria: p.kategoria,
        sasia: p.sasia,
        stokuMinimal: p.stokuMinimal,
        njesia: p.njesia,
        cmimiBlerjes: p.cmimiBlerjes,
        cmimiShitjes: p.cmimiShitjes,
        sasiaSugjeruar,
      })
    }

    const groups = Array.from(groupMap.values()).sort((a, b) => {
      if (a.furnitorId === null) return 1
      if (b.furnitorId === null) return -1
      return a.furnitorEmri.localeCompare(b.furnitorEmri)
    })

    return NextResponse.json({ totalProducts: lowStock.length, groups })
  } catch (error) {
    return handleApiError(error, 'Reorder suggestions GET')
  }
}
