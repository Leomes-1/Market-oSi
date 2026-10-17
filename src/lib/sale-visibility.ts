import { Role } from './roles'

/**
 * Profit and cost are admin-only information. Hiding the columns in the UI is
 * not enough — a cashier could read the figures straight out of the network
 * response — so they are stripped from the payload here, server-side.
 *
 * Fields removed for non-admins:
 *   Sale.fitimi, SaleItem.fitimi, SaleItem.cmimiBlerjes
 */

interface SaleItemLike {
  fitimi: number
  cmimiBlerjes: number
  [key: string]: unknown
}

interface SaleLike {
  fitimi: number
  items?: SaleItemLike[]
  [key: string]: unknown
}

export function canSeeProfit(role: Role | null): boolean {
  return role === 'admin'
}

export function stripProfitFromSale<T extends SaleLike>(
  sale: T,
  role: Role | null
): Record<string, unknown> {
  if (canSeeProfit(role)) return sale

  const { fitimi: _saleFitimi, items, ...rest } = sale

  return {
    ...rest,
    ...(items
      ? {
          items: items.map((item) => {
            const { fitimi: _itemFitimi, cmimiBlerjes: _cost, ...itemRest } = item
            return itemRest
          }),
        }
      : {}),
  }
}

export function stripProfitFromSales<T extends SaleLike>(
  sales: T[],
  role: Role | null
): Array<Record<string, unknown>> {
  if (canSeeProfit(role)) return sales
  return sales.map((sale) => stripProfitFromSale(sale, role))
}
