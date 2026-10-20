import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/auth-helpers'
import { badRequest, conflict, handleApiError, notFound, parseId } from '@/lib/api'
import { Role } from '@/lib/roles'
import { scheduleSnapshot } from '@/lib/backups/snapshot'

const VALID_ROLES: Role[] = ['admin', 'cashier', 'staff']

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { error } = await requireRole(['admin'])
  if (error) return error

  try {
    const id = parseId(params.id)
    if (id === null) return badRequest('ID i pavlefshëm')

    const body = await req.json()
    const { roli } = body

    if (!VALID_ROLES.includes(roli)) {
      return badRequest('Rol i pavlefshëm')
    }

    const target = await prisma.userRole.findUnique({ where: { id } })
    if (!target) return notFound('Përdoruesi nuk u gjet')

    // Demoting the last admin would leave nobody able to reach /perdoruesit,
    // and there is no create-user endpoint to recover through.
    if (target.roli === 'admin' && roli !== 'admin') {
      const adminCount = await prisma.userRole.count({ where: { roli: 'admin' } })
      if (adminCount <= 1) {
        return conflict(
          'Ky është administratori i fundit. Cakto një admin tjetër përpara se të ndryshosh këtë rol.'
        )
      }
    }

    const userRole = await prisma.userRole.update({
      where: { id },
      data: { roli },
    })

    scheduleSnapshot()
    return NextResponse.json(userRole)
  } catch (error) {
    return handleApiError(error, 'User PUT')
  }
}
