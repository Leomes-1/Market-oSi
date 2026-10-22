import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/auth-helpers'
import { ApiFailure, badRequest, handleApiError } from '@/lib/api'
import { tracksStock, validateQuantity, weightForAmount } from '@/lib/validation'
import { applyConsumptionLocked, priceConsumption, takeAndLock } from '@/lib/pricing'
import { stripProfitFromSales } from '@/lib/sale-visibility'
import { scheduleSnapshot } from '@/lib/backups/snapshot'

export async function GET(req: NextRequest) {
  const { role, error } = await requireRole(['admin', 'cashier'])
  if (error) return error

  try {
    const { searchParams } = new URL(req.url)
    const periudha = searchParams.get('periudha') || 'sot'

    const now = new Date()
    let dateFrom: Date
    let dateTo: Date | undefined

    switch (periudha) {
      case 'sot':
        dateFrom = new Date(now)
        dateFrom.setHours(0, 0, 0, 0)
        break
      case 'dje':
        dateFrom = new Date(now)
        dateFrom.setDate(dateFrom.getDate() - 1)
        dateFrom.setHours(0, 0, 0, 0)
        dateTo = new Date(dateFrom)
        dateTo.setDate(dateTo.getDate() + 1)
        break
      case 'jave':
        dateFrom = new Date(now)
        dateFrom.setDate(dateFrom.getDate() - 7)
        dateFrom.setHours(0, 0, 0, 0)
        break
      case 'muaj':
        dateFrom = new Date(now)
        dateFrom.setDate(1)
        dateFrom.setHours(0, 0, 0, 0)
        break
      default:
        dateFrom = new Date(now)
        dateFrom.setHours(0, 0, 0, 0)
    }

    const sales = await prisma.sale.findMany({
      where: {
        createdAt: dateTo ? { gte: dateFrom, lt: dateTo } : { gte: dateFrom },
      },
      include: { items: { include: { product: true } } },
      orderBy: { createdAt: 'desc' },
    })

    // Cashiers never receive profit or cost figures, not even in the payload.
    return NextResponse.json(stripProfitFromSales(sales, role))
  } catch (error) {
    return handleApiError(error, 'Sales GET')
  }
}

interface IncomingItem {
  productId: number
  /** Quantity; null on an amount line. */
  sasia: number | null
  /** Amount in Lek, sent instead of `sasia` for untracked (kg) products. */
  shuma: number | null
}

/**
 * Collapses repeated productIds, summing quantities and amounts separately,
 * so the stock check sees the full quantity of a product listed twice.
 */
function mergeLines(items: IncomingItem[]): IncomingItem[] {
  const sum = (a: number | null, b: number | null) =>
    a === null ? b : b === null ? a : Number((a + b).toFixed(3))
  const merged = new Map<number, IncomingItem>()
  for (const item of items) {
    const existing = merged.get(item.productId)
    if (existing) {
      existing.sasia = sum(existing.sasia, item.sasia)
      existing.shuma = sum(existing.shuma, item.shuma)
    } else {
      merged.set(item.productId, { ...item })
    }
  }
  return Array.from(merged.values())
}

