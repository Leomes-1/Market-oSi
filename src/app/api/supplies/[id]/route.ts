import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/auth-helpers'
import { ApiFailure, badRequest, handleApiError, notFound, parseId, success } from '@/lib/api'
import { tracksStock } from '@/lib/validation'
import { scheduleSnapshot } from '@/lib/backups/snapshot'
import {
  hideInvoiceFields,
  markLineInvoiced,
  parseInvoiceFields,
  removeSupplyLine,
  unmarkLineInvoiced,
} from '@/lib/inventari'

const SUPPLY_INCLUDE = {
  furnitor: { select: { id: true, emri: true } },
  items: {
    include: { product: { select: { id: true, emri: true, njesia: true } } },
  },
} as const

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { role, error } = await requireRole(['admin', 'staff'])
  if (error) return error

  try {
    const id = parseId(params.id)
    if (id === null) return badRequest('ID i pavlefshëm')

    const supply = await prisma.supply.findUnique({ where: { id }, include: SUPPLY_INCLUDE })

    if (!supply) return notFound('Furnizimi nuk u gjet')

    return NextResponse.json(role === 'admin' ? supply : hideInvoiceFields(supply))
  } catch (error) {
    return handleApiError(error, 'Supply GET')
  }
}

/**
 * Edits a supply's "Me TVSH" flag and invoice number (admin only — Inventari
 * data). Ticking it moves the supply's units on the shelf into invoiced
 * stock; unticking takes them out again. Either is refused, with the product
 * named, when the units involved were already sold. kg lines have no stock,
 * so only the flag changes for them.
 */
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
    if (typeof body?.meTvsh !== 'boolean') return badRequest('meTvsh duhet true ose false')
    const invoice = parseInvoiceFields(body)
    if (!invoice.ok) return badRequest(invoice.error)

    const supply = await prisma.$transaction(async (tx) => {
      const existing = await tx.supply.findUnique({
        where: { id },
        include: { items: { include: { product: { select: { njesia: true } } } } },
      })
      if (!existing) throw new ApiFailure('Furnizimi nuk u gjet', 404, 'NOT_FOUND')

      if (existing.meTvsh !== invoice.meTvsh) {
        for (const item of existing.items) {
          if (!tracksStock(item.product.njesia)) continue
          if (invoice.meTvsh) await markLineInvoiced(tx, item)
          else await unmarkLineInvoiced(tx, item)
        }
      }

      return tx.supply.update({
        where: { id },
        data: { meTvsh: invoice.meTvsh, nrFatures: invoice.nrFatures },
        include: SUPPLY_INCLUDE,
      })
    })

    scheduleSnapshot()
    return NextResponse.json(supply)
  } catch (error) {
    return handleApiError(error, 'Supply PUT')
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
        include: { items: { include: { product: { select: { njesia: true } } } } },
      })

      if (!supply) {
        throw new ApiFailure('Furnizimi nuk u gjet', 404, 'NOT_FOUND')
      }

      // Reversing a delivery removes stock that may already have been sold.
      // The conditional guard refuses rather than driving stock negative — the
      // operator is told which product blocks it and can correct the count
      // first. This is how negative stock got into the data before.
      // A "Me TVSH" supply also takes its units out of invoiced stock, and is
      // refused the same way if those were sold.
      // Untracked (kg) products never received stock, so there is none to take.
      for (const item of supply.items) {
        if (!tracksStock(item.product.njesia)) continue
        await removeSupplyLine(tx, item, supply.meTvsh)
      }

      await tx.supply.delete({ where: { id } })
    })

    scheduleSnapshot()
    return success()
  } catch (error) {
    return handleApiError(error, 'Supply DELETE')
  }
}
