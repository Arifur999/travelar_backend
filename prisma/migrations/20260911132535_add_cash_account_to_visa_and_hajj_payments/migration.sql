/*
  Warnings:

  - Added the required column `cashAccountId` to the `hajj_payments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `cashAccountId` to the `visa_payments` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "hajj_payments" ADD COLUMN     "cashAccountId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "visa_payments" ADD COLUMN     "cashAccountId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "hajj_payments_cashAccountId_idx" ON "hajj_payments"("cashAccountId");

-- CreateIndex
CREATE INDEX "visa_payments_cashAccountId_idx" ON "visa_payments"("cashAccountId");

-- AddForeignKey
ALTER TABLE "hajj_payments" ADD CONSTRAINT "hajj_payments_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visa_payments" ADD CONSTRAINT "visa_payments_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
