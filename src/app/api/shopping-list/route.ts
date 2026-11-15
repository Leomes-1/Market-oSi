import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/auth-helpers'
import { badRequest, handleApiError, notFound, success } from '@/lib/api'
import { scheduleSnapshot } from '@/lib/backups/snapshot'
import { checkListName, checkListPrice, checkListQuantity } from '@/lib/shopping-list'
import { LIST_SELECT, toListLine } from '@/lib/shopping-list-server'

export const dynamic = 'force-dynamic'

/**
 * Lista e blerjeve — one list for the whole shop, admin and staff.
 *
 *   GET     every line, in the order added
 *   POST    { productId }                 add a product, or +1 if it is listed
 *           { emri, sasia, cmimiBlerjes } add a free-text line
 *   DELETE  clear the list; ?bought=<ids> removes only those lines still ticked
 */

export async function GET() {
  const { error } = await requireRole(['admin', 'staff'])
  if (error) return error

  try {
    const rows = await prisma.shoppingListItem.findMany({
      select: LIST_SELECT,
      orderBy: { id: 'asc' },
    })
    return NextResponse.json({ items: rows.map(toListLine) })
  } catch (error) {
    return handleApiError(error, 'Shopping list GET')
  }
}

export async function POST(req: NextRequest) {
  const { error } = await requireRole(['admin', 'staff'])
  if (error) return error

  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return badRequest('Kërkesë e pavlefshme')

    let id: number

    if (body.productId !== undefined && body.productId !== null) {
      const productId = Number(body.productId)
      if (!Number.isInteger(productId) || productId <= 0) return badRequest('Produkt i pavlefshëm')

      // One statement, so two devices scanning the same product at once both
      // count: the unique index on productId turns the second insert into +1.
      // Name, unit and price come from the product as it is now.
      const rows = await prisma.$queryRaw<{ id: number }[]>`
        INSERT INTO "ShoppingListItem" ("productId", "emri", "njesia", "sasia", "cmimiBlerjes", "updatedAt")
        SELECT p."id", p."emri", p."njesia", 1, GREATEST(p."cmimiBlerjes", 0), now()
        FROM "Product" p
        WHERE p."id" = ${productId}
        ON CONFLICT ("productId") DO UPDATE
          SET "sasia" = "ShoppingListItem"."sasia" + 1, "updatedAt" = now()
        RETURNING "id"`
      if (rows.length === 0) return notFound('Produkti nuk u gjet')
      id = rows[0].id
    } else {
      const emri = checkListName(body.emri)
      if (!emri.ok) return badRequest(emri.error)
      const sasia = checkListQuantity(body.sasia ?? 1, 'cope', true)
      if (!sasia.ok) return badRequest(sasia.error)
      const cmimi = checkListPrice(body.cmimiBlerjes ?? 0)
      if (!cmimi.ok) return badRequest(cmimi.error)

      const row = await prisma.shoppingListItem.create({
        data: { emri: emri.value, sasia: sasia.value, cmimiBlerjes: cmimi.value },
        select: { id: true },
      })
      id = row.id
    }

    const line = await prisma.shoppingListItem.findUniqueOrThrow({
      where: { id },
      select: LIST_SELECT,
    })
    scheduleSnapshot()
    return NextResponse.json(toListLine(line))
  } catch (error) {
    return handleApiError(error, 'Shopping list POST')
  }
}

export async function DELETE(req: NextRequest) {
  const { error } = await requireRole(['admin', 'staff'])
  if (error) return error

  try {
    // ?bought=1,2,3 — after a supply: remove these lines, but only those still
    // ticked (one unticked on the other device meanwhile stays). No query:
    // clear the whole list.
    const raw = new URL(req.url).searchParams.get('bought')
    if (raw !== null) {
      const ids = raw.split(',').map(Number)
      if (ids.length > 500 || ids.some((id) => !Number.isInteger(id) || id <= 0)) {
        return badRequest('Lista e rreshtave është e pavlefshme')
      }
      const { count } = await prisma.shoppingListItem.deleteMany({
        where: { id: { in: ids }, blere: true },
      })
      scheduleSnapshot()
      return NextResponse.json({ success: true, removed: count })
    }

    await prisma.shoppingListItem.deleteMany({})
    scheduleSnapshot()
    return success()
  } catch (error) {
    return handleApiError(error, 'Shopping list DELETE')
  }
}
