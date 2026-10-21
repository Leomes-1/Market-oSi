import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/auth-helpers'
import { ApiFailure, badRequest, handleApiError } from '@/lib/api'
import { mergeByProductId, tracksStock, validateQuantity } from '@/lib/validation'
import { applyConsumption, lockProduct, priceConsumption, PRICED_PRODUCT_SELECT } from '@/lib/pricing'
import { scheduleSnapshot } from '@/lib/backups/snapshot'

export const dynamic = 'force-dynamic'

/**
 * Personal use — stock the owner takes for themselves.
 *
 * One registration holds several product lines, the same header/line shape as
 * Sale/SaleItem. Stock is reduced exactly as a sale reduces it, with the same
 * validation and the same atomic guard, but it lives in its own tables so it
 * can never leak into revenue, profit or any sales report.
 */

interface IncomingItem {
  productId: number
  sasia: number
}

export async function GET(req: NextRequest) {
  const { error } = await requireRole(['admin', 'cashier'])
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

    const entries = await prisma.personalUseEntry.findMany({
      where,
      orderBy: { data: 'desc' },
      take: 500,
      include: { items: { orderBy: { id: 'asc' } } },
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
  const { userId, role, error } = await requireRole(['admin', 'cashier'])
  if (error) return error

  try {
    const body = await req.json()
    const { items, shenime } = body

    if (!Array.isArray(items) || items.length === 0) {
      return badRequest('Nuk ka produkte në regjistrim')
    }

    // Normalise the incoming lines before touching the database. Costs are
    // deliberately ignored here — they are always read from the product.
    const rawLines: IncomingItem[] = []
    for (const item of items) {
      const productId = Number(item?.productId)
      if (!Number.isInteger(productId) || productId <= 0) {
        return badRequest('Produkt i pavlefshëm në regjistrim')
      }
      const sasia = Number(item?.sasia)
      if (!Number.isFinite(sasia)) {
        return badRequest('Sasi e pavlefshme në regjistrim')
      }
      rawLines.push({ productId, sasia })
    }

    // The same product listed twice is one line, so the stock check sees the
    // full quantity instead of each line passing against the same stock.
    const lines = mergeByProductId(rawLines)

    let dataPerdorimit = new Date()
    if (body?.data) {
      const parsed = new Date(body.data)
      if (Number.isNaN(parsed.getTime())) return badRequest('Data e pavlefshme')
      dataPerdorimit = parsed
    }

    // Taken from the session's own role row, never from the request body.
    const userEmail =
      (await prisma.userRole.findUnique({
        where: { userId: userId ?? '' },
        select: { email: true },
      }))?.email ?? ''

    const entry = await prisma.$transaction(async (tx) => {
      const products = await tx.product.findMany({
        where: { id: { in: lines.map((l) => l.productId) } },
      })
      const byId = new Map(products.map((p) => [p.id, p]))

      // Validate every line before touching stock, so a bad line fails the
      // whole registration rather than half-applying it.
      const validated: Array<{ productId: number; emri: string; njesia: string; sasia: number }> = []
      for (const line of lines) {
        const product = byId.get(line.productId)
        if (!product) {
          throw new ApiFailure(`Produkti nuk u gjet (id ${line.productId})`, 404, 'NOT_FOUND')
        }
        const qty = validateQuantity(line.sasia, product.njesia, product.emri)
        if (!qty.ok) {
          throw new ApiFailure(qty.error, 400, 'VALIDATION')
        }
        validated.push({
          productId: product.id,
          emri: product.emri,
          njesia: product.njesia,
          sasia: qty.value,
        })
      }

      let totali = 0
      const itemData: Array<{
        productId: number
        emriProduktit: string
        sasia: number
        njesia: string
        cmimiBlerjes: number
        totali: number
      }> = []

      for (const line of validated) {
        if (tracksStock(line.njesia)) {
          // Conditional decrement: the `sasia: { gte }` guard and the write are
          // a single atomic statement, so stock can never be driven below zero.
          // It also takes the row lock, which is what makes the re-read
          // consistent.
          const updated = await tx.product.updateMany({
            where: { id: line.productId, sasia: { gte: line.sasia } },
            data: { sasia: { decrement: line.sasia } },
          })
          if (updated.count !== 1) {
            const current = byId.get(line.productId)
            throw new ApiFailure(
              `Stoku i pamjaftueshëm për: ${line.emri}. Stoku: ${current?.sasia ?? 0}`,
              409,
              'INSUFFICIENT_STOCK'
            )
          }
        } else {
          // Untracked (kg): no stock to take, only the lock for the re-read.
          await lockProduct(tx, line.productId)
        }

        // Personal use draws down the old-price stock exactly like a sale, so a
        // pending price change promotes on schedule whichever way stock leaves.
        const locked = await tx.product.findUniqueOrThrow({
          where: { id: line.productId },
          select: PRICED_PRODUCT_SELECT,
        })
        const pricing = priceConsumption(locked, line.sasia)
        await applyConsumption(tx, line.productId, line.sasia)

        const lineTotal = pricing.cmimiBlerjes * line.sasia
        totali += lineTotal

        itemData.push({
          productId: line.productId,
          emriProduktit: line.emri,
          sasia: line.sasia,
          njesia: line.njesia,
          cmimiBlerjes: pricing.cmimiBlerjes,
          totali: lineTotal,
        })
      }

      return tx.personalUseEntry.create({
        data: {
          data: dataPerdorimit,
          userId: userId ?? '',
          userEmail,
          shenime:
            typeof shenime === 'string' && shenime.trim() ? shenime.trim() : null,
          totali,
          items: { create: itemData },
        },
        include: { items: true },
      })
    })

    scheduleSnapshot()
    return NextResponse.json(entry, { status: 201 })
  } catch (err) {
    return handleApiError(err, `PersonalUse POST (role ${role})`)
  }
}
