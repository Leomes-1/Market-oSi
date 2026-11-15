import type { Prisma } from '@prisma/client'
import { tracksStock } from './validation'
import type { ShoppingListLine } from './shopping-list'

/** What every shopping-list query selects, so all routes answer alike. */
export const LIST_SELECT = {
  id: true,
  productId: true,
  emri: true,
  njesia: true,
  sasia: true,
  cmimiBlerjes: true,
  blere: true,
  product: { select: { emri: true, njesia: true, sasia: true } },
} satisfies Prisma.ShoppingListItemSelect

type ListRow = Prisma.ShoppingListItemGetPayload<{ select: typeof LIST_SELECT }>

/**
 * A catalogue line shows the product's current name and unit (renamed since
 * it was added, it follows); a free-text line shows what was typed.
 */
export function toListLine(row: ListRow): ShoppingListLine {
  const njesia = row.product?.njesia ?? row.njesia
  return {
    id: row.id,
    productId: row.productId,
    emri: row.product?.emri ?? row.emri,
    njesia,
    sasia: row.sasia,
    cmimiBlerjes: row.cmimiBlerjes,
    blere: row.blere,
    stoku: row.product && tracksStock(njesia) ? row.product.sasia : null,
  }
}
