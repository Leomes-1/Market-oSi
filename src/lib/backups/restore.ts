import { gunzipSync } from 'zlib'
import { prisma } from '@/lib/prisma'
import { ApiFailure } from '@/lib/api'
import {
  businessTables,
  countRows,
  foreignKeys,
  lit,
  parentsFirst,
  q,
  qt,
  tableColumns,
  type Db,
  type ForeignKey,
} from './catalog'
import { backupBucket, type SnapshotEntry } from './storage'
import {
  captureSnapshot,
  scheduleSnapshot,
  SNAPSHOT_FORMAT,
  SNAPSHOT_VERSION,
  uploadSnapshot,
  type SnapshotFile,
} from './snapshot'

/**
 * Restore a snapshot over the live tables, or rehearse it in a throwaway
 * schema.
 *
 * Both paths run the same `loadInto` core, parameterised by schema, so the
 * dry run exercises exactly the SQL a real restore would. Auth lives in the
 * `auth` schema and is never touched; only `public` business tables are.
 */

/** The only schema the dry run may write to. */
const DRY_RUN_SCHEMA = 'restore_test'

/** What the admin must type to confirm a real restore. */
export const CONFIRM_WORD = 'RIKTHE'

export interface RestoringAdmin {
  userId: string
  email: string
}

/** The caller, as the restore needs them: their row must survive it as admin. */
export async function restoringAdmin(userId: string): Promise<RestoringAdmin> {
  const row = await prisma.userRole.findUnique({ where: { userId } })
  return { userId, email: row?.email ?? '' }
}

export type AdminAction = 'unchanged' | 'promoted' | 'inserted'

export interface SequenceCheck {
  maxId: number | null
  nextId: number
  ok: boolean
}

/**
 * Ceiling on the unzipped size. A real snapshot is a few MB at most; this
 * stops a small crafted .gz from expanding into gigabytes in memory.
 */
const MAX_UNZIPPED_BYTES = 128 * 1024 * 1024

/**
 * Parses a gzipped snapshot — from Storage or from an uploaded file. Only the
 * envelope is checked here; `plan` checks the contents against the schema.
 */
export function parseSnapshot(gz: Buffer): SnapshotFile {
  let text: string
  try {
    text = gunzipSync(gz, { maxOutputLength: MAX_UNZIPPED_BYTES }).toString('utf8')
  } catch {
    throw new ApiFailure('Skedari nuk është .json.gz i vlefshëm (ose është shumë i madh)', 400, 'VALIDATION')
  }
  let snapshot: SnapshotFile
  try {
    snapshot = JSON.parse(text) as SnapshotFile
  } catch {
    throw new ApiFailure('Skedari nuk përmban JSON të vlefshëm', 400, 'VALIDATION')
  }
  if (
    !snapshot ||
    typeof snapshot !== 'object' ||
    snapshot.format !== SNAPSHOT_FORMAT ||
    snapshot.version !== SNAPSHOT_VERSION ||
    typeof snapshot.createdAt !== 'string' ||
    typeof snapshot.columns !== 'object' ||
    typeof snapshot.tables !== 'object' ||
    typeof snapshot.rowCounts !== 'object'
  ) {
    throw new ApiFailure('Skedari nuk është snapshot i Market OS', 400, 'VALIDATION')
  }
  return snapshot
}

export async function loadSnapshot(path: string): Promise<SnapshotFile> {
  const bucket = await backupBucket()
  const { data, error } = await bucket.download(path)
  if (error || !data) {
    throw new ApiFailure(`Snapshot-i nuk u shkarkua: ${error?.message ?? 'bosh'}`, 404, 'NOT_FOUND')
  }
  return parseSnapshot(Buffer.from(await data.arrayBuffer()))
}

interface Plan {
  /** Tables in insert order. */
  order: string[]
  fks: ForeignKey[]
  problems: string[]
}

