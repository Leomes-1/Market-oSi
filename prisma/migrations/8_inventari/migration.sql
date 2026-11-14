-- Inventari: invoiced ("Me TVSH") stock. Additive only — new columns with
-- defaults, so every existing row reads "nothing invoiced" and code that
-- predates this migration keeps working against it.

-- How many of a product's units on hand came in on a "Me TVSH" supply.
-- Sales and personal use take these units first. Never negative, never more
-- than the total stock: both are enforced here, not only in the API. Every
-- write that lowers "sasia" lowers this counter in the same statement, since a
-- CHECK is evaluated per statement.
ALTER TABLE "Product" ADD COLUMN "sasiaFaturuar" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Product"
  ADD CONSTRAINT "Product_sasiaFaturuar_non_negative" CHECK ("sasiaFaturuar" >= 0);
ALTER TABLE "Product"
  ADD CONSTRAINT "Product_sasiaFaturuar_max_sasia" CHECK ("sasiaFaturuar" <= "sasia");

-- The supply came with a VAT invoice; its optional invoice number.
ALTER TABLE "Supply" ADD COLUMN "meTvsh" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Supply" ADD COLUMN "nrFatures" TEXT;

-- Units of each line that were taken from invoiced stock, so deleting or
-- editing the sale / personal-use entry gives them back.
ALTER TABLE "SaleItem" ADD COLUMN "sasiaFaturuar" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "PersonalUse" ADD COLUMN "sasiaFaturuar" DOUBLE PRECISION NOT NULL DEFAULT 0;
