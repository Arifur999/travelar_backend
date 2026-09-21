-- AlterTable
ALTER TABLE "hajj_payments" ADD COLUMN     "fromWallet" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "cashAccountId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ticket_payments" ADD COLUMN     "fromWallet" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "cashAccountId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "visa_payments" ADD COLUMN     "fromWallet" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "cashAccountId" DROP NOT NULL;

