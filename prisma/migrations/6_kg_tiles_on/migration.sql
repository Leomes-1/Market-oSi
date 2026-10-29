-- Every POS tile is now just a product with "neArke" = true, so kg products
-- (shown automatically until now) are switched on once here. From now on an
-- admin can take any of them off with ×; new kg products start on (API).
-- Data only: no schema change.
UPDATE "Product" SET "neArke" = true WHERE njesia = 'kg';
