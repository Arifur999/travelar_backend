import { Router } from "express";
import { AirlineMasterRoutes } from "../module/airlineMaster/airlineMaster.route.js";
import { AuthRoutes } from "../module/auth/auth.route.js";
import { BalanceTransferRoutes } from "../module/balanceTransfer/balanceTransfer.route.js";
import { CapitalRoutes } from "../module/capital/capital.route.js";
import { CashAccountRoutes } from "../module/cashAccount/cashAccount.route.js";
import { CustomerRoutes } from "../module/customer/customer.route.js";
import { DueReceivedRoutes } from "../module/dueReceived/dueReceived.route.js";
import { ExpenseRoutes } from "../module/expense/expense.route.js";
import { RouteMasterRoutes } from "../module/routeMaster/routeMaster.route.js";
import { SupplierRoutes } from "../module/supplier/supplier.route.js";
import { SupplierTransactionRoutes } from "../module/supplierTransaction/supplierTransaction.route.js";
import { TicketRoutes } from "../module/ticket/ticket.route.js";
import { VisaRoutes } from "../module/visa/visa.route.js";

const router = Router();

router.use("/auth", AuthRoutes);
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

export const indexRoute = router;
