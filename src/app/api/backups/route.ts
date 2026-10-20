import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth-helpers'
import { handleApiError } from '@/lib/api'
import {
  BackupConfigError,
  isConfigured,
  listSnapshots,
  readLastFailure,
  recordFailure,
} from '@/lib/backups/storage'
import { pruneSnapshots, takeSnapshot } from '@/lib/backups/snapshot'

export const dynamic = 'force-dynamic'

/** Snapshot list plus anything the page should warn about. */
export async function GET() {
  const { error } = await requireRole(['admin'])
  if (error) return error

  if (!isConfigured()) {
    return NextResponse.json({
      configured: false,
      problem: 'SUPABASE_SERVICE_ROLE_KEY nuk është vendosur — backup-et janë të çaktivizuara.',
      snapshots: [],
      lastFailure: null,
    })
  }

  try {
    const [snapshots, lastFailure] = await Promise.all([listSnapshots(), readLastFailure()])
    return NextResponse.json({ configured: true, problem: null, snapshots, lastFailure })
  } catch (error) {
    if (error instanceof BackupConfigError) {
      return NextResponse.json({ configured: false, problem: error.message, snapshots: [], lastFailure: null })
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
