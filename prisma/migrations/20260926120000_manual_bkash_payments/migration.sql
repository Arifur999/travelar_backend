-- An agency can pay by bKash and say so, and an operator reads the receipt.
-- The order sits PENDING until then: nothing the agency types activates a plan.
CREATE TYPE "PaymentChannel" AS ENUM ('GATEWAY', 'BKASH_MANUAL');

ALTER TABLE "subscription_orders"
  ADD COLUMN "channel" "PaymentChannel" NOT NULL DEFAULT 'GATEWAY',
  ADD COLUMN "senderNumber" TEXT,
  ADD COLUMN "senderReference" TEXT,
  ADD COLUMN "reviewedById" TEXT,
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "reviewNote" TEXT;

-- A receipt can only be spent once. Nulls do not collide in Postgres, so every
-- gateway order is unaffected.
CREATE UNIQUE INDEX "subscription_orders_senderReference_key"
  ON "subscription_orders"("senderReference");

CREATE INDEX "subscription_orders_channel_status_createdAt_idx"
  ON "subscription_orders"("channel", "status", "createdAt");
