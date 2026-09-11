import { Router } from "express";
import { AuthRoutes } from "../module/auth/auth.route.js";
import { BalanceTransferRoutes } from "../module/balanceTransfer/balanceTransfer.route.js";
import { CashAccountRoutes } from "../module/cashAccount/cashAccount.route.js";

const router = Router();

router.use("/auth", AuthRoutes);
router.use("/accounts", CashAccountRoutes);
router.use("/balance-transfers", BalanceTransferRoutes);

export const indexRoute = router;
