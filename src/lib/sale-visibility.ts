import { Role } from './roles'

/**
 * Profit and cost are admin-only information. Hiding the columns in the UI is
 * not enough — a cashier could read the figures straight out of the network
 * response — so they are stripped from the payload here, server-side.
 *
 * Fields removed for non-admins:
 *   Sale.fitimi, SaleItem.fitimi, SaleItem.cmimiBlerjes,
 *   SaleItem.sasiaFaturuar (invoiced split — Inventari is admin-only)
 *
 * A product joined onto a line (`item.product`) is reduced to a whitelist —
 * the fields the POS and Historiku actually read — rather than stripped of a
 * blacklist, so a cost column added to Product later can't leak through it.
 */

interface SaleItemLike {
  fitimi: number
  cmimiBlerjes: number
  product?: Record<string, unknown> | null
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

/**
 * Product fields a non-admin may receive on a sale line: what the POS needs to
 * patch its cached catalogue after a sale (stock, sale prices, the pending
 * sale price and its counter) and what Historiku shows (unit, stock).
 */
const SALE_PRODUCT_FIELDS = [
  'id',
  'emri',
  'njesia',
  'sasia',
  'cmimiShitjes',
  'cmimiShitjesRi',
  'sasiaVjeter',
] as const

function publicProduct(product: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of SALE_PRODUCT_FIELDS) {
    if (key in product) out[key] = product[key]
  }
  return out
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
            const {
              fitimi: _itemFitimi,
              cmimiBlerjes: _cost,
              sasiaFaturuar: _invoiced,
              product,
              ...itemRest
            } = item
            return {
              ...itemRest,
              ...(product !== undefined
                ? { product: product === null ? null : publicProduct(product) }
                : {}),
            }
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

/**
 * A full Product row for a non-admin. Cashiers lose every cost figure; staff
 * keep the purchase price (they maintain the catalogue and enter supplies)
 * but not the invoiced-stock counter, which is Inventari data.
 */
export function productForRole<T extends Record<string, unknown>>(
  product: T,
  role: Role | null
): Record<string, unknown> {
  if (role === 'admin') return product
  const {
    cmimiBlerjes: _cost,
    cmimiBlerjesRi: _pendingCost,
    sasiaFaturuar: _invoiced,
    ...rest
  } = product
  if (role === 'staff') {
    return {
      ...rest,
      ...('cmimiBlerjes' in product ? { cmimiBlerjes: product.cmimiBlerjes } : {}),
      ...('cmimiBlerjesRi' in product ? { cmimiBlerjesRi: product.cmimiBlerjesRi } : {}),
    }
  }
  return rest
}
