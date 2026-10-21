import { timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth-helpers'
import { apiError, handleApiError } from '@/lib/api'
import { emailLatestSnapshot } from '@/lib/backups/email'

export const dynamic = 'force-dynamic'
// Snapshot + SMTP can exceed the 15 s default given to other routes.
export const maxDuration = 60

/**
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. Anything else —
 * including any request when CRON_SECRET is unset — is refused.
 */
function isCronRequest(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const given = Buffer.from(req.headers.get('authorization') ?? '')
  const expected = Buffer.from(`Bearer ${secret}`)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

/**
 * Weekly cron (vercel.json). The middleware lets this one path through
 * without a session; the secret check here is the gate.
 */
export async function GET(req: NextRequest) {
  if (!isCronRequest(req)) {
    return NextResponse.json({ error: 'Jo i autorizuar', code: 'UNAUTHORIZED' }, { status: 401 })
  }
  try {
    return NextResponse.json(await emailLatestSnapshot('cron'))
  } catch (error) {
    return handleApiError(error, 'Backups email (cron)')
  }
}

/** "Dërgo tani në email" */
export async function POST() {
  const { error } = await requireRole(['admin'])
  if (error) return error
  try {
    return NextResponse.json(await emailLatestSnapshot('manual'))
  } catch (error) {
    // The admin pressed the button to test the setup, so show them why it
    // failed (e.g. a rejected app password) rather than a generic error.
    // SMTP errors name the account at most, never the password.
    const message = error instanceof Error ? error.message : String(error)
    return apiError(`Dërgimi i email-it dështoi: ${message}`, 500, 'SERVER_ERROR')
  }
}