/**
 * Compares the snapshot's shape with the live schema. Any difference blocks
 * the restore — a snapshot taken before a migration cannot be loaded
 * faithfully into the schema after it.
 */
async function plan(db: Db, snapshot: SnapshotFile): Promise<Plan> {
  const tables = await businessTables(db)
  const live = await tableColumns(db, tables)
  const fks = await foreignKeys(db, tables)
  const problems: string[] = []

  const snapTables = Object.keys(snapshot.columns ?? {})
  for (const t of tables) {
    if (!snapTables.includes(t)) problems.push(`Tabela ${t} mungon në snapshot`)
  }
  for (const t of snapTables) {
    if (!tables.includes(t)) problems.push(`Tabela ${t} nuk ekziston më në bazë`)
  }
  for (const t of tables.filter((t) => snapTables.includes(t))) {
    const declared: unknown = snapshot.columns[t]
    if (!Array.isArray(declared) || !declared.every((c) => typeof c === 'string')) {
      problems.push(`Kolonat e tabelës ${t} mungojnë në snapshot`)
      continue
    }
    const a = live[t].join(',')
    const b = [...declared].sort().join(',')
    if (a !== b) problems.push(`Kolonat e tabelës ${t} kanë ndryshuar që nga snapshot-i`)
    const rows = snapshot.tables?.[t]
    if (!Array.isArray(rows)) problems.push(`Të dhënat e tabelës ${t} mungojnë`)
    else {
      if (rows.length !== snapshot.rowCounts?.[t]) {
        problems.push(`Numri i rreshtave të ${t} nuk përputhet me metadata-t`)
      }
      // Every row must carry exactly the declared columns. Snapshots we wrote
      // always do; an edited file might not, and json_populate_recordset would
      // quietly fill a missing key with NULL.
      if (a === b) {
        const names = live[t].map((c) => c.slice(0, c.lastIndexOf(':'))).sort().join(',')
        const bad = rows.findIndex(
          (r) =>
            !r ||
            typeof r !== 'object' ||
            Array.isArray(r) ||
            Object.keys(r).sort().join(',') !== names
        )
        if (bad >= 0) problems.push(`Rreshti ${bad + 1} i tabelës ${t} nuk ka kolonat e duhura`)
      }
    }
  }

  return { order: parentsFirst(tables, fks), fks, problems }
}

function adminActionFor(snapshot: SnapshotFile, admin: RestoringAdmin): AdminAction {
  const rows = (snapshot.tables.UserRole ?? []) as { userId?: string; roli?: string }[]
  const existing = rows.find((r) => r.userId === admin.userId)
  if (!existing) return 'inserted'
  return existing.roli === 'admin' ? 'unchanged' : 'promoted'
}

/**
 * Replaces every business table in `schema` with the snapshot's rows.
 *
 *  1. DELETE children before parents
 *  2. INSERT parents before children, original ids included
 *  3. setval every id sequence to MAX(id)
 *  4. make sure the admin running the restore is still an admin
 *
 * Step 4 comes after step 3 so a re-inserted admin row draws its id from the
 * corrected sequence instead of colliding with a restored one.
 */
