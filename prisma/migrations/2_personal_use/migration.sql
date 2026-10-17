-- CreateTable
CREATE TABLE "PersonalUse" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "emriProduktit" TEXT NOT NULL,
    "sasia" DOUBLE PRECISION NOT NULL,
    "njesia" TEXT NOT NULL,
    "cmimiBlerjes" DOUBLE PRECISION NOT NULL,
    "totali" DOUBLE PRECISION NOT NULL,
    "data" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "shenime" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonalUse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PersonalUse_productId_idx" ON "PersonalUse"("productId");

-- CreateIndex
CREATE INDEX "PersonalUse_data_idx" ON "PersonalUse"("data");

-- AddForeignKey
ALTER TABLE "PersonalUse" ADD CONSTRAINT "PersonalUse_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Deny-by-default, matching every other table. Supabase grants anon and
-- authenticated full privileges on public tables, so RLS with no policies is
-- what keeps the public anon key out. Prisma connects as postgres (owner,
-- BYPASSRLS) and is unaffected.
ALTER TABLE "PersonalUse" ENABLE ROW LEVEL SECURITY;
