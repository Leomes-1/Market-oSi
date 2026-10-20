import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth-helpers'
import { badRequest, handleApiError } from '@/lib/api'
import { isSnapshotPath } from '@/lib/backups/storage'
import {
  CONFIRM_WORD,
  dryRunRestore,
  restoreSnapshot,
  restoringAdmin,
} from '@/lib/backups/restore'

export const dynamic = 'force-dynamic'

/**
 * body: { path, mode: 'dry-run' }                    — rehearse in restore_test
 *       { path, mode: 'restore', confirm: 'RIKTHE' } — replace the live data
 */
export async function POST(req: NextRequest) {
  const { error, userId } = await requireRole(['admin'])
  if (error) return error

  try {
    const body = await req.json()
    const { path, mode, confirm } = body ?? {}
    if (!isSnapshotPath(path)) return badRequest('Snapshot i pavlefshëm')

    const admin = await restoringAdmin(userId!)

    if (mode === 'dry-run') {
      return NextResponse.json(await dryRunRestore(path, admin))
    }
    if (mode === 'restore') {
      if (confirm !== CONFIRM_WORD) return badRequest(`Shkruaj ${CONFIRM_WORD} për të konfirmuar`)
      return NextResponse.json(await restoreSnapshot(path, admin))
    }
    return badRequest('Mënyrë e pavlefshme')
  } catch (error) {
    return handleApiError(error, 'Backups restore')
  }
}
