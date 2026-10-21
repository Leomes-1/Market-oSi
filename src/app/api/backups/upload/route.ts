import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth-helpers'
import { badRequest, handleApiError } from '@/lib/api'
import {
  CONFIRM_WORD,
  dryRunFrom,
  parseSnapshot,
  previewSnapshot,
  restoreFrom,
  restoringAdmin,
} from '@/lib/backups/restore'

export const dynamic = 'force-dynamic'

/**
 * Vercel rejects request bodies over 4.5 MB before the function runs, so the
 * file is capped just under that. Snapshots are a few hundred KB gzipped.
 */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024

/**
 * "Ngarko backup": restore from a .json.gz downloaded earlier.
 *
 * multipart/form-data: file, mode = 'preview' | 'dry-run' | 'restore',
 * confirm = 'RIKTHE' (restore only).
 *
 * The file is sent with every step and parsed in memory; it is never stored.
 * preview and dry-run write nothing to the live tables (the dry run works in
 * restore_test and rolls back). restore runs the same code as restoring a
 * snapshot from the list: pre-restore snapshot, one transaction, sequences
 * reset, the restoring admin kept.
 */
export async function POST(req: NextRequest) {
  const { error, userId } = await requireRole(['admin'])
  if (error) return error

  try {
    const declared = Number(req.headers.get('content-length') ?? 0)
    if (declared > MAX_UPLOAD_BYTES + 64 * 1024) {
      return badRequest('Skedari është shumë i madh (maksimumi 4 MB)')
    }

    const form = await req.formData()
    const file = form.get('file')
    const mode = form.get('mode')
    if (!(file instanceof File)) return badRequest('Zgjidh një skedar .json.gz')
    if (file.size > MAX_UPLOAD_BYTES) return badRequest('Skedari është shumë i madh (maksimumi 4 MB)')
    if (!/\.json\.gz$/i.test(file.name)) return badRequest('Skedari duhet të jetë .json.gz')

    const snapshot = parseSnapshot(Buffer.from(await file.arrayBuffer()))
    // Names the source in results and in the pre-restore snapshot's metadata.
    const label = `upload:${file.name.replace(/[^\w.\-]/g, '_').slice(0, 100)}`
    const admin = await restoringAdmin(userId!)

    if (mode === 'preview') {
      return NextResponse.json({
        ...(await previewSnapshot(snapshot, label, admin)),
        fileName: file.name,
        kind: snapshot.kind,
      })
    }
    if (mode === 'dry-run') {
      return NextResponse.json(await dryRunFrom(snapshot, label, admin))
    }
    if (mode === 'restore') {
      if (form.get('confirm') !== CONFIRM_WORD) {
        return badRequest(`Shkruaj ${CONFIRM_WORD} për të konfirmuar`)
      }
      return NextResponse.json(await restoreFrom(snapshot, label, admin))
    }
    return badRequest('Mënyrë e pavlefshme')
  } catch (error) {
    return handleApiError(error, 'Backups upload')
  }
}