async function loadInto(
  tx: Db,
  schema: string,
  snapshot: SnapshotFile,
  order: string[],
  admin: RestoringAdmin
): Promise<{ expected: Record<string, number>; adminAction: AdminAction }> {
  for (const t of [...order].reverse()) {
    await tx.$executeRawUnsafe(`DELETE FROM ${qt(schema, t)}`)
  }

  for (const t of order) {
    const rows = snapshot.tables[t]
    if (rows.length === 0) continue
    await tx.$executeRawUnsafe(
      `INSERT INTO ${qt(schema, t)} SELECT * FROM json_populate_recordset(NULL::${qt(schema, t)}, $1::json)`,
      JSON.stringify(rows)
    )
  }

  for (const t of order) {
    if (!snapshot.columns[t].includes('id:int4')) continue
    const seq = await sequenceOf(tx, schema, t)
    await tx.$executeRawUnsafe(
      `SELECT setval($1::regclass, COALESCE((SELECT MAX(id) FROM ${qt(schema, t)}), 1), (SELECT MAX(id) FROM ${qt(schema, t)}) IS NOT NULL)`,
      seq
    )
  }

  const expected = Object.fromEntries(order.map((t) => [t, snapshot.tables[t].length]))
  const adminAction = adminActionFor(snapshot, admin)
  const userRole = qt(schema, 'UserRole')
  if (adminAction === 'inserted') {
    await tx.$executeRawUnsafe(
      `INSERT INTO ${userRole} ("userId", "email", "roli", "createdAt", "updatedAt") VALUES ($1, $2, 'admin', now(), now())`,
      admin.userId,
      admin.email
    )
    expected.UserRole += 1
  } else if (adminAction === 'promoted') {
    await tx.$executeRawUnsafe(
      `UPDATE ${userRole} SET "roli" = 'admin', "updatedAt" = now() WHERE "userId" = $1`,
      admin.userId
    )
  }

  return { expected, adminAction }
}

async function sequenceOf(tx: Db, schema: string, table: string): Promise<string> {
  const [row] = await tx.$queryRawUnsafe<{ seq: string | null }[]>(
    `SELECT pg_get_serial_sequence($1, 'id') AS seq`,
    qt(schema, table)
  )
  if (!row?.seq) throw new Error(`Tabela ${schema}.${table} nuk ka sekuencë për id`)
  return row.seq
}

async function checkSequences(
  tx: Db,
  schema: string,
  order: string[],
  columns: Record<string, string[]>
): Promise<Record<string, SequenceCheck>> {
  const result: Record<string, SequenceCheck> = {}
  for (const t of order) {
    if (!columns[t].includes('id:int4')) continue
    const seq = await sequenceOf(tx, schema, t)
    // `seq` comes from pg_get_serial_sequence, already quoted and qualified.
    const [row] = await tx.$queryRawUnsafe<{ maxId: number | null; last: number; called: boolean }[]>(
      `SELECT (SELECT MAX(id) FROM ${qt(schema, t)})::int AS "maxId", last_value::int AS "last", is_called AS "called" FROM ${seq}`
    )
    const nextId = row.called ? row.last + 1 : row.last
    result[t] = { maxId: row.maxId, nextId, ok: nextId > (row.maxId ?? 0) }
  }
  return result
}

function mismatches(expected: Record<string, number>, actual: Record<string, number>): string[] {
  return Object.keys(expected)
    .filter((t) => expected[t] !== actual[t])
    .map((t) => `${t}: pritej ${expected[t]}, u gjet ${actual[t]}`)
}

// ── Preview ────────────────────────────────────────────────────────────────

export interface RestorePreview {
  path: string
  createdAt: string
  kind: string
  current: Record<string, number>
  snapshot: Record<string, number>
  problems: string[]
  adminAction: AdminAction
}

export async function previewRestore(path: string, admin: RestoringAdmin): Promise<RestorePreview> {
  return previewSnapshot(await loadSnapshot(path), path, admin)
}

/**
 * `label` names the source in results and in the pre-restore snapshot's
 * metadata: a Storage path, or "upload:<file name>" for an uploaded file.
 */
export async function previewSnapshot(
  snapshot: SnapshotFile,
  label: string,
  admin: RestoringAdmin
): Promise<RestorePreview> {
  const path = label
  const { order, problems } = await plan(prisma, snapshot)
  return {
    path,
    createdAt: snapshot.createdAt,
    kind: snapshot.kind,
    current: await countRows(prisma, 'public', order),
    snapshot: snapshot.rowCounts,
    problems,
    adminAction: adminActionFor(snapshot, admin),
  }
}

// ── Real restore ───────────────────────────────────────────────────────────

