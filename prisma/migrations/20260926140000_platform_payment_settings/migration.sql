-- Where an agency sends a bKash subscription payment, set by the operator from
-- the admin screen rather than from a file on the server.
CREATE TABLE "platform_settings" (
  "id"           TEXT NOT NULL DEFAULT 'singleton',
  "bkashNumber"  TEXT,
  "bkashQrData"  BYTEA,
  "bkashQrType"  TEXT,
  "bkashQrSetAt" TIMESTAMP(3),
  "updatedById"  TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);
