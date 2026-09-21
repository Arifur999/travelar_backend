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
import { HotelRoutes } from "../module/hotel/hotel.route.js";
import { InternalRoutes } from "../module/internal/internal.route.js";
import { RouteMasterRoutes } from "../module/routeMaster/routeMaster.route.js";
import { SupplierRoutes } from "../module/supplier/supplier.route.js";
import { SupplierTransactionRoutes } from "../module/supplierTransaction/supplierTransaction.route.js";
import { SupportRoutes, adminSupportRouter } from "../module/support/support.route.js";
import { TeamRoutes } from "../module/team/team.route.js";
import { TicketRoutes } from "../module/ticket/ticket.route.js";
import { TourRoutes } from "../module/tour/tour.route.js";
import { VisaRoutes } from "../module/visa/visa.route.js";
import { WalletRoutes } from "../module/wallet/wallet.route.js";

const router = Router();

router.use("/auth", AuthRoutes);
router.use("/agency", AgencyRoutes);
router.use("/team", TeamRoutes);
router.use("/accounts", CashAccountRoutes);
router.use("/balance-transfers", BalanceTransferRoutes);
router.use("/suppliers", SupplierRoutes);
router.use("/supplier-transactions", SupplierTransactionRoutes);
router.use("/customers", CustomerRoutes);
router.use("/wallet", WalletRoutes);
router.use("/due-received", DueReceivedRoutes);
router.use("/airlines", AirlineMasterRoutes);
router.use("/routes-master", RouteMasterRoutes);
router.use("/ticketing", TicketRoutes);
router.use("/expenses", ExpenseRoutes);
router.use("/capital", CapitalRoutes);
router.use("/visa", VisaRoutes);
router.use("/hajj", HajjRoutes);
router.use("/tours", TourRoutes);
router.use("/hotels", HotelRoutes);
router.use("/employees", EmployeeRoutes);
router.use("/dashboard", DashboardRoutes);

// Public gateway callbacks — no session, called server-to-server by SSLCommerz
// and by the customer's browser after paying.
//
// ORDER IS LOAD-BEARING: this must be mounted BEFORE BillingRoutes. That router
// opens with `router.use(checkAuth(...))`, and a router-level middleware runs
// for EVERY request that enters the router — including paths none of its own
// routes match. Mounted after it, as this was, the gateway's IPN was answered
// "401 No session token provided", so no online payment was ever recorded: the
// agency paid, the order stayed PENDING and the subscription never started.
// test/billing.test.ts posts to these routes without a session and fails if
// this moves back.
router.use("/billing", billingWebhookRouter);
router.use("/billing", BillingRoutes);
router.use("/admin", AdminRoutes);
router.use("/admin", adminSupportRouter);
router.use("/support", SupportRoutes);

// Scheduler hooks — no session; a shared secret instead. 404 unless CRON_SECRET is set.
router.use("/internal", InternalRoutes);

export const indexRoute = router;