export interface RestoreResult {
  path: string
  preRestore: SnapshotEntry
  before: Record<string, number>
  after: Record<string, number>
  expected: Record<string, number>
  adminAction: AdminAction
  sequences: Record<string, SequenceCheck>
  verified: boolean
}

/**
 * Restores `path` over the live `public` tables in one transaction.
 *
 * The business tables are locked EXCLUSIVE first (reads continue, writes
 * wait), and the pre-restore snapshot is captured and uploaded inside that
 * same transaction — so no sale can land between "state saved" and "state
 * replaced" and be silently lost. If anything fails, the transaction rolls
 * back and the shop is exactly as it was; the pre-restore file may remain,
 * which is harmless.
 */
export async function restoreSnapshot(path: string, admin: RestoringAdmin): Promise<RestoreResult> {
  return restoreFrom(await loadSnapshot(path), path, admin)
}

/** The restore itself, for a snapshot from Storage or from an uploaded file. */
export async function restoreFrom(
  snapshot: SnapshotFile,
  label: string,
  admin: RestoringAdmin
): Promise<RestoreResult> {
  const path = label
  const { order, problems } = await plan(prisma, snapshot)
  if (problems.length > 0) {
    throw new ApiFailure(`Rikthimi u refuzua: ${problems.join('; ')}`, 409, 'CONFLICT')
  }

  const result = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '5s'`)
      await tx.$executeRawUnsafe(
        `LOCK TABLE ${order.map((t) => qt('public', t)).join(', ')} IN EXCLUSIVE MODE`
      )

      const before = await countRows(tx, 'public', order)
      const preRestore = await uploadSnapshot(tx, await captureSnapshot(tx, 'pre-restore', path))

      const { expected, adminAction } = await loadInto(tx, 'public', snapshot, order, admin)

      const after = await countRows(tx, 'public', order)
      const wrong = mismatches(expected, after)
      if (wrong.length > 0) {
        throw new ApiFailure(`Verifikimi dështoi, asgjë nuk u ndryshua: ${wrong.join('; ')}`, 500, 'SERVER_ERROR')
      }
      const sequences = await checkSequences(tx, 'public', order, snapshot.columns)
      if (Object.values(sequences).some((s) => !s.ok)) {
        throw new ApiFailure('Verifikimi i sekuencave dështoi, asgjë nuk u ndryshua', 500, 'SERVER_ERROR')
      }

      return { preRestore, before, expected, adminAction, sequences }
    },
    { maxWait: 5_000, timeout: 13_000 }
  )

  // Re-count from a fresh connection, after commit.
  const after = await countRows(prisma, 'public', order)
  scheduleSnapshot()

  return {
    path,
    ...result,
    after,
    verified: mismatches(result.expected, after).length === 0,
  }
}

// ── Dry run ────────────────────────────────────────────────────────────────

export interface DryRunResult {
  path: string
  problems: string[]
  snapshot: Record<string, number>
  expected: Record<string, number>
  restored: Record<string, number>
  countsMatch: boolean
  adminAction: AdminAction
  sequences: Record<string, SequenceCheck>
  sequencesOk: boolean
  publicBefore: Record<string, number>
  publicAfter: Record<string, number>
  publicUnchanged: boolean
  schemaDropped: boolean
  ok: boolean
}

/** Thrown to roll the dry-run transaction back once the result is in hand. */
class DryRunRollback extends Error {
  constructor() {
    super('dry run rollback')
    // Keeps `instanceof` working when compiled to ES5.
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

async function schemaExists(db: Db, schema: string): Promise<boolean> {
  const rows = await db.$queryRaw<{ found: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = ${schema}) AS found`
  return rows[0]?.found ?? false
}

/**
 * Rehearses a restore inside `restore_test`, never touching `public`.
 *
 * Copies of the business tables are created with LIKE (columns, NOT NULL,
 * CHECK constraints, primary and unique indexes) — but deliberately without
 * defaults, because the copied defaults would call nextval() on the *public*
 * sequences. Each copy gets its own sequence instead, and the foreign keys are
 * recreated between the copies.
 *
 * Belt and braces: every statement names `restore_test` explicitly, the
 * search_path is narrowed to it, the schema is dropped at the end, and the
 * whole transaction is then rolled back regardless, so even the DROP is moot.
 * Public row counts are taken before and after as evidence.
 */
