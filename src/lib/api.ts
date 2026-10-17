import { NextResponse } from 'next/server'

/**
 * Shared response helpers so every API route answers with the same shape.
 *
 * Success:  the resource itself (array or object), or { success: true } for
 *           mutations that have nothing to return.
 * Error:    { error: string, code?: string } — the `error` key is what every
 *           page already reads, so it stays.
 */

export type ApiErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'DUPLICATE'
  | 'IN_USE'
  | 'INSUFFICIENT_STOCK'
  | 'CHECK_VIOLATION'
  | 'SERVER_ERROR'

export function apiError(message: string, status: number, code: ApiErrorCode) {
  return NextResponse.json({ error: message, code }, { status })
}

export const badRequest = (message: string) => apiError(message, 400, 'VALIDATION')
export const notFound = (message: string) => apiError(message, 404, 'NOT_FOUND')
export const conflict = (message: string, code: ApiErrorCode = 'CONFLICT') =>
  apiError(message, 409, code)

export function success() {
  return NextResponse.json({ success: true })
}

/** Thrown inside a transaction to abort it with a specific client-facing message. */
export class ApiFailure extends Error {
  constructor(
    message: string,
    public status: number,
    public code: ApiErrorCode
  ) {
    super(message)
    this.name = 'ApiFailure'
  }
}

function prismaCode(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code
    if (typeof code === 'string') return code
  }
  return null
}

/**
 * Detects a PostgreSQL check-constraint violation (SQLSTATE 23514).
 *
 * Prisma has no mapped error code for CHECK constraints, so these arrive as an
 * unknown request error (or P2010 from a raw query) carrying the driver's own
 * message. Both shapes are matched here, and the constraint name is returned
 * so the caller can give a specific message.
 */
function checkConstraintName(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null

  const meta = (error as { meta?: { code?: unknown; constraint?: unknown; message?: unknown } }).meta
  const metaCode = typeof meta?.code === 'string' ? meta.code : null
  const message = [
    typeof (error as { message?: unknown }).message === 'string'
      ? (error as { message: string }).message
      : '',
    typeof meta?.message === 'string' ? meta.message : '',
  ].join(' ')

  const is23514 = metaCode === '23514' || /\b23514\b/.test(message)
  const mentionsCheck = /violates check constraint/i.test(message)
  if (!is23514 && !mentionsCheck) return null

  if (typeof meta?.constraint === 'string') return meta.constraint

  // The constraint name reaches us differently depending on the call path.
  // A raw query yields a clean  check constraint "Product_sasia_non_negative"
  // while the ORM wraps the driver error, escaping the quotes, so the text is
  // literally  check constraint \"Product_sasia_non_negative\"  — hence the
  // tolerant delimiter class rather than a plain quote.
  const named = message.match(/check constraint[\s\\"']*([A-Za-z0-9_]+)/i)
  return named ? named[1] : ''
}

/** Field names Prisma reports on a P2002, if it gave us any. */
function prismaTarget(error: unknown): string[] {
  if (typeof error === 'object' && error !== null && 'meta' in error) {
    const meta = (error as { meta?: { target?: unknown } }).meta
    if (Array.isArray(meta?.target)) return meta.target.filter((t): t is string => typeof t === 'string')
  }
  return []
}

/**
 * Single error funnel for every route handler. Turns the Prisma error codes we
 * actually hit into accurate statuses and Albanian messages, and anything else
 * into a logged 500.
 *
 * `duplicateMessages` maps a conflicting field name to the message to show,
 * e.g. { barcode: 'Barkodi ekziston tashmë' }.
 */
export function handleApiError(
  error: unknown,
  context: string,
  duplicateMessages: Record<string, string> = {}
) {
  if (error instanceof ApiFailure) {
    return apiError(error.message, error.status, error.code)
  }

  const code = prismaCode(error)

  // Unique constraint violation.
  if (code === 'P2002') {
    const target = prismaTarget(error)
    for (const field of target) {
      if (duplicateMessages[field]) {
        return conflict(duplicateMessages[field], 'DUPLICATE')
      }
    }
    // A collision on the primary key means the table's id sequence has fallen
    // behind MAX(id) — resync it with setval rather than retrying.
    if (target.some((t) => t === 'id') || target.some((t) => t.endsWith('_pkey'))) {
      console.error(`${context}: primary-key collision, id sequence is out of sync`, error)
      return conflict(
        'Konflikt i ID-së në bazën e të dhënave. Njofto administratorin — sekuenca duhet risinkronizuar.',
        'CONFLICT'
      )
    }
    return conflict('Ky rekord ekziston tashmë', 'DUPLICATE')
  }

  // Foreign key constraint failed — usually an onDelete: Restrict.
  if (code === 'P2003') {
    return conflict(
      'Ky rekord është i lidhur me të dhëna të tjera dhe nuk mund të fshihet',
      'IN_USE'
    )
  }

  // Record required for the operation was not found.
  if (code === 'P2025') {
    return notFound('Rekordi nuk u gjet')
  }

  // Database-level CHECK constraint. Today the only one is
  // Product_sasia_non_negative, the backstop against negative stock.
  const constraint = checkConstraintName(error)
  if (constraint !== null) {
    if (constraint === 'Product_sasia_non_negative') {
      console.error(`${context}: blocked a write that would make stock negative`, error)
      return conflict('Stoku nuk mjafton', 'INSUFFICIENT_STOCK')
    }
    console.error(`${context}: check constraint ${constraint || '(unnamed)'} violated`, error)
    return conflict('Të dhënat nuk i plotësojnë kushtet e bazës së të dhënave', 'CHECK_VIOLATION')
  }

  console.error(`${context}:`, error)
  return apiError('Gabim në server', 500, 'SERVER_ERROR')
}

/** Parses a route `[id]` segment, returning null when it isn't a positive integer. */
export function parseId(raw: string): number | null {
  const id = Number(raw)
  if (!Number.isInteger(id) || id <= 0) return null
  return id
}
