/*
  Warnings:

  - You are about to drop the column `airline` on the `tickets` table. All the data in the column will be lost.
  - You are about to drop the column `routeFrom` on the `tickets` table. All the data in the column will be lost.
  - You are about to drop the column `routeTo` on the `tickets` table. All the data in the column will be lost.
  - You are about to drop the column `supplier` on the `tickets` table. All the data in the column will be lost.
  - Added the required column `cashAccountId` to the `ticket_payments` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "PostingDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "PostingSource" AS ENUM ('OPENING', 'INVESTMENT', 'INVESTMENT_WITHDRAWAL', 'PROFIT_WITHDRAWAL', 'SUPPLIER_PAYMENT', 'SALES_PAYMENT', 'DATE_CHANGE_FEE', 'DUE_RECEIVED', 'EXPENSE', 'EMPLOYEE_PAYOUT', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "CashAccountCategory" AS ENUM ('OWNER_FUNDS', 'LOANS', 'SALES_BUYING', 'OTHERS');

-- CreateEnum
CREATE TYPE "CapitalFlowType" AS ENUM ('INVEST', 'WITHDRAW');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT');

-- CreateEnum
CREATE TYPE "EmployeePayoutType" AS ENUM ('SALARY', 'BONUS');

-- CreateEnum
CREATE TYPE "AnnouncementType" AS ENUM ('INFO', 'FEATURE', 'MAINTENANCE', 'WARNING');

-- CreateEnum
CREATE TYPE "SupportCategory" AS ENUM ('BILLING', 'TECHNICAL', 'FEATURE_REQUEST', 'OTHER');

-- CreateEnum
CREATE TYPE "SupportPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "SupportStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "PlanHistoryAction" AS ENUM ('ASSIGNED', 'UPGRADED', 'DOWNGRADED', 'TRIAL_EXTENDED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PlanFeature" ADD VALUE 'EXPENSE';
ALTER TYPE "PlanFeature" ADD VALUE 'CRM';

-- AlterTable
ALTER TABLE "ticket_payments" ADD COLUMN     "cashAccountId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "tickets" DROP COLUMN "airline",
DROP COLUMN "routeFrom",
DROP COLUMN "routeTo",
DROP COLUMN "supplier",
ADD COLUMN     "airlineId" TEXT,
ADD COLUMN     "dateChangeCost" DECIMAL(12,2),
ADD COLUMN     "dateChangeFee" DECIMAL(12,2),
ADD COLUMN     "dateChangedAt" TIMESTAMP(3),
ADD COLUMN     "routeId" TEXT,
ADD COLUMN     "supplierId" TEXT;

-- CreateTable
CREATE TABLE "due_received" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cashAccount1Id" TEXT NOT NULL,
    "amount1" DECIMAL(14,2) NOT NULL,
    "cashAccount2Id" TEXT,
    "amount2" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discountCategory" TEXT,
    "paymentReceiverId" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "due_received_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address" TEXT,
    "joinDate" DATE NOT NULL,
    "resignDate" DATE,
    "createdById" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_attendance" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "startTime" TEXT,
    "endTime" TEXT,
    "totalHours" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_transactions" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" "EmployeePayoutType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "cashAccountId" TEXT NOT NULL,
    "totalDays" INTEGER,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "monthlyBudget" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "yearlyBudget" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amount" DECIMAL(14,2) NOT NULL,
    "cashAccountId" TEXT NOT NULL,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "airline_masters" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortCode" TEXT NOT NULL,
    "logoUrl" TEXT,
    "remark" TEXT,
    "createdById" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "airline_masters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_masters" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "remark" TEXT,
    "createdById" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "route_masters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monthly_goals" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "salesGoal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "profitGoal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monthly_goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_accounts" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "CashAccountCategory" NOT NULL DEFAULT 'OTHERS',
    "openingBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cash_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_postings" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "cashAccountId" TEXT NOT NULL,
    "direction" "PostingDirection" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "source" "PostingSource" NOT NULL,
    "sourceId" TEXT,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_postings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "balance_transfers" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "fromAccountId" TEXT NOT NULL,
    "toAccountId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "transferredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "balance_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capital_flows" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "type" "CapitalFlowType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cashAccountId" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "capital_flows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profit_withdrawals" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cashAccountId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "receivedBy" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profit_withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcements" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "type" "AnnouncementType" NOT NULL DEFAULT 'INFO',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcement_reads" (
    "id" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcement_reads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "category" "SupportCategory" NOT NULL DEFAULT 'OTHER',
    "priority" "SupportPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "SupportStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_messages" (
    "id" TEXT NOT NULL,
    "supportTicketId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "senderRole" "Role" NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_activity_logs" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "details" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_histories" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "planId" TEXT,
    "action" "PlanHistoryAction" NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedById" TEXT,

    CONSTRAINT "plan_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "openingPayable" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_transactions" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cashAccountId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "paidById" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "due_received_agencyId_idx" ON "due_received"("agencyId");

-- CreateIndex
CREATE INDEX "due_received_customerId_idx" ON "due_received"("customerId");

-- CreateIndex
CREATE INDEX "due_received_cashAccount1Id_idx" ON "due_received"("cashAccount1Id");

-- CreateIndex
CREATE INDEX "due_received_agencyId_date_idx" ON "due_received"("agencyId", "date");

-- CreateIndex
CREATE INDEX "employees_agencyId_idx" ON "employees"("agencyId");

-- CreateIndex
CREATE INDEX "employees_agencyId_isDeleted_idx" ON "employees"("agencyId", "isDeleted");

-- CreateIndex
CREATE INDEX "employee_attendance_agencyId_idx" ON "employee_attendance"("agencyId");

-- CreateIndex
CREATE INDEX "employee_attendance_agencyId_date_idx" ON "employee_attendance"("agencyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "employee_attendance_employeeId_date_key" ON "employee_attendance"("employeeId", "date");

-- CreateIndex
CREATE INDEX "employee_transactions_agencyId_idx" ON "employee_transactions"("agencyId");

-- CreateIndex
CREATE INDEX "employee_transactions_employeeId_idx" ON "employee_transactions"("employeeId");

-- CreateIndex
CREATE INDEX "employee_transactions_cashAccountId_idx" ON "employee_transactions"("cashAccountId");

-- CreateIndex
CREATE INDEX "employee_transactions_agencyId_date_idx" ON "employee_transactions"("agencyId", "date");

-- CreateIndex
CREATE INDEX "expense_categories_agencyId_idx" ON "expense_categories"("agencyId");

-- CreateIndex
CREATE INDEX "expense_categories_agencyId_isDeleted_idx" ON "expense_categories"("agencyId", "isDeleted");

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_agencyId_name_key" ON "expense_categories"("agencyId", "name");

-- CreateIndex
CREATE INDEX "expenses_agencyId_idx" ON "expenses"("agencyId");

-- CreateIndex
CREATE INDEX "expenses_categoryId_idx" ON "expenses"("categoryId");

-- CreateIndex
CREATE INDEX "expenses_cashAccountId_idx" ON "expenses"("cashAccountId");

-- CreateIndex
CREATE INDEX "expenses_agencyId_date_idx" ON "expenses"("agencyId", "date");

-- CreateIndex
CREATE INDEX "airline_masters_agencyId_idx" ON "airline_masters"("agencyId");

-- CreateIndex
CREATE INDEX "airline_masters_agencyId_isDeleted_idx" ON "airline_masters"("agencyId", "isDeleted");

-- CreateIndex
CREATE UNIQUE INDEX "airline_masters_agencyId_shortCode_key" ON "airline_masters"("agencyId", "shortCode");

-- CreateIndex
CREATE UNIQUE INDEX "airline_masters_agencyId_name_key" ON "airline_masters"("agencyId", "name");

-- CreateIndex
CREATE INDEX "route_masters_agencyId_idx" ON "route_masters"("agencyId");

-- CreateIndex
CREATE INDEX "route_masters_agencyId_isDeleted_idx" ON "route_masters"("agencyId", "isDeleted");

-- CreateIndex
CREATE UNIQUE INDEX "route_masters_agencyId_name_key" ON "route_masters"("agencyId", "name");

-- CreateIndex
CREATE INDEX "monthly_goals_agencyId_idx" ON "monthly_goals"("agencyId");

-- CreateIndex
CREATE INDEX "monthly_goals_agencyId_year_idx" ON "monthly_goals"("agencyId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "monthly_goals_agencyId_year_month_key" ON "monthly_goals"("agencyId", "year", "month");

-- CreateIndex
CREATE INDEX "cash_accounts_agencyId_idx" ON "cash_accounts"("agencyId");

-- CreateIndex
CREATE INDEX "cash_accounts_agencyId_isDeleted_idx" ON "cash_accounts"("agencyId", "isDeleted");

-- CreateIndex
CREATE UNIQUE INDEX "cash_accounts_agencyId_name_key" ON "cash_accounts"("agencyId", "name");

-- CreateIndex
CREATE INDEX "account_postings_agencyId_idx" ON "account_postings"("agencyId");

-- CreateIndex
CREATE INDEX "account_postings_cashAccountId_idx" ON "account_postings"("cashAccountId");

-- CreateIndex
CREATE INDEX "account_postings_agencyId_postedAt_idx" ON "account_postings"("agencyId", "postedAt");

-- CreateIndex
CREATE INDEX "account_postings_source_sourceId_idx" ON "account_postings"("source", "sourceId");

-- CreateIndex
CREATE INDEX "balance_transfers_agencyId_idx" ON "balance_transfers"("agencyId");

-- CreateIndex
CREATE INDEX "balance_transfers_fromAccountId_idx" ON "balance_transfers"("fromAccountId");

-- CreateIndex
CREATE INDEX "balance_transfers_toAccountId_idx" ON "balance_transfers"("toAccountId");

-- CreateIndex
CREATE INDEX "balance_transfers_agencyId_date_idx" ON "balance_transfers"("agencyId", "date");

-- CreateIndex
CREATE INDEX "capital_flows_agencyId_idx" ON "capital_flows"("agencyId");

-- CreateIndex
CREATE INDEX "capital_flows_cashAccountId_idx" ON "capital_flows"("cashAccountId");

-- CreateIndex
CREATE INDEX "capital_flows_agencyId_date_idx" ON "capital_flows"("agencyId", "date");

-- CreateIndex
CREATE INDEX "profit_withdrawals_agencyId_idx" ON "profit_withdrawals"("agencyId");

-- CreateIndex
CREATE INDEX "profit_withdrawals_cashAccountId_idx" ON "profit_withdrawals"("cashAccountId");

-- CreateIndex
CREATE INDEX "profit_withdrawals_agencyId_date_idx" ON "profit_withdrawals"("agencyId", "date");

-- CreateIndex
CREATE INDEX "announcements_isActive_createdAt_idx" ON "announcements"("isActive", "createdAt");

-- CreateIndex
CREATE INDEX "announcement_reads_userId_idx" ON "announcement_reads"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "announcement_reads_announcementId_userId_key" ON "announcement_reads"("announcementId", "userId");

-- CreateIndex
CREATE INDEX "support_tickets_agencyId_idx" ON "support_tickets"("agencyId");

-- CreateIndex
CREATE INDEX "support_tickets_status_updatedAt_idx" ON "support_tickets"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "support_tickets_agencyId_updatedAt_idx" ON "support_tickets"("agencyId", "updatedAt");

-- CreateIndex
CREATE INDEX "support_messages_supportTicketId_createdAt_idx" ON "support_messages"("supportTicketId", "createdAt");

-- CreateIndex
CREATE INDEX "admin_activity_logs_adminId_idx" ON "admin_activity_logs"("adminId");

-- CreateIndex
CREATE INDEX "admin_activity_logs_action_idx" ON "admin_activity_logs"("action");

-- CreateIndex
CREATE INDEX "admin_activity_logs_targetType_idx" ON "admin_activity_logs"("targetType");

-- CreateIndex
CREATE INDEX "admin_activity_logs_createdAt_idx" ON "admin_activity_logs"("createdAt");

-- CreateIndex
CREATE INDEX "plan_histories_agencyId_assignedAt_idx" ON "plan_histories"("agencyId", "assignedAt");

-- CreateIndex
CREATE INDEX "plan_histories_planId_idx" ON "plan_histories"("planId");

-- CreateIndex
CREATE INDEX "suppliers_agencyId_idx" ON "suppliers"("agencyId");

-- CreateIndex
CREATE INDEX "suppliers_agencyId_isDeleted_idx" ON "suppliers"("agencyId", "isDeleted");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_agencyId_name_key" ON "suppliers"("agencyId", "name");

-- CreateIndex
CREATE INDEX "supplier_transactions_agencyId_idx" ON "supplier_transactions"("agencyId");

-- CreateIndex
CREATE INDEX "supplier_transactions_supplierId_idx" ON "supplier_transactions"("supplierId");

-- CreateIndex
CREATE INDEX "supplier_transactions_cashAccountId_idx" ON "supplier_transactions"("cashAccountId");

-- CreateIndex
CREATE INDEX "supplier_transactions_agencyId_date_idx" ON "supplier_transactions"("agencyId", "date");

-- CreateIndex
CREATE INDEX "ticket_payments_cashAccountId_idx" ON "ticket_payments"("cashAccountId");

-- CreateIndex
CREATE INDEX "tickets_agencyId_isDeleted_createdAt_idx" ON "tickets"("agencyId", "isDeleted", "createdAt");

-- CreateIndex
CREATE INDEX "tickets_supplierId_idx" ON "tickets"("supplierId");

-- CreateIndex
CREATE INDEX "tickets_airlineId_idx" ON "tickets"("airlineId");

-- CreateIndex
CREATE INDEX "tickets_routeId_idx" ON "tickets"("routeId");

-- AddForeignKey
ALTER TABLE "due_received" ADD CONSTRAINT "due_received_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "due_received" ADD CONSTRAINT "due_received_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "due_received" ADD CONSTRAINT "due_received_cashAccount1Id_fkey" FOREIGN KEY ("cashAccount1Id") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "due_received" ADD CONSTRAINT "due_received_cashAccount2Id_fkey" FOREIGN KEY ("cashAccount2Id") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_attendance" ADD CONSTRAINT "employee_attendance_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_attendance" ADD CONSTRAINT "employee_attendance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_transactions" ADD CONSTRAINT "employee_transactions_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_transactions" ADD CONSTRAINT "employee_transactions_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_transactions" ADD CONSTRAINT "employee_transactions_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "airline_masters" ADD CONSTRAINT "airline_masters_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_masters" ADD CONSTRAINT "route_masters_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_goals" ADD CONSTRAINT "monthly_goals_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_accounts" ADD CONSTRAINT "cash_accounts_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_postings" ADD CONSTRAINT "account_postings_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_postings" ADD CONSTRAINT "account_postings_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balance_transfers" ADD CONSTRAINT "balance_transfers_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balance_transfers" ADD CONSTRAINT "balance_transfers_fromAccountId_fkey" FOREIGN KEY ("fromAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balance_transfers" ADD CONSTRAINT "balance_transfers_toAccountId_fkey" FOREIGN KEY ("toAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capital_flows" ADD CONSTRAINT "capital_flows_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capital_flows" ADD CONSTRAINT "capital_flows_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profit_withdrawals" ADD CONSTRAINT "profit_withdrawals_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profit_withdrawals" ADD CONSTRAINT "profit_withdrawals_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_reads" ADD CONSTRAINT "announcement_reads_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_reads" ADD CONSTRAINT "announcement_reads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_supportTicketId_fkey" FOREIGN KEY ("supportTicketId") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_activity_logs" ADD CONSTRAINT "admin_activity_logs_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_histories" ADD CONSTRAINT "plan_histories_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_histories" ADD CONSTRAINT "plan_histories_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_transactions" ADD CONSTRAINT "supplier_transactions_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_transactions" ADD CONSTRAINT "supplier_transactions_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_transactions" ADD CONSTRAINT "supplier_transactions_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_airlineId_fkey" FOREIGN KEY ("airlineId") REFERENCES "airline_masters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "route_masters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_payments" ADD CONSTRAINT "ticket_payments_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