export async function POST(req: NextRequest) {
  const { error } = await requireRole(['admin', 'cashier'])
  if (error) return error

  try {
    const body = await req.json()
    const { items, shenime } = body

    if (!Array.isArray(items) || items.length === 0) {
      return badRequest('Nuk ka produkte në shitje')
    }

    // Normalise the incoming lines before touching the database. Prices are
    // deliberately ignored here — they are always read from the product.
    const rawLines: IncomingItem[] = []
    for (const item of items) {
      const productId = Number(item?.productId)
      if (!Number.isInteger(productId) || productId <= 0) {
        return badRequest('Produkt i pavlefshëm në shitje')
      }
      const hasShuma = item?.shuma !== undefined && item?.shuma !== null
      const shuma = hasShuma ? Number(item.shuma) : null
      if (shuma !== null && (!Number.isFinite(shuma) || shuma <= 0)) {
        return badRequest('Shuma e pavlefshme në shitje')
      }
      const sasia = shuma === null ? Number(item?.sasia) : null
      if (sasia !== null && !Number.isFinite(sasia)) {
        return badRequest('Sasi e pavlefshme në shitje')
      }
      rawLines.push({ productId, sasia, shuma })
    }

    // The same product listed twice is one line, so the stock check sees the
    // full quantity instead of each line passing against the same stock.
    const lines = mergeLines(rawLines)

    const sale = await prisma.$transaction(async (tx) => {
      const products = await tx.product.findMany({
        where: { id: { in: lines.map((l) => l.productId) } },
      })
      const byId = new Map(products.map((p) => [p.id, p]))

      // Validate every line before touching stock, so a bad line fails the
      // whole sale rather than half-applying it.
      const validated: Array<{
        productId: number
        emri: string
        sasia: number
        tracked: boolean
        shuma: number | null
      }> = []
      for (const line of lines) {
        const product = byId.get(line.productId)
        if (!product) {
          throw new ApiFailure(`Produkti nuk u gjet (id ${line.productId})`, 404, 'NOT_FOUND')
        }
        const tracked = tracksStock(product.njesia)

        // An amount line is only meaningful for an untracked product, and
        // cannot be mixed with a quantity line for the same product.
        if (line.shuma !== null) {
          if (tracked || line.sasia !== null) {
            throw new ApiFailure(`Shuma nuk lejohet për: ${product.emri}`, 400, 'VALIDATION')
          }
          // Weighed at the price the till showed: the current (old, while a
          // change is pending) sale price per unit.
          const sasia = weightForAmount(line.shuma, product.cmimiShitjes)
          if (sasia === null) {
            throw new ApiFailure(`Shuma shumë e vogël për: ${product.emri}`, 400, 'VALIDATION')
          }
          validated.push({ productId: product.id, emri: product.emri, sasia, tracked, shuma: line.shuma })
          continue
        }

        const qty = validateQuantity(line.sasia, product.njesia, product.emri)
        if (!qty.ok) {
          throw new ApiFailure(qty.error, 400, 'VALIDATION')
        }
        validated.push({ productId: product.id, emri: product.emri, sasia: qty.value, tracked, shuma: null })
      }

      let totali = 0
      let fitimi = 0
      const itemData: Array<{
        productId: number
        emriProduktit: string
        sasia: number
        cmimiBlerjes: number
        cmimiShitjes: number
        fitimi: number
      }> = []

      for (const line of validated) {
        // One statement: for tracked stock the conditional decrement (the
        // `sasia >= n` guard and the write are atomic, so two tills selling the
        // last unit cannot both succeed and stock can never go below zero);
        // for kg lines a plain row lock. Either way it returns the row as
        // committed under the lock — prices and pending-change counters are
        // the current values, not what a concurrent sale saw earlier.
        const locked = await takeAndLock(tx, line.productId, line.sasia, line.tracked)
        if (!locked) {
          // Only a tracked line can miss: the guard found too little stock.
          const current = byId.get(line.productId)
          throw new ApiFailure(
            `Stoku i pamjaftueshëm për: ${line.emri}. Stoku: ${current?.sasia ?? 0}`,
            409,
            'INSUFFICIENT_STOCK'
          )
        }

        const pricing = priceConsumption(locked, line.sasia)
        // Skipped entirely when no price change is pending.
        await applyConsumptionLocked(tx, locked, line.sasia)

        // An amount line charges exactly what was typed. The stored unit price
        // is the effective one (amount ÷ weight), so every place that shows
        // `cmimiShitjes × sasia` — receipts, history, edits — still lands on
        // that amount, and the profit is amount − weight × cost.
        const lineTotali = line.shuma ?? pricing.cmimiShitjes * line.sasia
        const cmimiShitjes = line.shuma !== null ? line.shuma / line.sasia : pricing.cmimiShitjes
        const lineFitimi = lineTotali - pricing.cmimiBlerjes * line.sasia
        totali += lineTotali
        fitimi += lineFitimi

        itemData.push({
          productId: line.productId,
          emriProduktit: line.emri,
          sasia: line.sasia,
          cmimiBlerjes: pricing.cmimiBlerjes,
          cmimiShitjes,
          fitimi: lineFitimi,
        })
      }

      // Three statements instead of one INSERT per line plus three reads:
      // the header, all lines in one INSERT … RETURNING, and the products as
      // they now stand. Assembled into the same shape as
      // `include: { items: { include: { product: true } } }` returned.
      const header = await tx.sale.create({
        data: {
          totali,
          fitimi,
          shenime: typeof shenime === 'string' && shenime.trim() ? shenime.trim() : null,
        },
      })
      const items = await tx.saleItem.createManyAndReturn({
        data: itemData.map((item) => ({ ...item, saleId: header.id })),
      })
      const after = new Map(
        (await tx.product.findMany({ where: { id: { in: itemData.map((i) => i.productId) } } })).map(
          (p) => [p.id, p]
        )
      )

      return {
        ...header,
        items: items.map((item) => ({ ...item, product: after.get(item.productId)! })),
      }
    })

    scheduleSnapshot()
    return NextResponse.json(sale, { status: 201 })
  } catch (error) {
    return handleApiError(error, 'Sales POST')
  }
}
