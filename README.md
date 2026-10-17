# Market OS

Shop management system — Next.js 14 (App Router), TypeScript, Prisma, Supabase, deployed on Vercel.

```bash
npm run dev          # local dev server
npm run build        # prisma generate && next build
npm run db:studio    # browse the database
```

Environment variables are listed in `.env.example`. Copy it to `.env` and fill in the values; `.env` is gitignored and must never be committed.

---

## How to change the schema from now on

The database is under Prisma migration control as of `0_init`. Follow these four
steps for **every** schema change — they are the only supported path.

### 1. Edit `prisma/schema.prisma`

Make the model change you want. Nothing has touched the database yet.

### 2. Create the migration

```bash
npx prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel  prisma/schema.prisma \
  --script > prisma/migrations/<next_number>_<short_name>/migration.sql
```

Create the folder first. Name it so it sorts after the last one — `2_…`, `3_…`,
and so on; Prisma applies migrations in lexicographic order.

For something Prisma cannot express — a `CHECK` constraint, a trigger, RLS —
write the SQL by hand in the same file. `1_product_stock_non_negative` is an
example.

### 3. Review the generated SQL

Read it before it ever reaches a database. Check specifically for:

- `DROP` statements you did not intend, especially `DROP INDEX` and `DROP COLUMN`
- a column change that silently discards data (narrowing a type, adding `NOT NULL`
  without a default to a populated table)
- anything touching a table with live rows

If the SQL contains a surprise, the schema is wrong — fix `schema.prisma` and
regenerate rather than hand-editing the output.

### 4. Apply it

```bash
npx prisma migrate status    # must list exactly your new migration as pending
npx prisma migrate deploy    # applies it
npx prisma migrate status    # must then say "Database schema is up to date!"
```

Then confirm the result: re-run the drift check (below) and verify row counts are
what you expect.

---

## Never run these

| Command | Why |
| --- | --- |
| `prisma db push` | Writes schema changes with no migration file, so nothing is recorded or reviewable. **This is what left the database with no migration history in the first place.** The `db:push` npm script has been removed so it cannot be run by accident. |
| `prisma migrate dev` | Intended for a local dev database. It can decide the schema has drifted and offer to reset, which would drop production data. |
| `prisma migrate reset` | Drops and recreates the database. |

`migrate deploy` is the only command that should ever touch the production schema.

## Drift check

Verifies `schema.prisma` and the live database still agree. Safe to run any time —
it reads only.

```bash
npx prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel  prisma/schema.prisma \
  --script
```

`-- This is an empty migration.` means they match. **Any other output is drift**:
something changed the database outside a migration, or `schema.prisma` is missing
something the database has. Reconcile before writing a new migration, or your next
migration will carry the difference along with it.

> Note: `migrate diff` does not see `CHECK` constraints, triggers or RLS — Prisma
> does not model them. An empty diff does not prove those are intact.

## Deployment

Vercel runs `prisma generate && next build`. **No migration runs on deploy** —
that is deliberate. Apply migrations yourself with `migrate deploy` before
deploying code that depends on them, so a schema change is never an invisible
side effect of a push.

Order for a schema-dependent release:

1. `npx prisma migrate deploy`
2. verify with `migrate status` and the drift check
3. merge and let Vercel deploy

## Database notes

- **Row Level Security** is enabled on all 8 tables with **no policies**, which is
  deny-by-default. This is load-bearing: Supabase grants `anon` and
  `authenticated` full table privileges, so without RLS the public anon key would
  expose the whole database through PostgREST. `0_init` re-enables it on a
  from-scratch rebuild.
- The app reads and writes **only through Prisma**, which connects as `postgres`
  (owner, `BYPASSRLS`) and is therefore unaffected by RLS. The Supabase client is
  used for authentication only — never `.from()`, `.rpc()` or storage. If you ever
  add a direct Supabase data query it will silently return zero rows until you
  write a policy for it.
- **`Product.sasia` has a `CHECK (sasia >= 0)` constraint**
  (`Product_sasia_non_negative`). A write that would drive stock negative fails
  with SQLSTATE 23514, which `src/lib/api.ts` turns into a `409 "Stoku nuk mjafton"`.
- **Never insert explicit `id` values.** Doing so does not advance the column's
  sequence and eventually causes duplicate-key failures on insert. This happened
  to `Sale` and `SaleItem` and had to be repaired with `setval`.
