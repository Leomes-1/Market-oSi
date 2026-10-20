import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth-helpers'
import { badRequest, handleApiError } from '@/lib/api'
import { backupBucket, isSnapshotPath } from '@/lib/backups/storage'

export const dynamic = 'force-dynamic'

/** A 60-second signed link to one snapshot file. */
export async function GET(req: NextRequest) {
  const { error } = await requireRole(['admin'])
  if (error) return error

  try {
    const path = req.nextUrl.searchParams.get('path')
    if (!isSnapshotPath(path)) return badRequest('Snapshot i pavlefshëm')

    const fileName = `market-os-${path.slice('snapshots/'.length).replace('/', '_')}`
    const bucket = await backupBucket()
    const { data, error: signError } = await bucket.createSignedUrl(path, 60, { download: fileName })
    if (signError || !data) throw signError ?? new Error('Lidhja e shkarkimit nuk u krijua')

    return NextResponse.json({ url: data.signedUrl })
  } catch (error) {
    return handleApiError(error, 'Backups download')
  }
}
