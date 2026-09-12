import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { SupportController } from "./support.controller.js";
import { SupportValidation } from "./support.validation.js";

/**
 * Tenant side. Never gated on a plan or an expiry — an agency whose
 * subscription has lapsed is exactly the one that needs to reach support.
 */
const router = Router();

router.use(checkAuth(Role.AGENCY_ADMIN, Role.AGENCY_STAFF));

router.get("/announcements", SupportController.listMyAnnouncements);
router.post("/announcements/:id/read", SupportController.markAnnouncementRead);

router.get("/tickets", SupportController.listTickets);
router.post(
  "/tickets",
  validateRequest(SupportValidation.createTicketZodSchema),
  SupportController.createTicket,
);
router.get("/tickets/:id", SupportController.getTicketById);
router.post(
  "/tickets/:id/messages",
  validateRequest(SupportValidation.addMessageZodSchema),
  SupportController.addMessage,
);

export const SupportRoutes = router;

/** Operator side, mounted under /admin. */
export const adminSupportRouter = Router();

adminSupportRouter.use(checkAuth(Role.SUPER_ADMIN));

adminSupportRouter.get("/tickets", SupportController.listTickets);
adminSupportRouter.get("/tickets/:id", SupportController.getTicketById);
adminSupportRouter.post(
  "/tickets/:id/messages",
  validateRequest(SupportValidation.addMessageZodSchema),
  SupportController.addMessage,
);
adminSupportRouter.patch(
  "/tickets/:id/status",
  validateRequest(SupportValidation.updateTicketStatusZodSchema),
  SupportController.updateTicketStatus,
);

adminSupportRouter.get("/announcements", SupportController.listAnnouncementsForAdmin);
adminSupportRouter.post(
  "/announcements",
  validateRequest(SupportValidation.createAnnouncementZodSchema),
  SupportController.createAnnouncement,
);
adminSupportRouter.patch(
  "/announcements/:id",
  validateRequest(SupportValidation.updateAnnouncementZodSchema),
  SupportController.updateAnnouncement,
);
