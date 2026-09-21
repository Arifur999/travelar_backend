-- Every plan that exists today was sold as "all the modules we have".
-- Adding two modules must not quietly take them away, so each existing plan
-- keeps what it had plus the new ones. A plan created from here on is whatever
-- the operator configures.
--
-- Separate from the migration that added the enum values on purpose: Postgres
-- refuses to use a value added to an enum in the same transaction.
UPDATE "plans"
SET "features" = "features" || ARRAY['TOURS']::"PlanFeature"[]
WHERE NOT ('TOURS' = ANY ("features"));

UPDATE "plans"
SET "features" = "features" || ARRAY['HOTEL']::"PlanFeature"[]
WHERE NOT ('HOTEL' = ANY ("features"));
