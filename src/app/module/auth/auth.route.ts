import { Router } from "express";
import { checkAuth } from "../../middleware/checkAuth.js";
import {
  authRateLimiter,
  loginAccountRateLimiter,
  passwordResetAccountRateLimiter,
} from "../../middleware/rateLimiter.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { AuthController } from "./auth.controller.js";
import { AuthValidation } from "./auth.validation.js";

const router = Router();

// Public. Rate limited because these are the credential-guessing surface.
router.post("/register", authRateLimiter, validateRequest(AuthValidation.registerZodSchema), AuthController.register);
router.post(
  "/login",
  authRateLimiter,
  loginAccountRateLimiter,
  validateRequest(AuthValidation.loginZodSchema),
  AuthController.login,
);
router.post("/refresh-token", AuthController.getNewToken);

// Public password recovery. The per-account limit on requests stops this from
// being used to flood someone's inbox; reset attempts share the auth limit.
router.post(
  "/forgot-password",
  authRateLimiter,
  passwordResetAccountRateLimiter,
  validateRequest(AuthValidation.forgotPasswordZodSchema),
  AuthController.forgotPassword,
);
router.post(
  "/reset-password",
  authRateLimiter,
  validateRequest(AuthValidation.resetPasswordZodSchema),
  AuthController.resetPassword,
);

// Authenticated, any role.
router.get("/me", checkAuth(), AuthController.getMe);
router.patch("/me", checkAuth(), validateRequest(AuthValidation.updateMeZodSchema), AuthController.updateMe);
router.get("/my-features", checkAuth(), AuthController.getMyFeatures);
router.post(
  "/change-password",
  checkAuth(),
  validateRequest(AuthValidation.changePasswordZodSchema),
  AuthController.changePassword,
);
router.post("/logout", checkAuth(), AuthController.logout);

export const AuthRoutes = router;
