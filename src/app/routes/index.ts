import { Router } from "express";
import { AuthRoutes } from "../module/auth/auth.route.js";

const router = Router();

router.use("/auth", AuthRoutes);

export const indexRoute = router;
