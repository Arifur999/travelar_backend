-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'AGENCY_ADMIN', 'AGENCY_STAFF');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'BLOCKED', 'DELETED');

-- CreateEnum
CREATE TYPE "AgencyStatus" AS ENUM ('TRIAL', 'ACTIVE', 'EXPIRED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "PlanFeature" AS ENUM ('TICKETING', 'VISA', 'HAJJ_UMRAH', 'REPORTS');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('ISSUED', 'REISSUED', 'REFUNDED', 'VOID');

-- CreateEnum
CREATE TYPE "VisaStatus" AS ENUM ('SUBMITTED', 'PROCESSING', 'APPROVED', 'REJECTED', 'DELIVERED');

-- CreateEnum
CREATE TYPE "HajjBookingStatus" AS ENUM ('RESERVED', 'CONFIRMED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "HajjPackageType" AS ENUM ('HAJJ', 'UMRAH');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'RECEIVED', 'VERIFIED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'CARD', 'MOBILE_BANKING', 'CHEQUE', 'OTHER');

-- CreateEnum
CREATE TYPE "SubscriptionOrderStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "HajjTier" AS ENUM ('ECONOMY', 'PREMIUM', 'VIP');

-- CreateEnum
CREATE TYPE "HajjMealPlan" AS ENUM ('NONE', 'BREAKFAST', 'FULL_BOARD');

-- CreateEnum
CREATE TYPE "HajjBatchStatus" AS ENUM ('OPEN', 'FULL', 'DEPARTED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "HajjHotelType" AS ENUM ('MAKKAH', 'MADINAH');

-- CreateTable
CREATE TABLE "agencies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "logo" TEXT,
    "status" "AgencyStatus" NOT NULL DEFAULT 'TRIAL',
    "trialEndsAt" TIMESTAMP(3),
    "subscriptionEndsAt" TIMESTAMP(3),
    "planId" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(12,2) NOT NULL,
    "durationDays" INTEGER NOT NULL DEFAULT 30,
    "features" "PlanFeature"[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "role" "Role" NOT NULL DEFAULT 'AGENCY_STAFF',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "needPasswordChange" BOOLEAN NOT NULL DEFAULT false,
    "agencyId" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verifications" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_orders" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "transactionId" TEXT NOT NULL,
    "sslcommerzSessionKey" TEXT,
    "sslcommerzValId" TEXT,
    "status" "SubscriptionOrderStatus" NOT NULL DEFAULT 'PENDING',
    "paymentMethod" TEXT,
    "rawGatewayResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_payments" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'BANK_TRANSFER',
    "reference" TEXT,
    "note" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "passportNo" TEXT,
    "address" TEXT,
    "note" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hajj_packages" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "HajjPackageType" NOT NULL,
    "tier" "HajjTier" NOT NULL DEFAULT 'ECONOMY',
    "price" DECIMAL(12,2) NOT NULL,
    "durationDays" INTEGER,
    "makkahHotel" TEXT,
    "makkahDistance" TEXT,
    "madinahHotel" TEXT,
    "madinahDistance" TEXT,
    "muallim" TEXT,
    "mealPlan" "HajjMealPlan" NOT NULL DEFAULT 'NONE',
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hajj_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hajj_batches" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "departureDate" TIMESTAMP(3) NOT NULL,
    "returnDate" TIMESTAMP(3),
    "seatCapacity" INTEGER NOT NULL,
    "status" "HajjBatchStatus" NOT NULL DEFAULT 'OPEN',
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hajj_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hajj_rooms" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "hotelType" "HajjHotelType" NOT NULL,
    "roomNumber" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hajj_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hajj_bookings" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "pilgrimName" TEXT NOT NULL,
    "passportNumber" TEXT,
    "munajjimNumber" TEXT,
    "packagePrice" DECIMAL(12,2) NOT NULL,
    "status" "HajjBookingStatus" NOT NULL DEFAULT 'RESERVED',
    "makkahRoomId" TEXT,
    "madinahRoomId" TEXT,
    "createdById" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hajj_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hajj_payments" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "transactionRef" TEXT,
    "note" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hajj_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hajj_documents" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "fileUrl" TEXT,
    "originalName" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "receivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hajj_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hajj_status_history" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "fromStatus" "HajjBookingStatus",
    "toStatus" "HajjBookingStatus" NOT NULL,
    "note" TEXT,
    "changedById" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hajj_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "passengerName" TEXT NOT NULL,
    "pnr" TEXT NOT NULL,
    "airline" TEXT NOT NULL,
    "supplier" TEXT,
    "routeFrom" TEXT,
    "routeTo" TEXT,
    "travelDate" TIMESTAMP(3),
    "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fare" DECIMAL(12,2) NOT NULL,
    "cost" DECIMAL(12,2) NOT NULL,
    "profit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "TicketStatus" NOT NULL DEFAULT 'ISSUED',
    "refundAmount" DECIMAL(12,2),
    "createdById" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_payments" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "reference" TEXT,
    "note" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_documents" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_status_history" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "fromStatus" "TicketStatus",
    "toStatus" "TicketStatus" NOT NULL,
    "note" TEXT,
    "changedById" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visa_agents" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT,
    "contact" TEXT,
    "email" TEXT,
    "address" TEXT,
    "note" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visa_agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visa_cases" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "visaAgentId" TEXT,
    "country" TEXT NOT NULL,
    "visaType" TEXT NOT NULL,
    "applicationNo" TEXT,
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "serviceFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "embassyFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "VisaStatus" NOT NULL DEFAULT 'SUBMITTED',
    "rejectionNote" TEXT,
    "createdById" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visa_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visa_payments" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "visaCaseId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "reference" TEXT,
    "note" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visa_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visa_documents" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "visaCaseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "fileUrl" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visa_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visa_status_history" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "visaCaseId" TEXT NOT NULL,
    "fromStatus" "VisaStatus",
    "toStatus" "VisaStatus" NOT NULL,
    "note" TEXT,
    "changedById" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visa_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agencies_planId_idx" ON "agencies"("planId");

-- CreateIndex
CREATE INDEX "agencies_status_idx" ON "agencies"("status");

-- CreateIndex
CREATE UNIQUE INDEX "plans_name_key" ON "plans"("name");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_agencyId_idx" ON "users"("agencyId");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "accounts_userId_idx" ON "accounts"("userId");

-- CreateIndex
CREATE INDEX "verifications_identifier_idx" ON "verifications"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_orders_transactionId_key" ON "subscription_orders"("transactionId");

-- CreateIndex
CREATE INDEX "subscription_orders_agencyId_idx" ON "subscription_orders"("agencyId");

-- CreateIndex
CREATE INDEX "subscription_orders_planId_idx" ON "subscription_orders"("planId");

-- CreateIndex
CREATE INDEX "subscription_orders_status_idx" ON "subscription_orders"("status");

-- CreateIndex
CREATE INDEX "subscription_payments_agencyId_idx" ON "subscription_payments"("agencyId");

-- CreateIndex
CREATE INDEX "customers_agencyId_idx" ON "customers"("agencyId");

-- CreateIndex
CREATE INDEX "customers_agencyId_isDeleted_idx" ON "customers"("agencyId", "isDeleted");

-- CreateIndex
CREATE INDEX "customers_phone_idx" ON "customers"("phone");

-- CreateIndex
CREATE INDEX "hajj_packages_agencyId_idx" ON "hajj_packages"("agencyId");

-- CreateIndex
CREATE INDEX "hajj_packages_agencyId_isDeleted_idx" ON "hajj_packages"("agencyId", "isDeleted");

-- CreateIndex
CREATE INDEX "hajj_batches_agencyId_idx" ON "hajj_batches"("agencyId");

-- CreateIndex
CREATE INDEX "hajj_batches_packageId_idx" ON "hajj_batches"("packageId");

-- CreateIndex
CREATE INDEX "hajj_batches_agencyId_isDeleted_idx" ON "hajj_batches"("agencyId", "isDeleted");

-- CreateIndex
CREATE INDEX "hajj_rooms_agencyId_idx" ON "hajj_rooms"("agencyId");

-- CreateIndex
CREATE INDEX "hajj_rooms_batchId_idx" ON "hajj_rooms"("batchId");

-- CreateIndex
CREATE INDEX "hajj_bookings_agencyId_idx" ON "hajj_bookings"("agencyId");

-- CreateIndex
CREATE INDEX "hajj_bookings_agencyId_isDeleted_idx" ON "hajj_bookings"("agencyId", "isDeleted");

-- CreateIndex
CREATE INDEX "hajj_bookings_batchId_idx" ON "hajj_bookings"("batchId");

-- CreateIndex
CREATE INDEX "hajj_bookings_packageId_idx" ON "hajj_bookings"("packageId");

-- CreateIndex
CREATE INDEX "hajj_bookings_customerId_idx" ON "hajj_bookings"("customerId");

-- CreateIndex
CREATE INDEX "hajj_bookings_makkahRoomId_idx" ON "hajj_bookings"("makkahRoomId");

-- CreateIndex
CREATE INDEX "hajj_bookings_madinahRoomId_idx" ON "hajj_bookings"("madinahRoomId");

-- CreateIndex
CREATE INDEX "hajj_payments_bookingId_idx" ON "hajj_payments"("bookingId");

-- CreateIndex
CREATE INDEX "hajj_payments_agencyId_idx" ON "hajj_payments"("agencyId");

-- CreateIndex
CREATE INDEX "hajj_documents_bookingId_idx" ON "hajj_documents"("bookingId");

-- CreateIndex
CREATE INDEX "hajj_documents_agencyId_idx" ON "hajj_documents"("agencyId");

-- CreateIndex
CREATE INDEX "hajj_status_history_bookingId_idx" ON "hajj_status_history"("bookingId");

-- CreateIndex
CREATE INDEX "hajj_status_history_agencyId_idx" ON "hajj_status_history"("agencyId");

-- CreateIndex
CREATE INDEX "tickets_agencyId_idx" ON "tickets"("agencyId");

-- CreateIndex
CREATE INDEX "tickets_agencyId_isDeleted_idx" ON "tickets"("agencyId", "isDeleted");

-- CreateIndex
CREATE INDEX "tickets_agencyId_status_idx" ON "tickets"("agencyId", "status");

-- CreateIndex
CREATE INDEX "tickets_customerId_idx" ON "tickets"("customerId");

-- CreateIndex
CREATE INDEX "tickets_pnr_idx" ON "tickets"("pnr");

-- CreateIndex
CREATE INDEX "tickets_travelDate_idx" ON "tickets"("travelDate");

-- CreateIndex
CREATE INDEX "ticket_payments_ticketId_idx" ON "ticket_payments"("ticketId");

-- CreateIndex
CREATE INDEX "ticket_payments_agencyId_idx" ON "ticket_payments"("agencyId");

-- CreateIndex
CREATE INDEX "ticket_documents_ticketId_idx" ON "ticket_documents"("ticketId");

-- CreateIndex
CREATE INDEX "ticket_documents_agencyId_idx" ON "ticket_documents"("agencyId");

-- CreateIndex
CREATE INDEX "ticket_status_history_ticketId_idx" ON "ticket_status_history"("ticketId");

-- CreateIndex
CREATE INDEX "ticket_status_history_agencyId_idx" ON "ticket_status_history"("agencyId");

-- CreateIndex
CREATE INDEX "visa_agents_agencyId_idx" ON "visa_agents"("agencyId");

-- CreateIndex
CREATE INDEX "visa_agents_agencyId_isDeleted_idx" ON "visa_agents"("agencyId", "isDeleted");

-- CreateIndex
CREATE INDEX "visa_cases_agencyId_idx" ON "visa_cases"("agencyId");

-- CreateIndex
CREATE INDEX "visa_cases_agencyId_isDeleted_idx" ON "visa_cases"("agencyId", "isDeleted");

-- CreateIndex
CREATE INDEX "visa_cases_agencyId_status_idx" ON "visa_cases"("agencyId", "status");

-- CreateIndex
CREATE INDEX "visa_cases_customerId_idx" ON "visa_cases"("customerId");

-- CreateIndex
CREATE INDEX "visa_cases_visaAgentId_idx" ON "visa_cases"("visaAgentId");

-- CreateIndex
CREATE INDEX "visa_payments_visaCaseId_idx" ON "visa_payments"("visaCaseId");

-- CreateIndex
CREATE INDEX "visa_payments_agencyId_idx" ON "visa_payments"("agencyId");

-- CreateIndex
CREATE INDEX "visa_documents_visaCaseId_idx" ON "visa_documents"("visaCaseId");

-- CreateIndex
CREATE INDEX "visa_documents_agencyId_idx" ON "visa_documents"("agencyId");

-- CreateIndex
CREATE INDEX "visa_status_history_visaCaseId_idx" ON "visa_status_history"("visaCaseId");

-- CreateIndex
CREATE INDEX "visa_status_history_agencyId_idx" ON "visa_status_history"("agencyId");

-- AddForeignKey
ALTER TABLE "agencies" ADD CONSTRAINT "agencies_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_orders" ADD CONSTRAINT "subscription_orders_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_orders" ADD CONSTRAINT "subscription_orders_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hajj_packages" ADD CONSTRAINT "hajj_packages_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hajj_batches" ADD CONSTRAINT "hajj_batches_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "hajj_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hajj_rooms" ADD CONSTRAINT "hajj_rooms_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "hajj_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hajj_bookings" ADD CONSTRAINT "hajj_bookings_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hajj_bookings" ADD CONSTRAINT "hajj_bookings_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "hajj_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hajj_bookings" ADD CONSTRAINT "hajj_bookings_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "hajj_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hajj_bookings" ADD CONSTRAINT "hajj_bookings_makkahRoomId_fkey" FOREIGN KEY ("makkahRoomId") REFERENCES "hajj_rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hajj_bookings" ADD CONSTRAINT "hajj_bookings_madinahRoomId_fkey" FOREIGN KEY ("madinahRoomId") REFERENCES "hajj_rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hajj_payments" ADD CONSTRAINT "hajj_payments_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "hajj_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hajj_documents" ADD CONSTRAINT "hajj_documents_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "hajj_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hajj_status_history" ADD CONSTRAINT "hajj_status_history_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "hajj_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_payments" ADD CONSTRAINT "ticket_payments_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_documents" ADD CONSTRAINT "ticket_documents_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_status_history" ADD CONSTRAINT "ticket_status_history_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_status_history" ADD CONSTRAINT "ticket_status_history_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visa_agents" ADD CONSTRAINT "visa_agents_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visa_cases" ADD CONSTRAINT "visa_cases_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visa_cases" ADD CONSTRAINT "visa_cases_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visa_cases" ADD CONSTRAINT "visa_cases_visaAgentId_fkey" FOREIGN KEY ("visaAgentId") REFERENCES "visa_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visa_cases" ADD CONSTRAINT "visa_cases_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visa_payments" ADD CONSTRAINT "visa_payments_visaCaseId_fkey" FOREIGN KEY ("visaCaseId") REFERENCES "visa_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visa_documents" ADD CONSTRAINT "visa_documents_visaCaseId_fkey" FOREIGN KEY ("visaCaseId") REFERENCES "visa_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visa_status_history" ADD CONSTRAINT "visa_status_history_visaCaseId_fkey" FOREIGN KEY ("visaCaseId") REFERENCES "visa_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visa_status_history" ADD CONSTRAINT "visa_status_history_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
