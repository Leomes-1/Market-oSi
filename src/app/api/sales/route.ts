import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/auth-helpers'
import { ApiFailure, badRequest, handleApiError } from '@/lib/api'
import { mergeByProductId, validateQuantity } from '@/lib/validation'
import { stripProfitFromSales } from '@/lib/sale-visibility'

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

      for (const line of lines) {
        const product = byId.get(line.productId)
        if (!product) {
          throw new ApiFailure(`Produkti nuk u gjet (id ${line.productId})`, 404, 'NOT_FOUND')
        }

        const qty = validateQuantity(line.sasia, product.njesia, product.emri)
        if (!qty.ok) {
          throw new ApiFailure(qty.error, 400, 'VALIDATION')
        }

        const lineFitimi = (product.cmimiShitjes - product.cmimiBlerjes) * qty.value
        totali += product.cmimiShitjes * qty.value
        fitimi += lineFitimi

        itemData.push({
          productId: product.id,
          emriProduktit: product.emri,
          sasia: qty.value,
          cmimiBlerjes: product.cmimiBlerjes,
          cmimiShitjes: product.cmimiShitjes,
          fitimi: lineFitimi,
        })
      }

      // Conditional decrement: the `sasia: { gte }` guard and the write are a
      // single atomic statement, so two tills selling the last unit cannot
      // both succeed and stock can never be driven below zero.
      for (const item of itemData) {
        const updated = await tx.product.updateMany({
          where: { id: item.productId, sasia: { gte: item.sasia } },
          data: { sasia: { decrement: item.sasia } },
        })
        if (updated.count !== 1) {
          const current = byId.get(item.productId)
          throw new ApiFailure(
            `Stoku i pamjaftueshëm për: ${item.emriProduktit}. Stoku: ${current?.sasia ?? 0}`,
            409,
            'INSUFFICIENT_STOCK'
          )
        }
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

    return NextResponse.json(sale, { status: 201 })
  } catch (error) {
    return handleApiError(error, 'Sales POST')
  }
}
