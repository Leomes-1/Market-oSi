import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/auth-helpers'
import { badRequest, handleApiError } from '@/lib/api'
import { tracksStock, UNTRACKED_STOCK_UNITS } from '@/lib/validation'
import { invoicedValue } from '@/lib/inventari'

export const dynamic = 'force-dynamic'

/**
 * "Me faturë" summary for one month (?muaji=2026-11) or one year (?viti=2026),
 * in Albanian calendar time. Admin only.
 *
 *   faturat    "Me TVSH" supplies dated in the period, with their lines
 *   produktet  per product: invoiced units bought, invoiced units sold and
 *              their revenue, invoiced units taken for personal use, and
 *              invoiced stock at the end of the period
 *
 * Dates: a supply counts on its delivery date (`data`), a sale when it was
 * made, personal use on its own date.
 *
 * Invoiced stock at the end of a past period is worked back from today's:
 * add back what was sold or used from it since, take away what "Me TVSH"
 * supplies brought since. A hand correction of stock below the invoiced stock
 * isn't recorded anywhere, so it counts as if it had always applied.
 */

const TZ = 'Europe/Tirane'

/** Minutes east of UTC in Albania at `at` (60 in winter, 120 in summer). */
function tiraneOffsetMinutes(at: Date): number {
  const name =
    new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'shortOffset' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT'
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name)
  if (!m) return 0
  const minutes = Number(m[2]) * 60 + Number(m[3] ?? 0)
  return m[1] === '-' ? -minutes : minutes
}

/**
 * Midnight at the start of month `month` (1-based; 13 rolls into the next
 * year) in Albania, as an instant. Clocks change at 02:00/03:00 on a last
 * Sunday, never on the 1st, so the offset at 00:00 UTC that day is the one
 * in force at local midnight.
 */
function tiraneMonthStart(year: number, month: number): Date {
  const utc = Date.UTC(year, month - 1, 1)
  return new Date(utc - tiraneOffsetMinutes(new Date(utc)) * 60_000)
}

function parsePeriod(params: URLSearchParams) {
  const muaji = params.get('muaji')
  const viti = params.get('viti')
  if (muaji) {
    const m = /^(\d{4})-(\d{2})$/.exec(muaji)
    const year = m ? Number(m[1]) : NaN
    const month = m ? Number(m[2]) : NaN
    if (!(year >= 2000 && year <= 2100 && month >= 1 && month <= 12)) return null
    return {
      lloji: 'muaj' as const,
      label: muaji,
      nga: tiraneMonthStart(year, month),
      deri: tiraneMonthStart(year, month + 1),
    }
  }
  if (viti) {
    const year = /^\d{4}$/.test(viti) ? Number(viti) : NaN
    if (!(year >= 2000 && year <= 2100)) return null
    return {
      lloji: 'vit' as const,
      label: viti,
      nga: tiraneMonthStart(year, 1),
      deri: tiraneMonthStart(year + 1, 1),
    }
  }
  return null
}

interface Movement {
  productId: number
  /** In the period. */
  njesi: number
  vlera: number
  /** After the period ended — used to work back the end-of-period stock. */
  pas: number
}

