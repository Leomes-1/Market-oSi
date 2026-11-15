-- Lista e blerjeve: one shared shopping list, built on the PC and used on the
-- phone at the market. Additive only — a new table, nothing existing changes,
-- so code that predates this migration keeps working against it.

CREATE TABLE "ShoppingListItem" (
    "id" SERIAL NOT NULL,
    -- NULL for a free-text line (something not in the catalogue).
    "productId" INTEGER,
    "emri" TEXT NOT NULL,
    "njesia" TEXT NOT NULL DEFAULT 'cope',
    "sasia" DOUBLE PRECISION NOT NULL DEFAULT 1,
    -- This list's own price; changing it never touches "Product".
    "cmimiBlerjes" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "blere" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShoppingListItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ShoppingListItem_sasia_non_negative" CHECK ("sasia" >= 0),
    CONSTRAINT "ShoppingListItem_cmimiBlerjes_non_negative" CHECK ("cmimiBlerjes" >= 0)
);

-- One line per product: adding a listed product again adds to its quantity
-- (INSERT ... ON CONFLICT). NULLs never conflict, so free-text lines are
-- unlimited.
CREATE UNIQUE INDEX "ShoppingListItem_productId_key" ON "ShoppingListItem"("productId");

-- Deleting a product keeps its line as free text instead of blocking the
-- delete or losing the line.
ALTER TABLE "ShoppingListItem" ADD CONSTRAINT "ShoppingListItem_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Deny-by-default, matching every other table: the app reaches it only
-- through Prisma (the table owner), never through the Supabase API.
ALTER TABLE "ShoppingListItem" ENABLE ROW LEVEL SECURITY;
