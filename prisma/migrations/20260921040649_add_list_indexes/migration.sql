-- CreateIndex
CREATE INDEX "users_agencyId_isDeleted_createdAt_idx" ON "users"("agencyId", "isDeleted", "createdAt");

-- CreateIndex
CREATE INDEX "subscription_payments_agencyId_createdAt_idx" ON "subscription_payments"("agencyId", "createdAt");

-- CreateIndex
CREATE INDEX "customers_agencyId_isDeleted_createdAt_idx" ON "customers"("agencyId", "isDeleted", "createdAt");

-- CreateIndex
CREATE INDEX "due_received_agencyId_createdAt_idx" ON "due_received"("agencyId", "createdAt");

-- CreateIndex
CREATE INDEX "employees_agencyId_isDeleted_createdAt_idx" ON "employees"("agencyId", "isDeleted", "createdAt");

-- CreateIndex
CREATE INDEX "employee_attendance_agencyId_createdAt_idx" ON "employee_attendance"("agencyId", "createdAt");

-- CreateIndex
CREATE INDEX "employee_transactions_agencyId_createdAt_idx" ON "employee_transactions"("agencyId", "createdAt");

-- CreateIndex
CREATE INDEX "expense_categories_agencyId_isDeleted_createdAt_idx" ON "expense_categories"("agencyId", "isDeleted", "createdAt");

-- CreateIndex
CREATE INDEX "expenses_agencyId_createdAt_idx" ON "expenses"("agencyId", "createdAt");

-- CreateIndex
CREATE INDEX "hajj_packages_agencyId_isDeleted_createdAt_idx" ON "hajj_packages"("agencyId", "isDeleted", "createdAt");

-- CreateIndex
CREATE INDEX "hajj_batches_agencyId_isDeleted_createdAt_idx" ON "hajj_batches"("agencyId", "isDeleted", "createdAt");

-- CreateIndex
CREATE INDEX "hajj_rooms_agencyId_isDeleted_createdAt_idx" ON "hajj_rooms"("agencyId", "isDeleted", "createdAt");

-- CreateIndex
CREATE INDEX "hajj_bookings_agencyId_isDeleted_createdAt_idx" ON "hajj_bookings"("agencyId", "isDeleted", "createdAt");

-- CreateIndex
CREATE INDEX "airline_masters_agencyId_isDeleted_createdAt_idx" ON "airline_masters"("agencyId", "isDeleted", "createdAt");

-- CreateIndex
CREATE INDEX "route_masters_agencyId_isDeleted_createdAt_idx" ON "route_masters"("agencyId", "isDeleted", "createdAt");

-- CreateIndex
CREATE INDEX "cash_accounts_agencyId_isDeleted_createdAt_idx" ON "cash_accounts"("agencyId", "isDeleted", "createdAt");

-- CreateIndex
CREATE INDEX "balance_transfers_agencyId_createdAt_idx" ON "balance_transfers"("agencyId", "createdAt");

-- CreateIndex
CREATE INDEX "capital_flows_agencyId_createdAt_idx" ON "capital_flows"("agencyId", "createdAt");

-- CreateIndex
CREATE INDEX "support_tickets_agencyId_createdAt_idx" ON "support_tickets"("agencyId", "createdAt");

-- CreateIndex
CREATE INDEX "suppliers_agencyId_isDeleted_createdAt_idx" ON "suppliers"("agencyId", "isDeleted", "createdAt");

-- CreateIndex
CREATE INDEX "supplier_transactions_agencyId_createdAt_idx" ON "supplier_transactions"("agencyId", "createdAt");

-- CreateIndex
CREATE INDEX "visa_agents_agencyId_isDeleted_createdAt_idx" ON "visa_agents"("agencyId", "isDeleted", "createdAt");

-- CreateIndex
CREATE INDEX "visa_cases_agencyId_isDeleted_createdAt_idx" ON "visa_cases"("agencyId", "isDeleted", "createdAt");

