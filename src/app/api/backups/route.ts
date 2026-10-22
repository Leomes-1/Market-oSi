import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth-helpers'
import { handleApiError } from '@/lib/api'
import {
  backupBucket,
  BackupConfigError,
  countSnapshots,
  isConfigured,
  listSnapshots,
  readLastFailure,
  recordFailure,
} from '@/lib/backups/storage'
import { pruneSnapshots, takeSnapshot } from '@/lib/backups/snapshot'
import { isEmailConfigured, readEmailStatus } from '@/lib/backups/email'

export const dynamic = 'force-dynamic'

/** Snapshots listed by default; `?all=1` returns every one. */
const LIST_LIMIT = 100

/**
 * Snapshot list plus anything the page should warn about.
 *
 * `total` is the full count even when the list is capped. Everything here is
 * database reads: the status files come from their Storage metadata, and the
 * bucket check is cached per server instance after its first call.
 */
export async function GET(req: NextRequest) {
  const { error } = await requireRole(['admin'])
  if (error) return error

  if (!isConfigured()) {
    return NextResponse.json({
      configured: false,
      problem: 'SUPABASE_SERVICE_ROLE_KEY nuk është vendosur — backup-et janë të çaktivizuara.',
      snapshots: [],
      lastFailure: null,
      lastEmail: null,
      emailConfigured: isEmailConfigured(),
    })
  }

  try {
    const all = new URL(req.url).searchParams.get('all') === '1'
    const [, snapshots, total, lastFailure, lastEmail] = await Promise.all([
      // Still refuses a public bucket (BackupConfigError below), as the
      // status-file downloads used to on their way.
      backupBucket(),
      listSnapshots(undefined, all ? undefined : LIST_LIMIT),
      countSnapshots(),
      readLastFailure(),
      readEmailStatus(),
    ])
    return NextResponse.json({
      configured: true,
      problem: null,
      snapshots,
      total,
      lastFailure,
      lastEmail,
      emailConfigured: isEmailConfigured(),
    })
  } catch (error) {
    if (error instanceof BackupConfigError) {
      return NextResponse.json({
        configured: false,
        problem: error.message,
        snapshots: [],
        lastFailure: null,
        lastEmail: null,
        emailConfigured: isEmailConfigured(),
      })
    }
    return handleApiError(error, 'Backups GET')
  }
}

/** "Bëj backup tani" */
export async function POST() {
  const { error } = await requireRole(['admin'])
  if (error) return error

  try {
    const snapshot = await takeSnapshot('manual')
    try {
      await pruneSnapshots()
    } catch (pruneError) {
      await recordFailure('prune', pruneError)
    }
    return NextResponse.json(snapshot)
  } catch (error) {
    await recordFailure('manual', error)
    return handleApiError(error, 'Backups POST')
  }
}
