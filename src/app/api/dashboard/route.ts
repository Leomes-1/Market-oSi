import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/auth-helpers'
import { handleApiError } from '@/lib/api'
import { lowStockWhere } from '@/lib/low-stock'

export const dynamic = 'force-dynamic'

const MONTH_NAMES = ['Jan', 'Shk', 'Mar', 'Pri', 'Maj', 'Qer', 'Kor', 'Gus', 'Sht', 'Tet', 'Nën', 'Dhj']

/**
 * A JS Date as the UTC wall-clock `timestamp` Prisma stores DateTime columns
 * in, so raw comparisons match Prisma's own whatever the session time zone.
 */
function ts(d: Date) {
  return Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`
}

/** Bucket boundaries for width_bucket(), as the same UTC timestamps. */
function tsArray(ds: Date[]) {
  return Prisma.sql`ARRAY(SELECT unnest(${ds.map((d) => d.toISOString())}::timestamptz[]) AT TIME ZONE 'UTC')`
}

interface SaleSummaryRow {
  periudha_totali: number | null
  periudha_fitimi: number | null
  periudha_numri: number
  periudha_produkte: number | null
  muaji_totali: number | null
  muaji_fitimi: number | null
  sot_totali: number | null
  muaji_kaluar_totali: number | null
  dje_totali: number | null
  /** [{ b: bucket 1–30, shitjet, fitimi }] — one per day that had sales. */
  ditor: Array<{ b: number; shitjet: number; fitimi: number }> | null
  /** [{ b: bucket 1–12, shitjet, fitimi }] — one per month that had sales. */
  mujor: Array<{ b: number; shitjet: number; fitimi: number }> | null
}

export async function GET(request: NextRequest) {
  const { error } = await requireRole(['admin'])
  if (error) return error

  try {
    const { searchParams } = new URL(request.url)
    const periudha = searchParams.get('periudha') || 'sot'
    const ngaParam = searchParams.get('nga')
    const deriParam = searchParams.get('deri')

    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
    const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0)
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0)
    const last30Start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29, 0, 0, 0, 0)
    const last12Start = new Date(now.getFullYear(), now.getMonth() - 11, 1, 0, 0, 0, 0)
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0)
    const yesterdayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0, 0)

    // Period filter
    let periodStart: Date
    let periodEnd: Date = tomorrowStart
    switch (periudha) {
      case 'jave':
        periodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6, 0, 0, 0, 0)
        break
      case 'muaj':
        periodStart = monthStart
        break
      case 'custom':
        periodStart = ngaParam ? new Date(ngaParam) : monthStart
        if (deriParam) {
          const d = new Date(deriParam)
          d.setHours(23, 59, 59, 999)
          periodEnd = d
        }
        break
      default:
        periodStart = todayStart
    }

    // Day and month buckets for the charts. Their boundaries are computed
    // here, in the server's local time exactly as the labels below are, and
    // passed in — so SQL never has to agree with Node about the time zone.
    const dayStarts = Array.from(
      { length: 31 },
      (_, i) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29 + i)
    ) // 30 days + tomorrow's start as the upper bound
    const monthStarts = Array.from(
      { length: 13 },
      (_, i) => new Date(now.getFullYear(), now.getMonth() - 11 + i, 1)
    ) // 12 months + next month's start

    const [
      saleSummary,
      productCount,
      lowStockAll,
      suppliersCount,
      topPeriodProducts,
      recentSales,
      personalUsePeriod,
      personalUseMonth,
    ] = await Promise.all([
      // Every Sale figure on the dashboard in one statement: conditional
      // sums for the KPIs, and width_bucket groupings for the two charts.
      // It replaces seven findMany calls that each fetched rows to sum in JS.
      prisma.$queryRaw<SaleSummaryRow[]>`
        WITH s AS (
          SELECT id, "createdAt" AS at, totali, fitimi FROM "Sale"
        )
        SELECT
          SUM(totali) FILTER (WHERE at >= ${ts(periodStart)} AND at < ${ts(periodEnd)})      AS periudha_totali,
          SUM(fitimi) FILTER (WHERE at >= ${ts(periodStart)} AND at < ${ts(periodEnd)})      AS periudha_fitimi,
          (COUNT(*) FILTER (WHERE at >= ${ts(periodStart)} AND at < ${ts(periodEnd)}))::int  AS periudha_numri,
          (SELECT SUM(si.sasia) FROM "SaleItem" si JOIN s p ON p.id = si."saleId"
            WHERE p.at >= ${ts(periodStart)} AND p.at < ${ts(periodEnd)})                   AS periudha_produkte,
          SUM(totali) FILTER (WHERE at >= ${ts(monthStart)} AND at < ${ts(tomorrowStart)})   AS muaji_totali,
          SUM(fitimi) FILTER (WHERE at >= ${ts(monthStart)} AND at < ${ts(tomorrowStart)})   AS muaji_fitimi,
          SUM(totali) FILTER (WHERE at >= ${ts(todayStart)} AND at < ${ts(tomorrowStart)})   AS sot_totali,
          SUM(totali) FILTER (WHERE at >= ${ts(prevMonthStart)} AND at < ${ts(monthStart)})  AS muaji_kaluar_totali,
          SUM(totali) FILTER (WHERE at >= ${ts(yesterdayStart)} AND at < ${ts(todayStart)})  AS dje_totali,
          (SELECT json_agg(json_build_object('b', b, 'shitjet', t, 'fitimi', f))
             FROM (SELECT width_bucket(at, ${tsArray(dayStarts)}) AS b, SUM(totali) AS t, SUM(fitimi) AS f
                     FROM s WHERE at >= ${ts(last30Start)} AND at < ${ts(tomorrowStart)}
                    GROUP BY 1) d)                                                           AS ditor,
          (SELECT json_agg(json_build_object('b', b, 'shitjet', t, 'fitimi', f))
             FROM (SELECT width_bucket(at, ${tsArray(monthStarts)}) AS b, SUM(totali) AS t, SUM(fitimi) AS f
                     FROM s WHERE at >= ${ts(last12Start)} AND at < ${ts(tomorrowStart)}
                    GROUP BY 1) m)                                                           AS mujor
        FROM s
      `,
      prisma.product.count(),
      // Only the low-stock rows, filtered in SQL, in the order the JS sort
      // below has always started from.
      prisma.product.findMany({
        where: lowStockWhere(),
        select: { id: true, emri: true, sasia: true, stokuMinimal: true, kategoria: true, njesia: true },
        orderBy: { emri: 'asc' },
      }),
      prisma.supplier.count(),
      prisma.saleItem
        .groupBy({
          by: ['productId', 'emriProduktit'],
          where: { sale: { createdAt: { gte: periodStart, lt: periodEnd } } },
          _sum: { sasia: true, fitimi: true },
          orderBy: { _sum: { sasia: 'desc' } },
          take: 8,
        })
        .catch(() => []),
      prisma.sale.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { items: true },
      }),
      // Personal use is a cost, never revenue: it is aggregated on its own and
      // deliberately kept out of every total, profit and chart above.
      prisma.personalUseEntry.aggregate({
        _sum: { totali: true },
        _count: true,
        where: { data: { gte: periodStart, lt: periodEnd } },
      }),
      prisma.personalUseEntry.aggregate({
        _sum: { totali: true },
        where: { data: { gte: monthStart, lt: tomorrowStart } },
      }),
    ])

    const sum = saleSummary[0]

    // Period KPI
    const periudhaTotali = sum.periudha_totali ?? 0
    const periudhaFitimi = sum.periudha_fitimi ?? 0
    const periudhaNumri = sum.periudha_numri
    const periudhaProdukte = sum.periudha_produkte ?? 0

    // Fixed KPIs
    const shitjetSotTotali = sum.sot_totali ?? 0
    const shitjetMuajitTotali = sum.muaji_totali ?? 0
    const shitjetMuajitFitimi = sum.muaji_fitimi ?? 0

    // Low stock
    const lowStockProducts = lowStockAll
      .sort((a, b) => a.sasia / a.stokuMinimal - b.sasia / b.stokuMinimal)
      .slice(0, 8)

    // Daily chart — last 30 days. width_bucket's bucket b (1-based) is the
    // day starting at dayStarts[b - 1].
    const dailyBuckets = new Map((sum.ditor ?? []).map((r) => [r.b, r]))
    const chartDitor = dayStarts.slice(0, 30).map((d, i) => {
      const v = dailyBuckets.get(i + 1)
      return {
        data: `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`,
        shitjet: Math.round(v?.shitjet ?? 0),
        fitimi: Math.round(v?.fitimi ?? 0),
      }
    })

    // Monthly chart — last 12 months
    const monthlyBuckets = new Map((sum.mujor ?? []).map((r) => [r.b, r]))
    const chartMujor = monthStarts.slice(0, 12).map((d, i) => {
      const v = monthlyBuckets.get(i + 1)
      return {
        muaj: MONTH_NAMES[d.getMonth()],
        shitjet: Math.round(v?.shitjet ?? 0),
        fitimi: Math.round(v?.fitimi ?? 0),
      }
    })

    // Top products formatted
    const topProducts = topPeriodProducts.map((p) => ({
      emri: p.emriProduktit,
      njesi: p._sum.sasia ?? 0,
      fitimi: Math.round(p._sum.fitimi ?? 0),
    }))

    // Business insights
    const insights: Array<{ type: 'success' | 'warning' | 'info'; text: string }> = []

    if (topProducts.length > 0) {
      insights.push({
        type: 'info',
        text: `Produkti më i shitur: "${topProducts[0].emri}" (${topProducts[0].njesi} njësi)`,
      })
    }

    for (const p of lowStockProducts.slice(0, 2)) {
      insights.push({ type: 'warning', text: `Stoku po mbaron për ${p.emri} (${p.sasia} njësi të mbetura)` })
    }

    const prevMonthTotal = sum.muaji_kaluar_totali ?? 0
    if (prevMonthTotal > 0 && shitjetMuajitTotali > 0) {
      const diff = ((shitjetMuajitTotali - prevMonthTotal) / prevMonthTotal) * 100
      if (Math.abs(diff) >= 5) {
        const dir = diff > 0 ? 'rritur' : 'ulur'
        insights.push({
          type: diff > 0 ? 'success' : 'warning',
          text: `Shitjet janë ${dir} ${Math.abs(diff).toFixed(0)}% krahasuar me muajin e kaluar`,
        })
      }
    }

    const yesterdayTotal = sum.dje_totali ?? 0
    if (yesterdayTotal > 0 && shitjetSotTotali > 0) {
      const diff = ((shitjetSotTotali - yesterdayTotal) / yesterdayTotal) * 100
      if (Math.abs(diff) >= 10) {
        insights.push({
          type: diff > 0 ? 'success' : 'info',
          text: `Sot ${Math.abs(diff).toFixed(0)}% ${diff > 0 ? 'më shumë' : 'më pak'} shitje se dje`,
        })
      }
    }

    return NextResponse.json({
      periudhaTotali,
      periudhaFitimi,
      periudhaNumri,
      periudhaProdukte,
      shitjetSotTotali,
      shitjetMuajitTotali,
      shitjetMuajitFitimi,
      produktetTotal: productCount,
      lowStockCount: lowStockProducts.length,
      lowStockProducts,
      furnitoretTotal: suppliersCount,
      chartDitor,
      chartMujor,
      topProducts,
      shitjetRecente: recentSales,
      perdorimVetjakKosto: personalUsePeriod._sum.totali ?? 0,
      perdorimVetjakNumri: personalUsePeriod._count,
      perdorimVetjakMuaji: personalUseMonth._sum.totali ?? 0,
      insights,
    })
  } catch (error) {
    return handleApiError(error, 'Dashboard GET')
  }
}
