import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/auth-helpers'
import { badRequest, handleApiError } from '@/lib/api'
import { scheduleSnapshot } from '@/lib/backups/snapshot'

export async function GET() {
  // Staff manage suppliers from /furnitoret, and the products, supplies and
  // reorder pages all need this list for their dropdowns.
  const { error } = await requireRole(['admin', 'staff'])
  if (error) return error

  try {
    const suppliers = await prisma.supplier.findMany({
      include: {
        products: { select: { id: true, emri: true } },
      },
      orderBy: { emri: 'asc' },
    })
    return NextResponse.json(suppliers)
  } catch (error) {
    return handleApiError(error, 'Suppliers GET')
  }
}

export async function POST(req: NextRequest) {
  const { error } = await requireRole(['admin', 'staff'])
  if (error) return error

  try {
    const body = await req.json()
    const { emri, telefoni, email, adresa, shenime } = body

    if (!emri || typeof emri !== 'string' || !emri.trim()) {
      return badRequest('Emri i furnitorit është i detyrueshëm')
    }

    const supplier = await prisma.supplier.create({
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
    return NextResponse.json(supplier, { status: 201 })
  } catch (error) {
    return handleApiError(error, 'Suppliers POST')
  }
}
