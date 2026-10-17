import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/auth-helpers'
import { ApiFailure, badRequest, handleApiError, parseId, success } from '@/lib/api'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { error } = await requireRole(['admin'])
  if (error) return error

  try {
    const id = parseId(params.id)
    if (id === null) return badRequest('ID i pavlefshëm')

    await prisma.$transaction(async (tx) => {
      const entry = await tx.personalUse.findUnique({ where: { id } })
      if (!entry) throw new ApiFailure('Regjistrimi nuk u gjet', 404, 'NOT_FOUND')

      // Deleting an entry puts the stock back.
      await tx.product.update({
        where: { id: entry.productId },
        data: { sasia: { increment: entry.sasia } },
      })
      await tx.personalUse.delete({ where: { id } })
    })

    return success()
  } catch (error) {
    return handleApiError(error, 'PersonalUse DELETE')
  }
}
