-- CreateEnum
CREATE TYPE "TourPackageStatus" AS ENUM ('OPEN', 'CLOSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TourBookingStatus" AS ENUM ('RESERVED', 'CONFIRMED', 'COMPLETED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PlanFeature" ADD VALUE 'TOURS';
ALTER TYPE "PlanFeature" ADD VALUE 'HOTEL';

-- CreateTable
CREATE TABLE "tour_packages" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "departureDate" TIMESTAMP(3),
    "returnDate" TIMESTAMP(3),
    "durationDays" INTEGER,
    "seatCapacity" INTEGER,
    "pricePerPerson" DECIMAL(12,2) NOT NULL,
    "costPerPerson" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "inclusions" TEXT,
    "description" TEXT,
    "status" "TourPackageStatus" NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tour_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tour_bookings" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "leadTraveller" TEXT NOT NULL,
    "travellers" INTEGER NOT NULL DEFAULT 1,
    "sellAmount" DECIMAL(12,2) NOT NULL,
    "costAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "TourBookingStatus" NOT NULL DEFAULT 'RESERVED',
    "note" TEXT,
    "createdById" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tour_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tour_payments" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "cashAccountId" TEXT,
    "fromWallet" BOOLEAN NOT NULL DEFAULT false,
    "reference" TEXT,
    "note" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tour_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tour_status_history" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "fromStatus" "TourBookingStatus",
    "toStatus" "TourBookingStatus" NOT NULL,
    "note" TEXT,
    "changedById" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tour_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tour_packages_agencyId_idx" ON "tour_packages"("agencyId");

-- CreateIndex
CREATE INDEX "tour_packages_agencyId_isDeleted_idx" ON "tour_packages"("agencyId", "isDeleted");

-- CreateIndex
CREATE INDEX "tour_packages_agencyId_status_idx" ON "tour_packages"("agencyId", "status");

-- CreateIndex
CREATE INDEX "tour_packages_agencyId_isDeleted_createdAt_idx" ON "tour_packages"("agencyId", "isDeleted", "createdAt");

-- CreateIndex
CREATE INDEX "tour_bookings_agencyId_idx" ON "tour_bookings"("agencyId");

-- CreateIndex
CREATE INDEX "tour_bookings_agencyId_isDeleted_idx" ON "tour_bookings"("agencyId", "isDeleted");

-- CreateIndex
CREATE INDEX "tour_bookings_agencyId_status_idx" ON "tour_bookings"("agencyId", "status");

-- CreateIndex
CREATE INDEX "tour_bookings_packageId_idx" ON "tour_bookings"("packageId");

-- CreateIndex
CREATE INDEX "tour_bookings_customerId_idx" ON "tour_bookings"("customerId");

-- CreateIndex
CREATE INDEX "tour_bookings_agencyId_isDeleted_createdAt_idx" ON "tour_bookings"("agencyId", "isDeleted", "createdAt");

-- CreateIndex
CREATE INDEX "tour_payments_bookingId_idx" ON "tour_payments"("bookingId");

-- CreateIndex
CREATE INDEX "tour_payments_agencyId_idx" ON "tour_payments"("agencyId");

-- CreateIndex
CREATE INDEX "tour_payments_cashAccountId_idx" ON "tour_payments"("cashAccountId");

-- CreateIndex
CREATE INDEX "tour_status_history_bookingId_idx" ON "tour_status_history"("bookingId");

-- CreateIndex
CREATE INDEX "tour_status_history_agencyId_idx" ON "tour_status_history"("agencyId");

-- AddForeignKey
ALTER TABLE "tour_packages" ADD CONSTRAINT "tour_packages_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tour_packages" ADD CONSTRAINT "tour_packages_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tour_bookings" ADD CONSTRAINT "tour_bookings_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tour_bookings" ADD CONSTRAINT "tour_bookings_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "tour_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tour_payments" ADD CONSTRAINT "tour_payments_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "tour_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tour_payments" ADD CONSTRAINT "tour_payments_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tour_status_history" ADD CONSTRAINT "tour_status_history_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "tour_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
