import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { requireActiveSubscription } from "../../middleware/tenantGuards.js";
import { WalletController } from "./wallet.controller.js";

const router = Router();

// No plan gate: a wallet is money the agency is holding for its customers,
// derived from collections, which every plan can take. Nothing here writes —
// money goes in through /due-received and out through a payment marked
// fromWallet on the sale it settles.
router.use(checkAuth(Role.AGENCY_ADMIN, Role.AGENCY_STAFF), requireActiveSubscription);

router.get("/summary", WalletController.getSummary);
router.get("/", WalletController.getHolders);
router.get("/:customerId", WalletController.getStatement);

export const WalletRoutes = router;
