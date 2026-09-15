import { Router } from "express";
import { AdminRoutes } from "../module/admin/admin.route.js";
import { AgencyRoutes } from "../module/agency/agency.route.js";
import { AirlineMasterRoutes } from "../module/airlineMaster/airlineMaster.route.js";
import { AuthRoutes } from "../module/auth/auth.route.js";
import { BalanceTransferRoutes } from "../module/balanceTransfer/balanceTransfer.route.js";
import { BillingRoutes, billingWebhookRouter } from "../module/billing/billing.route.js";
import { CapitalRoutes } from "../module/capital/capital.route.js";
import { CashAccountRoutes } from "../module/cashAccount/cashAccount.route.js";
import { CustomerRoutes } from "../module/customer/customer.route.js";
import { DashboardRoutes } from "../module/dashboard/dashboard.route.js";
import { DueReceivedRoutes } from "../module/dueReceived/dueReceived.route.js";
import { EmployeeRoutes } from "../module/employee/employee.route.js";
import { ExpenseRoutes } from "../module/expense/expense.route.js";
import { HajjRoutes } from "../module/hajj/hajj.route.js";
import { InternalRoutes } from "../module/internal/internal.route.js";
import { RouteMasterRoutes } from "../module/routeMaster/routeMaster.route.js";
import { SupplierRoutes } from "../module/supplier/supplier.route.js";
import { SupplierTransactionRoutes } from "../module/supplierTransaction/supplierTransaction.route.js";
import { SupportRoutes, adminSupportRouter } from "../module/support/support.route.js";
import { TeamRoutes } from "../module/team/team.route.js";
import { TicketRoutes } from "../module/ticket/ticket.route.js";
import { VisaRoutes } from "../module/visa/visa.route.js";

const router = Router();

router.use("/auth", AuthRoutes);
router.use("/agency", AgencyRoutes);
router.use("/team", TeamRoutes);
router.use("/accounts", CashAccountRoutes);
router.use("/balance-transfers", BalanceTransferRoutes);
router.use("/suppliers", SupplierRoutes);
router.use("/supplier-transactions", SupplierTransactionRoutes);
router.use("/customers", CustomerRoutes);
router.use("/due-received", DueReceivedRoutes);
router.use("/airlines", AirlineMasterRoutes);
router.use("/routes-master", RouteMasterRoutes);
router.use("/ticketing", TicketRoutes);
router.use("/expenses", ExpenseRoutes);
router.use("/capital", CapitalRoutes);
router.use("/visa", VisaRoutes);
router.use("/hajj", HajjRoutes);
router.use("/employees", EmployeeRoutes);
router.use("/dashboard", DashboardRoutes);
router.use("/billing", BillingRoutes);
router.use("/admin", AdminRoutes);
router.use("/admin", adminSupportRouter);
router.use("/support", SupportRoutes);

// Scheduler hooks — no session; a shared secret instead. 404 unless CRON_SECRET is set.
router.use("/internal", InternalRoutes);

// Public gateway callbacks — no session, called server-to-server.
router.use("/billing", billingWebhookRouter);

export const indexRoute = router;
