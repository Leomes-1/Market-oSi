-- POS tiles chosen by an admin ("+ Shto produkt"). Additive only: one column
-- with a default, so existing rows read false and code that predates this
-- migration keeps working against it.
ALTER TABLE "Product" ADD COLUMN "neArke" BOOLEAN NOT NULL DEFAULT false;
