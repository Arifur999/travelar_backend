-- CreateEnum
CREATE TYPE "AgencyReminderKind" AS ENUM ('TRIAL_ENDING_3_DAYS', 'TRIAL_ENDING_1_DAY', 'SUBSCRIPTION_ENDING_7_DAYS', 'SUBSCRIPTION_ENDING_1_DAY', 'EXPIRED');

-- CreateTable
CREATE TABLE "agency_reminders" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "kind" "AgencyReminderKind" NOT NULL,
    "periodEndsAt" TIMESTAMP(3) NOT NULL,
    "recipients" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agency_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agency_reminders_agencyId_idx" ON "agency_reminders"("agencyId");

-- CreateIndex
CREATE UNIQUE INDEX "agency_reminders_agencyId_kind_periodEndsAt_key" ON "agency_reminders"("agencyId", "kind", "periodEndsAt");

-- AddForeignKey
ALTER TABLE "agency_reminders" ADD CONSTRAINT "agency_reminders_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