export async function GET(req: NextRequest) {
  const { error } = await requireRole(['admin'])
  if (error) return error

  try {
    const period = parsePeriod(new URL(req.url).searchParams)
    if (!period) return badRequest('Zgjidh një muaj (VVVV-MM) ose një vit (VVVV)')

    // Timestamps are stored as UTC wall time without a zone, like every
    // Prisma DateTime here.
    const nga = period.nga.toISOString()
    const deri = period.deri.toISOString()
    const untracked = [...UNTRACKED_STOCK_UNITS] as string[]

    const [faturat, blerje, shitje, vetjak, products] = await Promise.all([
      prisma.supply.findMany({
        where: { meTvsh: true, data: { gte: period.nga, lt: period.deri } },
        include: {
          furnitor: { select: { emri: true } },
          items: {
            orderBy: { id: 'asc' },
            include: { product: { select: { kategoria: true } } },
          },
        },
        orderBy: [{ data: 'asc' }, { id: 'asc' }],
      }),
      // Invoiced units bought. kg lines count as purchases but never as stock.
      prisma.$queryRaw<Movement[]>`
        SELECT i."productId",
               COALESCE(SUM(i.sasia)  FILTER (WHERE s.data < (${deri}::timestamptz AT TIME ZONE 'UTC')), 0) AS njesi,
               COALESCE(SUM(i.totali) FILTER (WHERE s.data < (${deri}::timestamptz AT TIME ZONE 'UTC')), 0) AS vlera,
               COALESCE(SUM(i.sasia)  FILTER (WHERE s.data >= (${deri}::timestamptz AT TIME ZONE 'UTC')
                                                AND i.njesia <> ALL(${untracked})), 0) AS pas
          FROM "SupplyItem" i
          JOIN "Supply" s ON s.id = i."supplyId"
         WHERE s."meTvsh"
           AND s.data >= (${nga}::timestamptz AT TIME ZONE 'UTC')
         GROUP BY i."productId"
      `,
      // Invoiced units sold, and the revenue of those units.
      prisma.$queryRaw<Movement[]>`
        SELECT si."productId",
               COALESCE(SUM(si."sasiaFaturuar") FILTER (WHERE s."createdAt" < (${deri}::timestamptz AT TIME ZONE 'UTC')), 0) AS njesi,
               COALESCE(SUM(si."sasiaFaturuar" * si."cmimiShitjes")
                        FILTER (WHERE s."createdAt" < (${deri}::timestamptz AT TIME ZONE 'UTC')), 0) AS vlera,
               COALESCE(SUM(si."sasiaFaturuar") FILTER (WHERE s."createdAt" >= (${deri}::timestamptz AT TIME ZONE 'UTC')), 0) AS pas
          FROM "SaleItem" si
          JOIN "Sale" s ON s.id = si."saleId"
         WHERE si."sasiaFaturuar" > 0
           AND s."createdAt" >= (${nga}::timestamptz AT TIME ZONE 'UTC')
         GROUP BY si."productId"
      `,
      // Invoiced units taken for personal use, at cost.
      prisma.$queryRaw<Movement[]>`
        SELECT pu."productId",
               COALESCE(SUM(pu."sasiaFaturuar") FILTER (WHERE e.data < (${deri}::timestamptz AT TIME ZONE 'UTC')), 0) AS njesi,
               COALESCE(SUM(pu."sasiaFaturuar" * pu."cmimiBlerjes")
                        FILTER (WHERE e.data < (${deri}::timestamptz AT TIME ZONE 'UTC')), 0) AS vlera,
               COALESCE(SUM(pu."sasiaFaturuar") FILTER (WHERE e.data >= (${deri}::timestamptz AT TIME ZONE 'UTC')), 0) AS pas
          FROM "PersonalUse" pu
          JOIN "PersonalUseEntry" e ON e.id = pu."entryId"
         WHERE pu."sasiaFaturuar" > 0
           AND e.data >= (${nga}::timestamptz AT TIME ZONE 'UTC')
         GROUP BY pu."productId"
      `,
      prisma.product.findMany({
        select: {
          id: true,
          emri: true,
          kategoria: true,
          njesia: true,
          sasia: true,
          sasiaFaturuar: true,
          cmimiBlerjes: true,
          cmimiShitjes: true,
          cmimiBlerjesRi: true,
          cmimiShitjesRi: true,
          sasiaVjeter: true,
        },
      }),
    ])

    const byId = (rows: Movement[]) => new Map(rows.map((r) => [r.productId, r]))
    const b = byId(blerje)
    const sh = byId(shitje)
    const v = byId(vetjak)

    const produktet = products
      .map((p) => {
        const tracked = tracksStock(p.njesia)
        const bl = b.get(p.id)
        const s = sh.get(p.id)
        const u = v.get(p.id)
        const stokFund = tracked
          ? Math.max(0, p.sasiaFaturuar - (bl?.pas ?? 0) + (s?.pas ?? 0) + (u?.pas ?? 0))
          : 0
        return {
          productId: p.id,
          emri: p.emri,
          kategoria: p.kategoria,
          njesia: p.njesia,
          tracked,
          bleraNjesi: bl?.njesi ?? 0,
          bleraVlera: bl?.vlera ?? 0,
          shituraNjesi: s?.njesi ?? 0,
          shituraTeArdhura: s?.vlera ?? 0,
          vetjakNjesi: u?.njesi ?? 0,
          vetjakKosto: u?.vlera ?? 0,
          stokFundNjesi: Number(stokFund.toFixed(3)),
          // At today's purchase prices: past prices per unit aren't kept.
          stokFundVlera: invoicedValue(p, stokFund),
        }
      })
      .filter(
        (r) =>
          r.bleraNjesi > 0 || r.shituraNjesi > 0 || r.vetjakNjesi > 0 || r.stokFundNjesi > 0
      )
      .sort((a, b) => a.kategoria.localeCompare(b.kategoria) || a.emri.localeCompare(b.emri))

    return NextResponse.json({
      periudha: {
        lloji: period.lloji,
        label: period.label,
        nga: period.nga.toISOString(),
        deri: period.deri.toISOString(),
      },
      faturat: faturat.map((f) => ({
        id: f.id,
        data: f.data,
        nrFatures: f.nrFatures,
        furnitor: f.furnitor?.emri ?? null,
        totali: f.totali,
        items: f.items.map((i) => ({
          productId: i.productId,
          emriProduktit: i.emriProduktit,
          kategoria: i.product.kategoria,
          sasia: i.sasia,
          njesia: i.njesia,
          cmimiBlerjes: i.cmimiBlerjes,
          totali: i.totali,
        })),
      })),
      produktet,
    })
  } catch (error) {
    return handleApiError(error, 'Inventari permbledhje GET')
  }
}
