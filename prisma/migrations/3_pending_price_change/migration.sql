-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "cmimiBlerjesRi" DOUBLE PRECISION,
ADD COLUMN     "cmimiShitjesRi" DOUBLE PRECISION,
ADD COLUMN     "sasiaVjeter" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "SupplyItem" ADD COLUMN     "cmimiShitjes" DOUBLE PRECISION;

