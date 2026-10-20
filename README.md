# Market OS

Shop management system — Next.js 14 (App Router), TypeScript, Prisma, Supabase, deployed on Vercel.

```bash
npm run dev          # local dev server
npm run build        # prisma generate && next build
npm run db:studio    # browse the database
```

Environment variables are listed in `.env.example`. Copy it to `.env` and fill in the values; `.env` is gitignored and must never be committed.

---

## The 2026-10-17 incident

On 2026-10-17 at about 23:55 UTC the production database was wiped by running:

```bash
npx prisma migrate diff ... --shadow-database-url $DIRECT_URL --script
```

to check a hand-written migration. **Prisma resets whatever database
`--shadow-database-url` names.** It dropped every table in production, replayed the
migration files into it, and then printed `-- This is an empty migration.` That
looks like a passing check, but it only meant the schema had just been rebuilt from
those files.

The database was restored on 2026-10-18 from a backup about 18 hours old, plus a
catalogue export cached in the browser. **7 `Sale` rows and 10 `SaleItem` rows from
2026-10-17 are gone for good.** If October 2026 sales are missing, that is why; it is
not a new bug.

The lesson: a Prisma subcommand's name tells you nothing about whether it is safe.
`migrate diff` sounds read-only, but one flag makes it destructive. The rules below
come from that.

## Database rules

These apply to everyone working on the repo, human or AI assistant.

1. **Every write to the database needs the owner's explicit OK**, and the exact SQL
   or command is shown to them first. That covers schema changes, data fixes,
   `setval`, and the `db:seed` / `db:migrate` scripts. Read-only queries need no
   approval.
2. **Show the full text of any script before running it against the database**,
   even a read-only one, and wait for approval. "It's read-only" is not a reason to
   skip this.
3. **The only Prisma commands that may touch the production schema are
   `migrate deploy` and `migrate resolve`**, and only after the command has been
   shown and approved.
4. **Take a `pg_dump` into `recovery/` before any schema change** (see below).
   `recovery/` is gitignored; dumps contain business data and must never be
   committed.
5. **Never point any tool at a Supabase URL in order to test or validate.** Validate
   against a throwaway local Postgres instead.

## Never run these

| Command | Why |
| --- | --- |
| anything with `--shadow-database-url` | Prisma **drops and rebuilds** the database it names. Pointed at `DIRECT_URL`, this is what wiped production on 2026-10-17. |
| `prisma migrate diff` | Banned in every form, including the variants without the shadow flag that earlier versions of this README called "safe". One flag is all it takes to make it destructive, so the whole subcommand is off limits. |
| `prisma db push` | Writes schema changes with no migration file, so nothing is recorded or reviewable. This is what left the database with no migration history in the first place. The `db:push` npm script has been removed so it cannot be run by accident. |
| `prisma migrate dev` | Intended for a local dev database. It can decide the schema has drifted and offer to reset, which would drop production data. |
| `prisma migrate reset` | Drops and recreates the database. |

**Production and local development share one database.** `DATABASE_URL` and
`DIRECT_URL` in your `.env` point at production, so any "local" command run against
them runs against production.

---

## How to change the schema

The database is under Prisma migration control. `_prisma_migrations` records
`0_init` through `4_personal_use_entries`. Follow these steps for **every** schema
change; they are the only supported path.

### 1. Back up production

```bash
"C:\Program Files\PostgreSQL\17\bin\pg_dump" --dbname "$DIRECT_URL" \
  --format custom --file recovery/<yyyy-mm-dd>_before_<short_name>.dump
```

Check that the file exists and is not empty before going on. Without a fresh dump,
the only fallback is Supabase's backup, which can be many hours old.

### 2. Edit `prisma/schema.prisma`

Make the model change you want. Nothing has touched the database yet.

### 3. Write the migration by hand

Create `prisma/migrations/<next_number>_<short_name>/migration.sql` and write the
SQL yourself. Name the folder so it sorts after the last one (`5_…`, `6_…`, and so
on); Prisma applies migrations in lexicographic order. Use the existing migrations
as templates. `1_product_stock_non_negative` shows a `CHECK` constraint, and
`4_personal_use_entries` shows a table split that moves data.

### 4. Review the SQL against the schema

Read it line by line against your `schema.prisma` change. Check specifically for:

- `DROP` statements you did not intend, especially `DROP INDEX` and `DROP COLUMN`
- a column change that silently discards data (narrowing a type, adding `NOT NULL`
  without a default to a populated table)
- anything touching a table with live rows
- a new table without `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` (see Database
  notes)

### 5. Test it on a throwaway local Postgres

Create an empty local database (never a Supabase URL), point the env variables at
it **in this shell only**, and apply every migration from scratch:

```bash
createdb market_os_scratch
DATABASE_URL=postgresql://postgres@localhost:5432/market_os_scratch \
DIRECT_URL=postgresql://postgres@localhost:5432/market_os_scratch \
  npx prisma migrate deploy
```

Check the command line twice: both URLs must say `localhost`. If the migration
fails here, fix it before going any further. Drop the scratch database when you are
done.

### 6. Apply it to production

Show the commands and get approval first, then run:

```bash
npx prisma migrate status    # must list exactly your new migration as pending
npx prisma migrate deploy    # applies it
npx prisma migrate status    # must then say "Database schema is up to date!"
```

Then confirm the result: run the drift check (below) and verify row counts are what
you expect.

