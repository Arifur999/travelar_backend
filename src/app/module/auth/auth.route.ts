import { Router } from "express";
import { checkAuth } from "../../middleware/checkAuth.js";
import { authRateLimiter } from "../../middleware/rateLimiter.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { AuthController } from "./auth.controller.js";
import { AuthValidation } from "./auth.validation.js";

const router = Router();

// Public. Rate limited because these are the credential-guessing surface.
router.post("/register", authRateLimiter, validateRequest(AuthValidation.registerZodSchema), AuthController.register);
router.post("/login", authRateLimiter, validateRequest(AuthValidation.loginZodSchema), AuthController.login);
router.post("/refresh-token", AuthController.getNewToken);

// Authenticated, any role.
router.get("/me", checkAuth(), AuthController.getMe);
router.get("/my-features", checkAuth(), AuthController.getMyFeatures);
router.post(
  "/change-password",
  checkAuth(),
  validateRequest(AuthValidation.changePasswordZodSchema),
  AuthController.changePassword,
);
router.post("/logout", checkAuth(), AuthController.logout);

export const AuthRoutes = router;
