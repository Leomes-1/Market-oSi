import { Prisma } from '@prisma/client'

/**
 * Catalog helpers shared by snapshot and restore.
 *
 * Everything is read from the live catalog rather than hard-coded, so a table
 * added by a future migration is backed up automatically. The one exclusion is
 * `_prisma_migrations`: it records schema history, not shop data, and a restore
 * must never rewrite it.
 *
 * Every query takes an explicit schema name and quotes every identifier. The
 * dry-run restore relies on that — it runs the same code against
 * `restore_test`, and nothing here may fall back to `public` implicitly.
 */

export type Db = Prisma.TransactionClient

const EXCLUDED_TABLES = ['_prisma_migrations']

/** Double-quotes an SQL identifier. */
export function q(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`
}

/** `"schema"."table"` */
export function qt(schema: string, table: string): string {
  return `${q(schema)}.${q(table)}`
}

/** Single-quotes an SQL string literal. */
export function lit(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/** Business tables in `public`, alphabetical. */
export async function businessTables(db: Db): Promise<string[]> {
  const rows = await db.$queryRaw<{ name: string }[]>`
    SELECT table_name::text AS name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name`
  return rows.map((r) => r.name).filter((name) => !EXCLUDED_TABLES.includes(name))
}

/**
 * Column signature per table, as sorted `name:type` strings. Stored in every
 * snapshot so a restore can refuse a snapshot whose shape no longer matches
 * the live schema — json_populate_recordset would otherwise silently fill a
 * renamed column with NULL.
 */
export async function tableColumns(db: Db, tables: string[]): Promise<Record<string, string[]>> {
  const rows = await db.$queryRaw<{ table: string; column: string; type: string }[]>`
    SELECT table_name::text AS "table", column_name::text AS "column", udt_name::text AS "type"
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ANY(${tables})`
  const columns: Record<string, string[]> = {}
  for (const table of tables) columns[table] = []
  for (const row of rows) columns[row.table].push(`${row.column}:${row.type}`)
  for (const table of tables) columns[table].sort()
  return columns
}

export interface ForeignKey {
  child: string
  parent: string
  childColumns: string[]
  parentColumns: string[]
}

/** Foreign keys between business tables in `public`. */
export async function foreignKeys(db: Db, tables: string[]): Promise<ForeignKey[]> {
  const rows = await db.$queryRaw<ForeignKey[]>`
    SELECT
      child.relname::text AS "child",
      parent.relname::text AS "parent",
      ARRAY(
        SELECT a.attname::text
        FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
        ORDER BY k.ord
      ) AS "childColumns",
      ARRAY(
        SELECT a.attname::text
        FROM unnest(con.confkey) WITH ORDINALITY AS k(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum
        ORDER BY k.ord
      ) AS "parentColumns"
    FROM pg_constraint con
    JOIN pg_class child ON child.oid = con.conrelid
    JOIN pg_class parent ON parent.oid = con.confrelid
    WHERE con.contype = 'f' AND con.connamespace = 'public'::regnamespace`
  return rows.filter((fk) => tables.includes(fk.child) && tables.includes(fk.parent))
}

/**
 * Orders tables so every parent comes before its children. Insert in this
 * order; delete in reverse. Throws on a cycle, which no current schema has.
 */
export function parentsFirst(tables: string[], fks: ForeignKey[]): string[] {
  const ordered: string[] = []
  const remaining = new Set(tables)
  while (remaining.size > 0) {
    const ready = Array.from(remaining)
      .filter((table) =>
        fks.every((fk) => fk.child !== table || fk.parent === table || !remaining.has(fk.parent))
      )
      .sort()
    if (ready.length === 0) {
      throw new Error(`Varësi ciklike mes tabelave: ${Array.from(remaining).join(', ')}`)
    }
    for (const table of ready) {
      ordered.push(table)
      remaining.delete(table)
    }
  }
  return ordered
}

/** Row count per table in `schema`, read in one statement so they agree. */
export async function countRows(
  db: Db,
  schema: string,
  tables: string[]
): Promise<Record<string, number>> {
  const parts = tables.map((t) => `${lit(t)}, (SELECT count(*) FROM ${qt(schema, t)})`)
  const [row] = await db.$queryRawUnsafe<{ counts: string }[]>(
    `SELECT json_build_object(${parts.join(', ')})::text AS counts`
  )
  return JSON.parse(row.counts)
}
