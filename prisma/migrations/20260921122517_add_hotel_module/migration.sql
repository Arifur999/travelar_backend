-- CreateEnum
CREATE TYPE "HotelBookingStatus" AS ENUM ('RESERVED', 'CONFIRMED', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "hotel_bookings" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "hotelName" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "country" TEXT,
    "bookedThrough" TEXT,
    "confirmationNo" TEXT,
    "guestName" TEXT NOT NULL,
    "checkIn" TIMESTAMP(3) NOT NULL,
    "checkOut" TIMESTAMP(3) NOT NULL,
    "rooms" INTEGER NOT NULL DEFAULT 1,
    "guests" INTEGER NOT NULL DEFAULT 1,
    "roomType" TEXT,
    "sellAmount" DECIMAL(12,2) NOT NULL,
    "costAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "HotelBookingStatus" NOT NULL DEFAULT 'RESERVED',
    "note" TEXT,
    "createdById" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hotel_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_payments" (
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

    CONSTRAINT "hotel_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_status_history" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "fromStatus" "HotelBookingStatus",
    "toStatus" "HotelBookingStatus" NOT NULL,
    "note" TEXT,
    "changedById" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hotel_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hotel_bookings_agencyId_idx" ON "hotel_bookings"("agencyId");

-- CreateIndex
CREATE INDEX "hotel_bookings_agencyId_isDeleted_idx" ON "hotel_bookings"("agencyId", "isDeleted");

-- CreateIndex
CREATE INDEX "hotel_bookings_agencyId_status_idx" ON "hotel_bookings"("agencyId", "status");

-- CreateIndex
CREATE INDEX "hotel_bookings_agencyId_checkIn_idx" ON "hotel_bookings"("agencyId", "checkIn");

-- CreateIndex
CREATE INDEX "hotel_bookings_customerId_idx" ON "hotel_bookings"("customerId");

-- CreateIndex
CREATE INDEX "hotel_bookings_agencyId_isDeleted_createdAt_idx" ON "hotel_bookings"("agencyId", "isDeleted", "createdAt");

-- CreateIndex
CREATE INDEX "hotel_payments_bookingId_idx" ON "hotel_payments"("bookingId");

-- CreateIndex
CREATE INDEX "hotel_payments_agencyId_idx" ON "hotel_payments"("agencyId");

-- CreateIndex
CREATE INDEX "hotel_payments_cashAccountId_idx" ON "hotel_payments"("cashAccountId");

-- CreateIndex
CREATE INDEX "hotel_status_history_bookingId_idx" ON "hotel_status_history"("bookingId");

-- CreateIndex
CREATE INDEX "hotel_status_history_agencyId_idx" ON "hotel_status_history"("agencyId");

-- AddForeignKey
ALTER TABLE "hotel_bookings" ADD CONSTRAINT "hotel_bookings_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_bookings" ADD CONSTRAINT "hotel_bookings_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_payments" ADD CONSTRAINT "hotel_payments_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "hotel_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_payments" ADD CONSTRAINT "hotel_payments_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_status_history" ADD CONSTRAINT "hotel_status_history_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "hotel_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
