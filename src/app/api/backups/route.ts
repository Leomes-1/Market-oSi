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
import { isEmailConfigured, readEmailStatus } from '@/lib/backups/email'

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
      lastEmail: null,
      emailConfigured: isEmailConfigured(),
    })
  }

  try {
    const [snapshots, lastFailure, lastEmail] = await Promise.all([
      listSnapshots(),
      readLastFailure(),
      readEmailStatus(),
    ])
    return NextResponse.json({
      configured: true,
      problem: null,
      snapshots,
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
