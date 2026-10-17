import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/auth-helpers'
import { ApiFailure, badRequest, handleApiError, notFound, parseId, success } from '@/lib/api'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { error } = await requireRole(['admin', 'staff'])
  if (error) return error

  try {
    const id = parseId(params.id)
    if (id === null) return badRequest('ID i pavlefshëm')

    const supply = await prisma.supply.findUnique({
      where: { id },
      include: {
        furnitor: { select: { id: true, emri: true } },
        items: {
          include: { product: { select: { id: true, emri: true, njesia: true } } },
        },
      },
    })

    if (!supply) return notFound('Furnizimi nuk u gjet')

    return NextResponse.json(supply)
  } catch (error) {
    return handleApiError(error, 'Supply GET')
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { error } = await requireRole(['admin', 'staff'])
  if (error) return error

  try {
    const id = parseId(params.id)
    if (id === null) return badRequest('ID i pavlefshëm')

    await prisma.$transaction(async (tx) => {
      const supply = await tx.supply.findUnique({
        where: { id },
        include: { items: true },
      })

      if (!supply) {
        throw new ApiFailure('Furnizimi nuk u gjet', 404, 'NOT_FOUND')
      }

      // Reversing a delivery removes stock that may already have been sold.
      // The conditional guard refuses rather than driving stock negative — the
      // operator is told which product blocks it and can correct the count
      // first. This is how negative stock got into the data before.
      for (const item of supply.items) {
        const updated = await tx.product.updateMany({
          where: { id: item.productId, sasia: { gte: item.sasia } },
          data: { sasia: { decrement: item.sasia } },
        })
        if (updated.count !== 1) {
          const current = await tx.product.findUnique({ where: { id: item.productId } })
          throw new ApiFailure(
            `Nuk mund të fshihet: stoku i "${item.emriProduktit}" është ${current?.sasia ?? 0}, ` +
              `më pak se ${item.sasia} që solli ky furnizim. Korrigjo stokun më parë.`,
            409,
            'INSUFFICIENT_STOCK'
          )
        }
      }

      await tx.supply.delete({ where: { id } })
    })

    return success()
  } catch (error) {
    return handleApiError(error, 'Supply DELETE')
  }
}
