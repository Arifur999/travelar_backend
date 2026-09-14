import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { requireActiveSubscription } from "../../middleware/tenantGuards.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { TeamController } from "./team.controller.js";
import { TeamValidation } from "./team.validation.js";

const router = Router();

// Not behind a plan feature: every agency has users, whatever it pays for.
// Staff can see who their teammates are; only admins change anything, and the
// owner/admin rules on top of that live in TeamService.assertCanManage.
router.use(checkAuth(Role.AGENCY_ADMIN, Role.AGENCY_STAFF));

router.get("/", TeamController.getAllMembers);
router.get("/:id", TeamController.getMemberById);

// Adding seats and changing roles are ordinary writes, so a lapsed agency is
// read-only for them like everywhere else.
router.post(
  "/",
  checkAuth(Role.AGENCY_ADMIN),
  requireActiveSubscription,
  validateRequest(TeamValidation.createMemberZodSchema),
  TeamController.createMember,
);
router.patch(
  "/:id",
  checkAuth(Role.AGENCY_ADMIN),
  requireActiveSubscription,
  validateRequest(TeamValidation.updateMemberZodSchema),
  TeamController.updateMember,
);

// Deliberately NOT behind requireActiveSubscription. Locking out someone who
// has left is a security action, and an agency whose subscription lapsed must
// still be able to take it — the old read-only rule would have kept a fired
// employee signed in until the bill was paid.
router.patch(
  "/:id/status",
  checkAuth(Role.AGENCY_ADMIN),
  validateRequest(TeamValidation.updateMemberStatusZodSchema),
  TeamController.updateMemberStatus,
);
router.patch(
  "/:id/reset-password",
  checkAuth(Role.AGENCY_ADMIN),
  validateRequest(TeamValidation.resetMemberPasswordZodSchema),
  TeamController.resetMemberPassword,
);
router.delete("/:id", checkAuth(Role.AGENCY_ADMIN), TeamController.removeMember);

export const TeamRoutes = router;
