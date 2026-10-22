import type { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { UNTRACKED_STOCK_UNITS } from './validation'

/**
 * `isLowStock` (lib/utils) as a database filter, so low-stock lists are
 * filtered in SQL instead of loading every product to filter in JS.
 *
 * Same rule: stock at or below its minimum, and only for units whose stock
 * is counted — an untracked unit (kg) is never low.
 */
export function lowStockWhere(): Prisma.ProductWhereInput {
  return {
    sasia: { lte: prisma.product.fields.stokuMinimal },
    njesia: { notIn: [...UNTRACKED_STOCK_UNITS] },
  }
}
