import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/auth-helpers'
import { badRequest, handleApiError, parseId, success } from '@/lib/api'
import { scheduleSnapshot } from '@/lib/backups/snapshot'

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { error } = await requireRole(['admin', 'staff'])
  if (error) return error

  try {
    const id = parseId(params.id)
    if (id === null) return badRequest('ID i pavlefshëm')

    const body = await req.json()
    const { emri, telefoni, email, adresa, shenime } = body

    if (!emri || typeof emri !== 'string' || !emri.trim()) {
      return badRequest('Emri i furnitorit është i detyrueshëm')
    }

    const supplier = await prisma.supplier.update({
      where: { id },
      data: {
        emri: emri.trim(),
        telefoni: telefoni || null,
        email: email || null,
        adresa: adresa || null,
        shenime: shenime || null,
      },
      include: { products: { select: { id: true, emri: true } } },
    })

    scheduleSnapshot()
    return NextResponse.json(supplier)
  } catch (error) {
    return handleApiError(error, 'Supplier PUT')
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { error } = await requireRole(['admin', 'staff'])
  if (error) return error

  try {
    const id = parseId(params.id)
    if (id === null) return badRequest('ID i pavlefshëm')

    await prisma.supplier.delete({ where: { id } })
    scheduleSnapshot()
    return success()
  } catch (error) {
    return handleApiError(error, 'Supplier DELETE')
  }
}
