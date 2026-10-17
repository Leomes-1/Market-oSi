-- CreateTable
CREATE TABLE "Supplier" (
    "id" SERIAL NOT NULL,
    "emri" TEXT NOT NULL,
    "telefoni" TEXT,
    "email" TEXT,
    "adresa" TEXT,
    "shenime" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" SERIAL NOT NULL,
    "emri" TEXT NOT NULL,
    "kategoria" TEXT NOT NULL,
    "sasia" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "stokuMinimal" DOUBLE PRECISION NOT NULL DEFAULT 5,
    "cmimiBlerjes" DOUBLE PRECISION NOT NULL,
    "cmimiShitjes" DOUBLE PRECISION NOT NULL,
    "njesia" TEXT NOT NULL DEFAULT 'cope',
    "furnitorId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supply" (
    "id" SERIAL NOT NULL,
    "furnitorId" INTEGER,
    "data" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shenime" TEXT,
    "totali" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Supply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyItem" (
    "id" SERIAL NOT NULL,
    "supplyId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "emriProduktit" TEXT NOT NULL,
    "sasia" DOUBLE PRECISION NOT NULL,
    "njesia" TEXT NOT NULL,
    "cmimiBlerjes" DOUBLE PRECISION NOT NULL,
    "totali" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "SupplyItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductBarcode" (
    "id" SERIAL NOT NULL,
    "barcode" TEXT NOT NULL,
    "productId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductBarcode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sale" (
    "id" SERIAL NOT NULL,
    "totali" DOUBLE PRECISION NOT NULL,
    "fitimi" DOUBLE PRECISION NOT NULL,
    "shenime" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleItem" (
    "id" SERIAL NOT NULL,
    "saleId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "emriProduktit" TEXT NOT NULL,
    "sasia" DOUBLE PRECISION NOT NULL,
    "cmimiBlerjes" DOUBLE PRECISION NOT NULL,
    "cmimiShitjes" DOUBLE PRECISION NOT NULL,
    "fitimi" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "SaleItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "roli" TEXT NOT NULL DEFAULT 'staff',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Product_furnitorId_idx" ON "Product"("furnitorId");

-- CreateIndex
CREATE INDEX "Supply_furnitorId_idx" ON "Supply"("furnitorId");

-- CreateIndex
CREATE INDEX "SupplyItem_supplyId_idx" ON "SupplyItem"("supplyId");

-- CreateIndex
CREATE INDEX "SupplyItem_productId_idx" ON "SupplyItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductBarcode_barcode_key" ON "ProductBarcode"("barcode");

-- CreateIndex
CREATE INDEX "ProductBarcode_productId_idx" ON "ProductBarcode"("productId");

-- CreateIndex
CREATE INDEX "SaleItem_saleId_idx" ON "SaleItem"("saleId");

-- CreateIndex
CREATE INDEX "SaleItem_productId_idx" ON "SaleItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "UserRole_userId_key" ON "UserRole"("userId");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_furnitorId_fkey" FOREIGN KEY ("furnitorId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supply" ADD CONSTRAINT "Supply_furnitorId_fkey" FOREIGN KEY ("furnitorId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyItem" ADD CONSTRAINT "SupplyItem_supplyId_fkey" FOREIGN KEY ("supplyId") REFERENCES "Supply"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyItem" ADD CONSTRAINT "SupplyItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductBarcode" ADD CONSTRAINT "ProductBarcode_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security
--
-- RLS is enabled on every table with NO policies, which is deny-by-default.
-- This matters because Supabase grants anon and authenticated full
-- SELECT/INSERT/UPDATE/DELETE on public tables, so without RLS the public
-- anon key would expose the whole database through PostgREST.
--
-- The application is unaffected: it reaches the database only through Prisma,
-- which connects as `postgres` — a role that both owns these tables and has
-- BYPASSRLS. The Supabase client is used for auth only, never for data.
--
-- Prisma does not model RLS, so these statements are appended by hand and must
-- be kept here for a from-scratch rebuild to be secure.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "Supplier"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Product"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductBarcode" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Sale"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SaleItem"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Supply"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupplyItem"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserRole"       ENABLE ROW LEVEL SECURITY;
