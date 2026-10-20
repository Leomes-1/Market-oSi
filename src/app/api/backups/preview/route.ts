import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth-helpers'
import { badRequest, handleApiError } from '@/lib/api'
import { isSnapshotPath } from '@/lib/backups/storage'
import { previewRestore, restoringAdmin } from '@/lib/backups/restore'

export const dynamic = 'force-dynamic'

/** Row counts now vs in the snapshot, and anything that blocks a restore. Reads only. */
export async function GET(req: NextRequest) {
  const { error, userId } = await requireRole(['admin'])
  if (error) return error

  try {
    const path = req.nextUrl.searchParams.get('path')
    if (!isSnapshotPath(path)) return badRequest('Snapshot i pavlefshëm')

    return NextResponse.json(await previewRestore(path, await restoringAdmin(userId!)))
  } catch (error) {
    return handleApiError(error, 'Backups preview')
  }
}
