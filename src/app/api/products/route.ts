import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth, requireRole } from '@/lib/auth-helpers'
import { badRequest, handleApiError } from '@/lib/api'
import { validatePrice, validateQuantity } from '@/lib/validation'
import { isLowStock } from '@/lib/utils'
import { scheduleSnapshot } from '@/lib/backups/snapshot'

const BARCODE_DUPLICATE = { barcode: 'Barkodi ekziston tashmë' }

export async function GET(req: NextRequest) {
  // Every signed-in role needs the catalogue: admin and staff for /produktet,
  // cashier for the POS.
  const { role, error } = await requireAuth()
  if (error) return error

  try {
    const { searchParams } = new URL(req.url)
    const kerkimi = searchParams.get('kerkimi') || ''
    const kategoria = searchParams.get('kategoria') || ''
    const stokUlet = searchParams.get('stokUlet') === 'true'

    const products = await prisma.product.findMany({
      where: {
        AND: [
          kerkimi
            ? {
                OR: [
                  { emri: { contains: kerkimi, mode: 'insensitive' } },
                  { kategoria: { contains: kerkimi, mode: 'insensitive' } },
                  { barcodes: { some: { barcode: { contains: kerkimi } } } },
                ],
              }
            : {},
          kategoria ? { kategoria } : {},
        ],
      },
      include: { furnitor: true, barcodes: true },
      orderBy: { emri: 'asc' },
    })

    const filtered = stokUlet
      ? products.filter((p) => isLowStock(p.sasia, p.stokuMinimal, p.njesia))
      : products

    // Cashiers work the till and have no business seeing cost prices, which
    // would let them derive the margin the receipt no longer shows them.
    if (role === 'cashier') {
      return NextResponse.json(
        filtered.map(({ cmimiBlerjes: _cost, ...rest }) => rest)
      )
    }

    return NextResponse.json(filtered)
  } catch (error) {
    return handleApiError(error, 'Products GET')
  }
}

export async function POST(req: NextRequest) {
  const { error } = await requireRole(['admin'])
  if (error) return error

  try {
    const body = await req.json()
    const {
      emri,
      barcodes,
      kategoria,
      sasia,
      stokuMinimal,
      cmimiBlerjes,
      cmimiShitjes,
      njesia,
      furnitorId,
    } = body

    if (!emri || !kategoria || cmimiBlerjes == null || cmimiShitjes == null) {
      return badRequest('Fushat e detyrueshme mungojnë')
    }

    const unit = njesia || 'copë'

    const blerjes = validatePrice(cmimiBlerjes, emri)
    if (!blerjes.ok) return badRequest(blerjes.error)

    const shitjes = validatePrice(cmimiShitjes, emri)
    if (!shitjes.ok) return badRequest(shitjes.error)

    // Opening stock may legitimately be zero, so only reject negatives here.
    const stock = sasia == null || sasia === '' ? 0 : Number(sasia)
    if (!Number.isFinite(stock) || stock < 0) {
      return badRequest('Sasia fillestare e pavlefshme')
    }
    if (stock > 0) {
      const checked = validateQuantity(stock, unit, emri)
      if (!checked.ok) return badRequest(checked.error)
    }

    const minimal = stokuMinimal == null || stokuMinimal === '' ? 5 : Number(stokuMinimal)
    if (!Number.isFinite(minimal) || minimal < 0) {
      return badRequest('Stoku minimal i pavlefshëm')
    }

    const validBarcodes: string[] = Array.isArray(barcodes)
      ? (barcodes as string[]).map((b) => String(b).trim()).filter(Boolean)
      : []

    if (validBarcodes.length > 10) {
      return badRequest('Maksimumi 10 barkode për produkt')
    }
    if (new Set(validBarcodes).size !== validBarcodes.length) {
      return badRequest('Barkodet e përsëritura nuk lejohen')
    }

    const product = await prisma.product.create({
      data: {
        emri,
        kategoria,
        sasia: stock,
        stokuMinimal: minimal,
        cmimiBlerjes: blerjes.value,
        cmimiShitjes: shitjes.value,
        njesia: unit,
        furnitorId: furnitorId ? Number(furnitorId) : null,
        barcodes: {
          create: validBarcodes.map((barcode) => ({ barcode })),
        },
      },
      include: { furnitor: true, barcodes: true },
    })

    scheduleSnapshot()
    return NextResponse.json(product, { status: 201 })
  } catch (error) {
    return handleApiError(error, 'Products POST', BARCODE_DUPLICATE)
  }
}
