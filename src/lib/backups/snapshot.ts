import { gzipSync } from 'zlib'
import { waitUntil } from '@vercel/functions'
import { prisma } from '@/lib/prisma'
import { businessTables, lit, qt, tableColumns, type Db } from './catalog'
import {
  backupBucket,
  isConfigured,
  listSnapshots,
  objectExists,
  recordFailure,
  type SnapshotEntry,
  type SnapshotKind,
  type SnapshotMetadata,
} from './storage'

/**
 * Snapshots: every row of every business table, as one gzipped JSON file.
 *
 * File layout (snapshots/YYYY-MM-DD/HHmmss.json.gz, UTC so the October
 * daylight-saving hour cannot produce two files with the same name):
 *
 *   { format, version, createdAt, kind, rowCounts, columns, restoredFrom?,
 *     tables: { Product: [ {...row}, ... ], ... } }
 *
 * Rows are produced by Postgres (json_agg) and written into the file verbatim,
 * so column names and value formats are exactly what json_populate_recordset
 * reads back on restore.
 */

export const SNAPSHOT_FORMAT = 'market-os-snapshot'
export const SNAPSHOT_VERSION = 1

/** Serialises snapshot writers across all server instances. */
const SNAPSHOT_LOCK = 820_261_018

export interface SnapshotFile {
  format: typeof SNAPSHOT_FORMAT
  version: typeof SNAPSHOT_VERSION
  createdAt: string
  kind: SnapshotKind
  rowCounts: Record<string, number>
  columns: Record<string, string[]>
  restoredFrom?: string
  tables: Record<string, Record<string, unknown>[]>
}

interface CapturedSnapshot {
  path: string
  metadata: SnapshotMetadata
  gz: Buffer
}

function snapshotPath(at: Date): string {
  const iso = at.toISOString() // 2026-10-21T08:15:42.123Z
  return `snapshots/${iso.slice(0, 10)}/${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}.json.gz`
}

/**
 * Reads the whole database into a snapshot. All tables are read by a single
 * SELECT, so they come from one consistent MVCC snapshot even under READ
 * COMMITTED — a sale committing mid-read cannot leave SaleItem rows pointing
 * at a Sale the file does not contain.
 */
export async function captureSnapshot(
  db: Db,
  kind: SnapshotKind,
  restoredFrom?: string
): Promise<CapturedSnapshot> {
  const tables = await businessTables(db)
  const columns = await tableColumns(db, tables)

  const parts = tables.map((t) => {
    const order = columns[t].includes('id:int4') ? ' ORDER BY r.id' : ''
    return `${lit(t)}, (SELECT COALESCE(json_agg(r${order}), '[]'::json) FROM ${qt('public', t)} r)`
  })
  const [row] = await db.$queryRawUnsafe<{ data: string }[]>(
    `SELECT json_build_object(${parts.join(', ')})::text AS data`
  )

  const createdAt = new Date()
  const parsed = JSON.parse(row.data) as Record<string, unknown[]>
  const rowCounts = Object.fromEntries(tables.map((t) => [t, parsed[t].length]))

  const metadata: SnapshotMetadata = {
    createdAt: createdAt.toISOString(),
    kind,
    rowCounts,
    ...(restoredFrom ? { restoredFrom } : {}),
  }
  const header = { format: SNAPSHOT_FORMAT, version: SNAPSHOT_VERSION, ...metadata, columns }
  const text = `${JSON.stringify(header).slice(0, -1)},"tables":${row.data}}`

  return { path: snapshotPath(createdAt), metadata, gz: gzipSync(text) }
}

/** Uploads a captured snapshot, never overwriting an existing object. */
export async function uploadSnapshot(db: Db, captured: CapturedSnapshot): Promise<SnapshotEntry> {
  const bucket = await backupBucket()

  let path = captured.path
  for (let n = 2; await objectExists(db, path); n++) {
    path = captured.path.replace(/\.json\.gz$/, `-${n}.json.gz`)
  }

  const { error } = await bucket.upload(path, captured.gz, {
    contentType: 'application/gzip',
    upsert: false,
    metadata: captured.metadata,
  })
  if (error) throw new Error(`Ngarkimi i snapshot-it dështoi: ${error.message}`)

  return {
    path,
    createdAt: captured.metadata.createdAt,
    kind: captured.metadata.kind,
    rowCounts: captured.metadata.rowCounts,
    restoredFrom: captured.metadata.restoredFrom ?? null,
    size: captured.gz.length,
  }
}

