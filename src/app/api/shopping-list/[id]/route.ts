import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/auth-helpers'
import { badRequest, handleApiError, notFound, parseId, success } from '@/lib/api'
import { scheduleSnapshot } from '@/lib/backups/snapshot'
import { checkListName, checkListPrice, checkListQuantity } from '@/lib/shopping-list'
import { LIST_SELECT, toListLine } from '@/lib/shopping-list-server'

export const dynamic = 'force-dynamic'

/**
 * One line of the shopping list.
 *
 *   PATCH   { sasia?, cmimiBlerjes?, blere?, emri? }  (emri: free-text lines only)
 *   DELETE  remove the line
 *
 * The price is the list's own: nothing here writes to Product.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { error } = await requireRole(['admin', 'staff'])
  if (error) return error

  try {
    const id = parseId(params.id)
    if (id === null) return badRequest('ID i pavlefshëm')

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return badRequest('Kërkesë e pavlefshme')

    const current = await prisma.shoppingListItem.findUnique({
      where: { id },
      select: { productId: true, njesia: true, product: { select: { njesia: true } } },
    })
    if (!current) return notFound('Rreshti nuk ekziston më në listë')
    const freeText = current.productId === null
    const njesia = current.product?.njesia ?? current.njesia

    const data: { sasia?: number; cmimiBlerjes?: number; blere?: boolean; emri?: string } = {}
    if (body.sasia !== undefined) {
      const sasia = checkListQuantity(body.sasia, njesia, freeText)
      if (!sasia.ok) return badRequest(sasia.error)
      data.sasia = sasia.value
    }
    if (body.cmimiBlerjes !== undefined) {
      const cmimi = checkListPrice(body.cmimiBlerjes)
      if (!cmimi.ok) return badRequest(cmimi.error)
      data.cmimiBlerjes = cmimi.value
    }
    if (body.blere !== undefined) {
      if (typeof body.blere !== 'boolean') return badRequest('Vlerë e pavlefshme për "blerë"')
      data.blere = body.blere
    }
    if (body.emri !== undefined) {
      if (!freeText) return badRequest('Emri i një produkti ndryshohet te Produktet')
      const emri = checkListName(body.emri)
      if (!emri.ok) return badRequest(emri.error)
      data.emri = emri.value
    }
    if (Object.keys(data).length === 0) return badRequest('Asgjë për të ndryshuar')

    const line = await prisma.shoppingListItem.update({ where: { id }, data, select: LIST_SELECT })
    scheduleSnapshot()
    return NextResponse.json(toListLine(line))
  } catch (error) {
    return handleApiError(error, 'Shopping list PATCH')
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { error } = await requireRole(['admin', 'staff'])
  if (error) return error

  try {
    const id = parseId(params.id)
    if (id === null) return badRequest('ID i pavlefshëm')

    // Already gone (removed on the other device) is the outcome asked for.
    await prisma.shoppingListItem.deleteMany({ where: { id } })
    scheduleSnapshot()
    return success()
  } catch (error) {
    return handleApiError(error, 'Shopping list line DELETE')
  }
}
