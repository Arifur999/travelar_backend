import { Router } from "express";
import { AuthRoutes } from "../module/auth/auth.route.js";
import { BalanceTransferRoutes } from "../module/balanceTransfer/balanceTransfer.route.js";
import { CashAccountRoutes } from "../module/cashAccount/cashAccount.route.js";
import { CustomerRoutes } from "../module/customer/customer.route.js";
import { DueReceivedRoutes } from "../module/dueReceived/dueReceived.route.js";
import { SupplierRoutes } from "../module/supplier/supplier.route.js";
import { SupplierTransactionRoutes } from "../module/supplierTransaction/supplierTransaction.route.js";

const router = Router();

router.use("/auth", AuthRoutes);
router.use("/accounts", CashAccountRoutes);
router.use("/balance-transfers", BalanceTransferRoutes);
router.use("/suppliers", SupplierRoutes);
router.use("/supplier-transactions", SupplierTransactionRoutes);
router.use("/customers", CustomerRoutes);
router.use("/due-received", DueReceivedRoutes);

export const indexRoute = router;