function minuteOf(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 60_000)
}

/**
 * Takes a snapshot now.
 *
 * Throttling for 'auto' is "at most one per calendar minute", enforced by
 * replacement rather than by skipping: a second write within the same minute
 * still snapshots, then deletes that minute's earlier automatic snapshot. A
 * skip-based throttle would leave the last write of a burst out of every
 * backup until some unrelated later write happened, possibly the next day.
 * Manual and pre-restore snapshots are never replaced.
 *
 * The advisory lock makes concurrent writers (two tills, two Vercel
 * instances) take turns, so each sees the other's finished upload.
 */
export async function takeSnapshot(kind: 'auto' | 'manual'): Promise<SnapshotEntry> {
  await backupBucket() // fail fast on configuration, before taking a connection
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock($1)', SNAPSHOT_LOCK)

      const captured = await captureSnapshot(tx, kind)

      let replaces: string | null = null
      if (kind === 'auto') {
        const [latest] = await listSnapshots(tx, 1)
        if (
          latest &&
          latest.kind === 'auto' &&
          minuteOf(latest.createdAt) === minuteOf(captured.metadata.createdAt)
        ) {
          replaces = latest.path
        }
      }

      const entry = await uploadSnapshot(tx, captured)

      if (replaces && replaces !== entry.path) {
        const bucket = await backupBucket()
        const { error } = await bucket.remove([replaces])
        if (error) console.error(`Backup: could not remove replaced snapshot ${replaces}:`, error)
      }
      return entry
    },
    { maxWait: 5_000, timeout: 12_000 }
  )
}

const HOUR = 3_600_000
const DAY = 24 * HOUR

function tiraneDay(at: Date): string {
  return at.toLocaleDateString('en-CA', { timeZone: 'Europe/Tirane' })
}

/**
 * Which snapshots retention removes.
 *
 *   ≤ 48 h      keep everything
 *   48 h – 7 d  keep the newest per hour
 *   7 d – 30 d  keep the newest per day (Albania calendar day)
 *   > 30 d      delete
 *
 * Pre-restore snapshots are the undo button for a restore, so they are kept
 * whole for the full 30 days instead of being thinned.
 */
export function selectForPruning(entries: SnapshotEntry[], now: Date): string[] {
  const doomed: string[] = []
  const seenBuckets = new Set<string>()
  const newestFirst = [...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  for (const entry of newestFirst) {
    const at = new Date(entry.createdAt)
    const age = now.getTime() - at.getTime()

    if (age <= 48 * HOUR) continue
    if (age > 30 * DAY) {
      doomed.push(entry.path)
      continue
    }
    if (entry.kind === 'pre-restore') continue

    const bucket =
      age <= 7 * DAY ? `h:${at.toISOString().slice(0, 13)}` : `d:${tiraneDay(at)}`
    if (seenBuckets.has(bucket)) doomed.push(entry.path)
    else seenBuckets.add(bucket)
  }
  return doomed
}

export async function pruneSnapshots(now = new Date()): Promise<number> {
  const doomed = selectForPruning(await listSnapshots(), now)
  if (doomed.length === 0) return 0

  const bucket = await backupBucket()
  for (let i = 0; i < doomed.length; i += 100) {
    const { error } = await bucket.remove(doomed.slice(i, i + 100))
    if (error) throw new Error(`Fshirja e snapshot-eve të vjetra dështoi: ${error.message}`)
  }
  return doomed.length
}

async function runAutoSnapshot(): Promise<void> {
  try {
    await takeSnapshot('auto')
  } catch (error) {
    await recordFailure('auto', error)
    return
  }
  try {
    await pruneSnapshots()
  } catch (error) {
    await recordFailure('prune', error)
  }
}

/**
 * Call after every successful write. Returns immediately; the snapshot runs
 * after the response via waitUntil. Cannot throw and cannot fail the caller.
 */
export function scheduleSnapshot(): void {
  // Unconfigured is reported on the backup page; no need to log every sale.
  if (!isConfigured()) return
  try {
    waitUntil(runAutoSnapshot())
  } catch (error) {
    console.error('scheduleSnapshot:', error)
  }
}
