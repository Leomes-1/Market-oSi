import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/auth-helpers'
import { ApiFailure, badRequest, handleApiError } from '@/lib/api'
import { mergeByProductId, validateQuantity } from '@/lib/validation'
import { applyConsumption, priceConsumption, PRICED_PRODUCT_SELECT } from '@/lib/pricing'
import { stripProfitFromSales } from '@/lib/sale-visibility'
import { scheduleSnapshot } from '@/lib/backups/snapshot'

export async function GET(req: NextRequest) {
  const { role, error } = await requireRole(['admin', 'cashier'])
  if (error) return error

  try {
    const { searchParams } = new URL(req.url)
    const periudha = searchParams.get('periudha') || 'sot'

    const now = new Date()
    let dateFrom: Date
    let dateTo: Date | undefined

    switch (periudha) {
      case 'sot':
        dateFrom = new Date(now)
        dateFrom.setHours(0, 0, 0, 0)
        break
      case 'dje':
        dateFrom = new Date(now)
        dateFrom.setDate(dateFrom.getDate() - 1)
        dateFrom.setHours(0, 0, 0, 0)
        dateTo = new Date(dateFrom)
        dateTo.setDate(dateTo.getDate() + 1)
        break
      case 'jave':
        dateFrom = new Date(now)
        dateFrom.setDate(dateFrom.getDate() - 7)
        dateFrom.setHours(0, 0, 0, 0)
        break
      case 'muaj':
        dateFrom = new Date(now)
        dateFrom.setDate(1)
        dateFrom.setHours(0, 0, 0, 0)
        break
      default:
        dateFrom = new Date(now)
        dateFrom.setHours(0, 0, 0, 0)
    }

    const sales = await prisma.sale.findMany({
      where: {
        createdAt: dateTo ? { gte: dateFrom, lt: dateTo } : { gte: dateFrom },
      },
      include: { items: { include: { product: true } } },
      orderBy: { createdAt: 'desc' },
    })

    // Cashiers never receive profit or cost figures, not even in the payload.
    return NextResponse.json(stripProfitFromSales(sales, role))
  } catch (error) {
    return handleApiError(error, 'Sales GET')
  }
}

interface IncomingItem {
  productId: number
  sasia: number
}

export async function POST(req: NextRequest) {
  const { error } = await requireRole(['admin', 'cashier'])
  if (error) return error

  try {
    const body = await req.json()
    const { items, shenime } = body

    if (!Array.isArray(items) || items.length === 0) {
      return badRequest('Nuk ka produkte në shitje')
    }

    // Normalise the incoming lines before touching the database. Prices are
    // deliberately ignored here — they are always read from the product.
    const rawLines: IncomingItem[] = []
    for (const item of items) {
      const productId = Number(item?.productId)
      if (!Number.isInteger(productId) || productId <= 0) {
        return badRequest('Produkt i pavlefshëm në shitje')
      }
      const sasia = Number(item?.sasia)
      if (!Number.isFinite(sasia)) {
        return badRequest('Sasi e pavlefshme në shitje')
      }
      rawLines.push({ productId, sasia })
    }

    // The same product listed twice is one line, so the stock check sees the
    // full quantity instead of each line passing against the same stock.
    const lines = mergeByProductId(rawLines)

    const sale = await prisma.$transaction(async (tx) => {
      const products = await tx.product.findMany({
        where: { id: { in: lines.map((l) => l.productId) } },
      })
      const byId = new Map(products.map((p) => [p.id, p]))

      // Validate every line before touching stock, so a bad line fails the
      // whole sale rather than half-applying it.
      const validated: Array<{ productId: number; emri: string; sasia: number }> = []
      for (const line of lines) {
        const product = byId.get(line.productId)
        if (!product) {
          throw new ApiFailure(`Produkti nuk u gjet (id ${line.productId})`, 404, 'NOT_FOUND')
        }
        const qty = validateQuantity(line.sasia, product.njesia, product.emri)
        if (!qty.ok) {
          throw new ApiFailure(qty.error, 400, 'VALIDATION')
        }
        validated.push({ productId: product.id, emri: product.emri, sasia: qty.value })
      }

      let totali = 0
      let fitimi = 0
      const itemData: Array<{
        productId: number
        emriProduktit: string
        sasia: number
        cmimiBlerjes: number
        cmimiShitjes: number
        fitimi: number
      }> = []

      for (const line of validated) {
        // Conditional decrement: the `sasia: { gte }` guard and the write are a
        // single atomic statement, so two tills selling the last unit cannot
        // both succeed and stock can never be driven below zero. It also takes
        // the row lock, which is what makes the re-read below consistent.
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

        // Re-read under the lock: prices and the pending-change counters must
        // be the committed values, not what a concurrent sale saw earlier.
        const locked = await tx.product.findUniqueOrThrow({
          where: { id: line.productId },
          select: PRICED_PRODUCT_SELECT,
        })

        const pricing = priceConsumption(locked, line.sasia)
        await applyConsumption(tx, line.productId, line.sasia)

        const lineFitimi = (pricing.cmimiShitjes - pricing.cmimiBlerjes) * line.sasia
        totali += pricing.cmimiShitjes * line.sasia
        fitimi += lineFitimi

        itemData.push({
          productId: line.productId,
          emriProduktit: line.emri,
          sasia: line.sasia,
          cmimiBlerjes: pricing.cmimiBlerjes,
          cmimiShitjes: pricing.cmimiShitjes,
          fitimi: lineFitimi,
        })
      }

      return tx.sale.create({
        data: {
          totali,
          fitimi,
          shenime: typeof shenime === 'string' && shenime.trim() ? shenime.trim() : null,
          items: { create: itemData },
        },
        include: { items: { include: { product: true } } },
      })
    })

    scheduleSnapshot()
    return NextResponse.json(sale, { status: 201 })
  } catch (error) {
    return handleApiError(error, 'Sales POST')
  }
}