export async function dryRunRestore(path: string, admin: RestoringAdmin): Promise<DryRunResult> {
  return dryRunFrom(await loadSnapshot(path), path, admin)
}

/** The dry run itself, for a snapshot from Storage or from an uploaded file. */
export async function dryRunFrom(
  snapshot: SnapshotFile,
  label: string,
  admin: RestoringAdmin
): Promise<DryRunResult> {
  const S = DRY_RUN_SCHEMA
  const path = label
  const { order, fks, problems } = await plan(prisma, snapshot)
  if (problems.length > 0) {
    throw new ApiFailure(`Prova u refuzua: ${problems.join('; ')}`, 409, 'CONFLICT')
  }
  if (await schemaExists(prisma, S)) {
    throw new ApiFailure(`Skema ${S} ekziston tashmë — kontrollo manualisht përpara një prove.`, 409, 'CONFLICT')
  }

  const publicBefore = await countRows(prisma, 'public', order)
  // Filled inside the transaction, which is then rolled back on purpose.
  const holder: {
    result?: Omit<DryRunResult, 'publicBefore' | 'publicAfter' | 'publicUnchanged' | 'schemaDropped' | 'ok'>
  } = {}

  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`CREATE SCHEMA ${q(S)}`)

        for (const t of order) {
          await tx.$executeRawUnsafe(
            `CREATE TABLE ${qt(S, t)} (LIKE ${qt('public', t)} INCLUDING CONSTRAINTS INCLUDING INDEXES)`
          )
          if (snapshot.columns[t].includes('id:int4')) {
            const seq = qt(S, `${t}_id_seq`)
            await tx.$executeRawUnsafe(`CREATE SEQUENCE ${seq} OWNED BY ${qt(S, t)}."id"`)
            await tx.$executeRawUnsafe(
              `ALTER TABLE ${qt(S, t)} ALTER COLUMN "id" SET DEFAULT nextval(${lit(seq)}::regclass)`
            )
          }
        }
        for (const fk of fks) {
          await tx.$executeRawUnsafe(
            `ALTER TABLE ${qt(S, fk.child)} ADD FOREIGN KEY (${fk.childColumns.map(q).join(', ')}) ` +
              `REFERENCES ${qt(S, fk.parent)} (${fk.parentColumns.map(q).join(', ')})`
          )
        }

        await tx.$executeRawUnsafe(`SET LOCAL search_path TO ${q(S)}`)

        const { expected, adminAction } = await loadInto(tx, S, snapshot, order, admin)
        const restored = await countRows(tx, S, order)
        const sequences = await checkSequences(tx, S, order, snapshot.columns)

        await tx.$executeRawUnsafe(`DROP SCHEMA ${q(S)} CASCADE`)

        holder.result = {
          path,
          problems,
          snapshot: snapshot.rowCounts,
          expected,
          restored,
          countsMatch: mismatches(expected, restored).length === 0,
          adminAction,
          sequences,
          sequencesOk: Object.values(sequences).every((s) => s.ok),
        }
        throw new DryRunRollback()
      },
      { maxWait: 5_000, timeout: 13_000 }
    )
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error
  }

  const done = holder.result
  if (!done) throw new Error('Prova përfundoi pa rezultat')

  const publicAfter = await countRows(prisma, 'public', order)
  const publicUnchanged = mismatches(publicBefore, publicAfter).length === 0
  const schemaDropped = !(await schemaExists(prisma, S))

  return {
    ...done,
    publicBefore,
    publicAfter,
    publicUnchanged,
    schemaDropped,
    ok: done.countsMatch && done.sequencesOk && schemaDropped,
  }
}