**If the migration drops or renames a column that the code on `main` still reads,
merge and deploy the matching code immediately after applying it.** Production and
local share one database, so the live app breaks from the moment the column is gone
until the new code is deployed. `4_personal_use_entries` was handled this way.

## Drift check

Verifies that the production schema still matches what the migration files produce.
It only reads from production.

```bash
# production schema, read only
"C:\Program Files\PostgreSQL\17\bin\pg_dump" --dbname "$DIRECT_URL" \
  --schema-only --schema public --no-owner --no-privileges --file recovery/prod_schema.sql

# schema built from the migrations on a scratch local database (step 5 above)
"C:\Program Files\PostgreSQL\17\bin\pg_dump" \
  --dbname postgresql://postgres@localhost:5432/market_os_scratch \
  --schema-only --schema public --no-owner --no-privileges --file recovery/migrations_schema.sql

diff recovery/prod_schema.sql recovery/migrations_schema.sql
```

Leave out `_prisma_migrations` rows when you compare. Any other difference is drift:
something changed the database outside a migration. Reconcile it before writing a
new migration, or your next migration will carry the difference along with it.
Unlike Prisma's own diff, this also shows `CHECK` constraints, triggers and RLS.

## Deployment

Vercel runs `prisma generate && next build`. **No migration runs on deploy**, and
that is deliberate. Apply migrations yourself with `migrate deploy` before deploying
code that depends on them, so a schema change is never an invisible side effect of
a push.

Order for a schema-dependent release:

1. back up with `pg_dump`, then `npx prisma migrate deploy` (after approval)
2. verify with `migrate status` and the drift check
3. merge and let Vercel deploy, immediately if a column was dropped

## Database notes

- **Row Level Security** is enabled on every table in `public` with **no
  policies**, which is deny-by-default. That covers all 10 model tables and
  `_prisma_migrations`, which Prisma creates without RLS, so it had to be enabled
  by hand. This is load-bearing: Supabase grants `anon` and `authenticated` full
  table privileges, so without RLS the public anon key would expose the whole
  database through PostgREST. `0_init` re-enables it on a from-scratch rebuild,
  and every new table needs RLS enabled in its own migration.
- The app reads and writes **only through Prisma**, which connects as `postgres`
  (owner, `BYPASSRLS`) and is therefore unaffected by RLS. The Supabase client is
  used for authentication, plus Storage for backups only (see Backups below) —
  never `.from()` or `.rpc()`. If you ever add a direct Supabase data query it
  will silently return zero rows until you write a policy for it.
- **`Product.sasia` has a `CHECK (sasia >= 0)` constraint**
  (`Product_sasia_non_negative`). A write that would drive stock negative fails
  with SQLSTATE 23514, which `src/lib/api.ts` turns into a `409 "Stoku nuk mjafton"`.
- **Never insert explicit `id` values.** Doing so does not advance the column's
  sequence and eventually causes duplicate-key failures on insert. This happened
  to `Sale` and `SaleItem` and had to be repaired with `setval`. The 2026-10-18
  recovery inserted explicit ids into `Product` and `ProductBarcode`, and both
  sequences were advanced past `MAX(id)` afterwards. If you ever have to restore
  rows with their original ids, run `setval` afterwards (with approval).

## Backups

In-app snapshots with point-in-time restore, managed from **Backup & Rikthim**
(`/backup`, admin only). The code is in `src/lib/backups/`.

- **What a snapshot is:** every row of every business table in `public` (all
  tables except `_prisma_migrations`), as gzipped JSON in the private Supabase
  Storage bucket `backups`, at `snapshots/YYYY-MM-DD/HHmmss.json.gz` (UTC). The
  time, type and per-table row counts are stored as the object's metadata, and
  the list is read from `storage.objects`, so it survives even if the `public`
  tables are wiped. That is also why `pg_dump --schema public` is not a substitute:
  take a full dump before schema work, as described above.
- **When:** after every successful write (`scheduleSnapshot()`, run via
  `waitUntil` after the response, never able to fail the request). At most one
  automatic snapshot per minute: a later write in the same minute replaces that
  minute's automatic snapshot, so the latest state is always captured. Manual
  ("Bëj backup tani") and pre-restore snapshots are never replaced.
- **Retention**, applied after each snapshot: everything for 48 h, then the
  newest per hour up to 7 days, then the newest per Albania calendar day up to
  30 days, then deleted. Pre-restore snapshots are kept whole for 30 days.
- **Failures** are logged and written to `status/last-failure.json` in the
  bucket; the backup page shows a warning until a newer snapshot succeeds.
- **Configuration:** `SUPABASE_SERVICE_ROLE_KEY` (server only, never
  `NEXT_PUBLIC_`) in `.env` and in Vercel. Without it, backups are off and the
  page says so. The bucket is created private on first use, and the code refuses
  to upload if it is ever made public.

### Restoring

- **"Rikthe këtu"** replaces all business tables with the snapshot, in one
  transaction: lock the tables, capture and upload a pre-restore snapshot, delete
  children first, insert parents first with original ids, `setval` every
  sequence to `MAX(id)`, keep the restoring admin as admin, and verify row counts
  and sequences, rolling back on any mismatch. Auth (`auth` schema) is never
  touched. A snapshot whose columns no longer match the live schema (taken before
  a migration) is refused. This is a production write: the database rules above
  apply, including a `pg_dump` first.
- **"Provë (dry run)"** runs the same restore code against a temporary schema
  `restore_test`, then drops it, and the whole transaction is always rolled
  back. It never writes `public` and uploads nothing. Use it before any real
  restore.
