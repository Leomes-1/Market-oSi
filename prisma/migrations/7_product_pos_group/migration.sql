-- POS tile group chosen by an admin. Additive only: one nullable column, so
-- existing rows read NULL ("automatic") and code that predates this
-- migration keeps working against it. Allowed values are checked by the API.
ALTER TABLE "Product" ADD COLUMN "grupiArke" TEXT;
