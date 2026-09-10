import { Router } from "express";

const router = Router();

// Modules are registered here, one router.use per module, kebab-case plural.
// e.g. router.use("/auth", AuthRoutes);

export const indexRoute = router;
