import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/auth-helpers'
import { ApiFailure, badRequest, handleApiError, parseId, success } from '@/lib/api'
import { scheduleSnapshot } from '@/lib/backups/snapshot'

/**
 * Deletes a whole personal-use registration and puts every line's stock back.
 *
 * The lines go with it through the FK's ON DELETE CASCADE, but stock has to be
 * returned explicitly first — the cascade only removes rows, it knows nothing
 * about the stock those rows took out.
 */
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
      const entry = await tx.personalUseEntry.findUnique({
        where: { id },
        include: { items: true },
      })
      if (!entry) throw new ApiFailure('Regjistrimi nuk u gjet', 404, 'NOT_FOUND')

      for (const item of entry.items) {
        await tx.product.update({
          where: { id: item.productId },
          data: { sasia: { increment: item.sasia } },
        })
      }

      // Cascade removes the lines.
      await tx.personalUseEntry.delete({ where: { id } })
    })

    scheduleSnapshot()
    return success()
  } catch (error) {
    return handleApiError(error, 'PersonalUse DELETE')
  }
}
