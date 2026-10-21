import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/auth-helpers'
import { ApiFailure, badRequest, handleApiError, notFound, parseId, success } from '@/lib/api'
import { mergeByProductId, tracksStock, validateQuantity } from '@/lib/validation'
import { scheduleSnapshot } from '@/lib/backups/snapshot'

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { error } = await requireRole(['admin'])
  if (error) return error

  try {
    const saleId = parseId(params.id)
    if (saleId === null) return badRequest('ID i pavlefshëm')

    const body = await req.json()
    const { items } = body

    if (!Array.isArray(items) || items.length === 0) {
      return badRequest('Nuk ka produkte në shitje')
    }

    const rawLines: Array<{ productId: number; sasia: number }> = []
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

    const lines = mergeByProductId(rawLines)

    await prisma.$transaction(async (tx) => {
      const existingSale = await tx.sale.findUnique({
        where: { id: saleId },
        include: { items: { include: { product: { select: { njesia: true } } } } },
      })
      if (!existingSale) {
        throw new ApiFailure('Fatura nuk u gjet', 404, 'NOT_FOUND')
      }

      // The prices this invoice was actually written at. Keeping these is the
      // whole point: re-reading today's product prices would silently restate
      // the revenue and profit of a past period whenever someone corrects a
      // quantity typo.
      const originalPrices = new Map(
        existingSale.items.map((item) => [
          item.productId,
          { cmimiBlerjes: item.cmimiBlerjes, cmimiShitjes: item.cmimiShitjes },
        ])
      )

      // Put the original quantities back before re-applying the new ones, so
      // availability is measured against stock as it was before this invoice.
      // Untracked (kg) products have no stock to put back.
      for (const original of existingSale.items) {
        if (!tracksStock(original.product.njesia)) continue
        await tx.product.update({
          where: { id: original.productId },
          data: { sasia: { increment: original.sasia } },
        })
      }

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
      const untracked = new Set<number>()

      for (const line of lines) {
        const product = byId.get(line.productId)
        if (!product) {
          throw new ApiFailure(`Produkti nuk u gjet (id ${line.productId})`, 404, 'NOT_FOUND')
        }

        const qty = validateQuantity(line.sasia, product.njesia, product.emri)
        if (!qty.ok) {
          throw new ApiFailure(qty.error, 400, 'VALIDATION')
        }
        if (!tracksStock(product.njesia)) untracked.add(product.id)

        // A line already on this invoice keeps its historical prices. A line
        // the admin has just added has no history, so it is priced at today's
        // product price — the only defensible choice for a new line.
        const historical = originalPrices.get(product.id)
        const cmimiBlerjes = historical?.cmimiBlerjes ?? product.cmimiBlerjes
        const cmimiShitjes = historical?.cmimiShitjes ?? product.cmimiShitjes

        const lineFitimi = (cmimiShitjes - cmimiBlerjes) * qty.value
        totali += cmimiShitjes * qty.value
        fitimi += lineFitimi

        itemData.push({
          productId: product.id,
          emriProduktit: product.emri,
          sasia: qty.value,
          cmimiBlerjes,
          cmimiShitjes,
          fitimi: lineFitimi,
        })
      }

      await tx.saleItem.deleteMany({ where: { saleId } })

      // Same atomic guard as the create path: stock cannot go below zero.
      for (const item of itemData) {
        if (untracked.has(item.productId)) continue
        const updated = await tx.product.updateMany({
          where: { id: item.productId, sasia: { gte: item.sasia } },
          data: { sasia: { decrement: item.sasia } },
        })
        if (updated.count !== 1) {
          const current = await tx.product.findUnique({ where: { id: item.productId } })
          throw new ApiFailure(
            `Stoku i pamjaftueshëm për: ${item.emriProduktit}. Disponibël: ${current?.sasia ?? 0}`,
            409,
            'INSUFFICIENT_STOCK'
          )
        }
      }

      await tx.sale.update({
        where: { id: saleId },
        data: {
          totali,
          fitimi,
          items: { create: itemData },
        },
      })
    })

    const updatedSale = await prisma.sale.findUnique({
      where: { id: saleId },
      include: { items: { include: { product: true } } },
    })

    scheduleSnapshot()
    return NextResponse.json(updatedSale)
  } catch (error) {
    return handleApiError(error, 'Sale PUT')
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { error } = await requireRole(['admin'])
  if (error) return error

  try {
    const saleId = parseId(params.id)
    if (saleId === null) return badRequest('ID i pavlefshëm')

    const sale = await prisma.sale.findUnique({
      where: { id: saleId },
      include: { items: { include: { product: { select: { njesia: true } } } } },
    })
    if (!sale) return notFound('Fatura nuk u gjet')

    await prisma.$transaction(async (tx) => {
      for (const item of sale.items) {
        if (!tracksStock(item.product.njesia)) continue
        await tx.product.update({
          where: { id: item.productId },
          data: { sasia: { increment: item.sasia } },
        })
      }
      await tx.sale.delete({ where: { id: saleId } })
    })

    scheduleSnapshot()
    return success()
  } catch (error) {
    return handleApiError(error, 'Sale DELETE')
  }
}
