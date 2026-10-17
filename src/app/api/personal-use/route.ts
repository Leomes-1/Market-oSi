import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/auth-helpers'
import { ApiFailure, badRequest, handleApiError } from '@/lib/api'
import { validateQuantity } from '@/lib/validation'
import { applyConsumption, priceConsumption, PRICED_PRODUCT_SELECT } from '@/lib/pricing'

export const dynamic = 'force-dynamic'

/**
 * Personal use — stock the owner takes for themselves.
 *
 * Reduces stock exactly as a sale does, with the same validation and the same
 * atomic guard, but lives in its own table so it can never leak into revenue,
 * profit or any sales report.
 */

export async function GET(req: NextRequest) {
  const { error } = await requireRole(['admin'])
  if (error) return error

  try {
    const { searchParams } = new URL(req.url)
    const nga = searchParams.get('nga')
    const deri = searchParams.get('deri')

    const where: { data?: { gte?: Date; lte?: Date } } = {}
    if (nga || deri) {
      where.data = {}
      if (nga) {
        const d = new Date(nga)
        if (Number.isNaN(d.getTime())) return badRequest('Data e fillimit e pavlefshme')
        d.setHours(0, 0, 0, 0)
        where.data.gte = d
      }
      if (deri) {
        const d = new Date(deri)
        if (Number.isNaN(d.getTime())) return badRequest('Data e mbarimit e pavlefshme')
        d.setHours(23, 59, 59, 999)
        where.data.lte = d
      }
    }

    const entries = await prisma.personalUse.findMany({
      where,
      orderBy: { data: 'desc' },
      take: 500,
    })

    // Cost per calendar month, newest first, for the summary strip.
    const byMonth = new Map<string, { muaji: string; totali: number; numri: number }>()
    for (const e of entries) {
      const d = new Date(e.data)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const bucket = byMonth.get(key) ?? { muaji: key, totali: 0, numri: 0 }
      bucket.totali += e.totali
      bucket.numri += 1
      byMonth.set(key, bucket)
    }

    return NextResponse.json({
      entries,
      totali: entries.reduce((s, e) => s + e.totali, 0),
      muajt: Array.from(byMonth.values()).sort((a, b) => b.muaji.localeCompare(a.muaji)),
    })
  } catch (error) {
    return handleApiError(error, 'PersonalUse GET')
  }
}

export async function POST(req: NextRequest) {
  const { userId, role, error } = await requireRole(['admin'])
  if (error) return error

  try {
    const body = await req.json()
    const productId = Number(body?.productId)
    if (!Number.isInteger(productId) || productId <= 0) {
      return badRequest('Produkt i pavlefshëm')
    }
    if (!Number.isFinite(Number(body?.sasia))) {
      return badRequest('Sasi e pavlefshme')
    }

    let dataPerdorimit = new Date()
    if (body?.data) {
      const parsed = new Date(body.data)
      if (Number.isNaN(parsed.getTime())) return badRequest('Data e pavlefshme')
      dataPerdorimit = parsed
    }

    const entry = await prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({ where: { id: productId } })
      if (!product) throw new ApiFailure('Produkti nuk u gjet', 404, 'NOT_FOUND')

      const qty = validateQuantity(body.sasia, product.njesia, product.emri)
      if (!qty.ok) throw new ApiFailure(qty.error, 400, 'VALIDATION')

      // Same conditional decrement as a sale: the guard and the write are one
      // statement, so stock cannot be driven below zero.
      const updated = await tx.product.updateMany({
        where: { id: productId, sasia: { gte: qty.value } },
        data: { sasia: { decrement: qty.value } },
      })
      if (updated.count !== 1) {
        throw new ApiFailure(
          `Stoku i pamjaftueshëm për: ${product.emri}. Stoku: ${product.sasia}`,
          409,
          'INSUFFICIENT_STOCK'
        )
      }

      // Personal use draws down the old-price stock exactly like a sale, so a
      // pending price change promotes on schedule whichever way stock leaves.
      const locked = await tx.product.findUniqueOrThrow({
        where: { id: productId },
        select: PRICED_PRODUCT_SELECT,
      })
      const pricing = priceConsumption(locked, qty.value)
      await applyConsumption(tx, productId, qty.value)

      return tx.personalUse.create({
        data: {
          productId,
          emriProduktit: product.emri,
          sasia: qty.value,
          njesia: product.njesia,
          cmimiBlerjes: pricing.cmimiBlerjes,
          totali: pricing.cmimiBlerjes * qty.value,
          data: dataPerdorimit,
          userId: userId ?? '',
          userEmail: typeof body?.userEmail === 'string' ? body.userEmail : '',
          shenime:
            typeof body?.shenime === 'string' && body.shenime.trim()
              ? body.shenime.trim()
              : null,
        },
      })
    })

    return NextResponse.json(entry, { status: 201 })
  } catch (err) {
    return handleApiError(err, `PersonalUse POST (role ${role})`)
  }
}
