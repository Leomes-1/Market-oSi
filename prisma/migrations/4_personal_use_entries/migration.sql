-- Personal use becomes header + lines, so one registration can hold several
-- products — the same shape as Sale/SaleItem and Supply/SupplyItem.
--
-- Written by hand rather than generated, because the generated version would
-- drop the header-level columns off "PersonalUse" and lose any existing rows.
-- Every legacy row is first lifted into its own single-line registration, so
-- the data survives whether the table is empty or not.

-- 1. The new header table.
CREATE TABLE "PersonalUseEntry" (
    "id" SERIAL NOT NULL,
    "data" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "shenime" TEXT,
    "totali" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonalUseEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PersonalUseEntry_data_idx" ON "PersonalUseEntry"("data");

-- 2. Link column, nullable for now so existing rows can be backfilled.
ALTER TABLE "PersonalUse" ADD COLUMN "entryId" INTEGER;

-- 3. Backfill: one header per existing line, carrying that line's own date,
--    user, note and total. The temporary column is only how the new header is
--    matched back to the line that produced it.
ALTER TABLE "PersonalUseEntry" ADD COLUMN "_legacyLineId" INTEGER;

INSERT INTO "PersonalUseEntry" ("data", "userId", "userEmail", "shenime", "totali", "createdAt", "_legacyLineId")
SELECT pu."data", pu."userId", pu."userEmail", pu."shenime", pu."totali", pu."createdAt", pu."id"
FROM "PersonalUse" pu;

UPDATE "PersonalUse" pu
   SET "entryId" = e."id"
  FROM "PersonalUseEntry" e
 WHERE e."_legacyLineId" = pu."id";

ALTER TABLE "PersonalUseEntry" DROP COLUMN "_legacyLineId";

-- 4. Now that every row has a parent, make the link required.
ALTER TABLE "PersonalUse" ALTER COLUMN "entryId" SET NOT NULL;

ALTER TABLE "PersonalUse" ADD CONSTRAINT "PersonalUse_entryId_fkey"
  FOREIGN KEY ("entryId") REFERENCES "PersonalUseEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "PersonalUse_entryId_idx" ON "PersonalUse"("entryId");

-- 5. These now live on the header. Dropping them is safe only because step 3
--    copied every value up first.
DROP INDEX "PersonalUse_data_idx";
ALTER TABLE "PersonalUse" DROP COLUMN "data";
ALTER TABLE "PersonalUse" DROP COLUMN "userId";
ALTER TABLE "PersonalUse" DROP COLUMN "userEmail";
ALTER TABLE "PersonalUse" DROP COLUMN "shenime";

-- 6. Deny-by-default, matching every other table. Supabase grants anon and
--    authenticated full privileges on public tables, so RLS with no policies
--    is what keeps the public anon key out.
ALTER TABLE "PersonalUseEntry" ENABLE ROW LEVEL SECURITY;
