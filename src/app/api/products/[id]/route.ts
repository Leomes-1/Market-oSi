import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth, requireRole } from '@/lib/auth-helpers'
import { badRequest, handleApiError, notFound, parseId, success } from '@/lib/api'
import { validatePrice, validateQuantity } from '@/lib/validation'

const BARCODE_DUPLICATE = { barcode: 'Barkodi ekziston tashmë' }

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { role, error } = await requireAuth()
  if (error) return error

  try {
    const id = parseId(params.id)
    if (id === null) return badRequest('ID i pavlefshëm')

    const product = await prisma.product.findUnique({
      where: { id },
      include: { furnitor: true, barcodes: true },
    })
    if (!product) return notFound('Produkti nuk u gjet')

    if (role === 'cashier') {
      const { cmimiBlerjes: _cost, ...rest } = product
      return NextResponse.json(rest)
    }

    return NextResponse.json(product)
  } catch (error) {
    return handleApiError(error, 'Product GET')
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  // Staff maintain the catalogue; cashiers have no products page and are now
  // blocked from editing one directly. Price fields stay admin-only below.
  const { role, error: authError } = await requireRole(['admin', 'staff'])
  if (authError) return authError

  try {
    const id = parseId(params.id)
    if (id === null) return badRequest('ID i pavlefshëm')

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

    if (!emri || !kategoria) {
      return badRequest('Fushat e detyrueshme mungojnë')
    }

    const existing = await prisma.product.findUnique({ where: { id } })
    if (!existing) return notFound('Produkti nuk u gjet')

    const unit = njesia || 'copë'

    const stock = Number(sasia)
    if (!Number.isFinite(stock) || stock < 0) {
      return badRequest('Sasia e pavlefshme')
    }
    if (stock > 0) {
      const checked = validateQuantity(stock, unit, emri)
      if (!checked.ok) return badRequest(checked.error)
    }

    const minimal = Number(stokuMinimal)
    if (!Number.isFinite(minimal) || minimal < 0) {
      return badRequest('Stoku minimal i pavlefshëm')
    }

    // Non-admins cannot move prices — their submitted values are discarded in
    // favour of what is already stored.
    let nextBlerjes = existing.cmimiBlerjes
    let nextShitjes = existing.cmimiShitjes
    if (role === 'admin') {
      const blerjes = validatePrice(cmimiBlerjes, emri)
      if (!blerjes.ok) return badRequest(blerjes.error)
      const shitjes = validatePrice(cmimiShitjes, emri)
      if (!shitjes.ok) return badRequest(shitjes.error)
      nextBlerjes = blerjes.value
      nextShitjes = shitjes.value
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

    const product = await prisma.product.update({
      where: { id },
      data: {
        emri,
        kategoria,
        sasia: stock,
        stokuMinimal: minimal,
        cmimiBlerjes: nextBlerjes,
        cmimiShitjes: nextShitjes,
        njesia: unit,
        furnitorId: furnitorId ? Number(furnitorId) : null,
        barcodes: {
          deleteMany: {},
          create: validBarcodes.map((barcode) => ({ barcode })),
        },
      },
      include: { furnitor: true, barcodes: true },
    })

    return NextResponse.json(product)
  } catch (error) {
    return handleApiError(error, 'Product PUT', BARCODE_DUPLICATE)
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { error } = await requireRole(['admin'])
  if (error) return error

  try {
    const id = parseId(params.id)
    if (id === null) return badRequest('ID i pavlefshëm')

    await prisma.product.delete({ where: { id } })
    return success()
  } catch (error) {
    // A product that appears on any sale or supply is protected by an
    // onDelete: Restrict foreign key — handleApiError turns that into a 409
    // with a readable message instead of an opaque 500.
    return handleApiError(error, 'Product DELETE')
  }
}
