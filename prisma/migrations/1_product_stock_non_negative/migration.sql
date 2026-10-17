-- Product stock can never be negative.
--
-- Negative stock previously reached this table two ways, both now fixed in the
-- application layer: a sale whose quantity was not validated as positive, and
-- deleting a supply whose goods had already been sold. This constraint is the
-- backstop, enforced by the database regardless of which code path writes.
--
-- Verified before adding: zero rows with "sasia" < 0 (min was 0 across 389
-- products). "sasia" is DOUBLE PRECISION NOT NULL — note this also rejects
-- NaN, since NaN >= 0 evaluates false in PostgreSQL.

ALTER TABLE "Product"
  ADD CONSTRAINT "Product_sasia_non_negative" CHECK ("sasia" >= 0);
