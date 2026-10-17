import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/auth-helpers'
import { ApiFailure, badRequest, handleApiError } from '@/lib/api'
import { validatePrice, validateQuantity } from '@/lib/validation'

const SUPPLY_INCLUDE = {
  furnitor: { select: { id: true, emri: true } },
  items: {
    include: { product: { select: { id: true, emri: true, njesia: true } } },
  },
} as const

export async function GET() {
  const { error } = await requireRole(['admin', 'staff'])
  if (error) return error

  try {
    const supplies = await prisma.supply.findMany({
      include: SUPPLY_INCLUDE,
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json(supplies)
  } catch (error) {
    return handleApiError(error, 'Supplies GET')
  }
}

export async function POST(req: NextRequest) {
  const { error } = await requireRole(['admin', 'staff'])
  if (error) return error

  try {
    const body = await req.json()
    const { furnitorId, data, shenime, items } = body

    if (!Array.isArray(items) || items.length === 0) {
      return badRequest('Nuk ka produkte në furnizim')
    }

    const rawLines: Array<{
      productId: number
      sasia: number
      cmimiBlerjes: number
      updatePrice: boolean
    }> = []

    for (const item of items) {
      const productId = Number(item?.productId)
      if (!Number.isInteger(productId) || productId <= 0) {
        return badRequest('Produkti është i pavlefshëm')
      }
      rawLines.push({
        productId,
        sasia: Number(item?.sasia),
        cmimiBlerjes: Number(item?.cmimiBlerjes),
        updatePrice: item?.updatePrice === true,
      })
    }

    let deliveryDate = new Date()
    if (data) {
      const parsed = new Date(data)
      if (Number.isNaN(parsed.getTime())) {
        return badRequest('Data e furnizimit është e pavlefshme')
      }
      deliveryDate = parsed
    }

    const supply = await prisma.$transaction(async (tx) => {
      const products = await tx.product.findMany({
        where: { id: { in: rawLines.map((l) => l.productId) } },
      })
      const byId = new Map(products.map((p) => [p.id, p]))

      let totali = 0
      const itemData: Array<{
        productId: number
        emriProduktit: string
        sasia: number
        njesia: string
        cmimiBlerjes: number
        totali: number
        updatePrice: boolean
      }> = []

      for (const line of rawLines) {
        const product = byId.get(line.productId)
        if (!product) {
          throw new ApiFailure(`Produkti nuk u gjet (id ${line.productId})`, 404, 'NOT_FOUND')
        }

        const qty = validateQuantity(line.sasia, product.njesia, product.emri)
        if (!qty.ok) throw new ApiFailure(qty.error, 400, 'VALIDATION')

        const price = validatePrice(line.cmimiBlerjes, product.emri)
        if (!price.ok) throw new ApiFailure(price.error, 400, 'VALIDATION')

        const lineTotal = qty.value * price.value
        totali += lineTotal

        itemData.push({
          productId: product.id,
          emriProduktit: product.emri,
          sasia: qty.value,
          njesia: product.njesia,
          cmimiBlerjes: price.value,
          totali: lineTotal,
          updatePrice: line.updatePrice,
        })
      }

      const newSupply = await tx.supply.create({
        data: {
          furnitorId: furnitorId ? Number(furnitorId) : null,
          data: deliveryDate,
          shenime: typeof shenime === 'string' && shenime.trim() ? shenime.trim() : null,
          totali,
          items: {
            create: itemData.map(({ updatePrice: _skip, ...rest }) => rest),
          },
        },
        include: SUPPLY_INCLUDE,
      })

      for (const item of itemData) {
        await tx.product.update({
          where: { id: item.productId },
          data: {
            sasia: { increment: item.sasia },
            ...(item.updatePrice ? { cmimiBlerjes: item.cmimiBlerjes } : {}),
          },
        })
      }

      return newSupply
    })

    return NextResponse.json(supply, { status: 201 })
  } catch (error) {
    return handleApiError(error, 'Supplies POST')
  }
}
