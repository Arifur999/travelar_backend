import { Router } from "express";
import multer from "multer";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { requireActiveSubscription } from "../../middleware/tenantGuards.js";
import { ImportController } from "./import.controller.js";

const router = Router();

/**
 * In memory, not on disk or in Cloudinary: an agency's whole book of business
 * is in this file, and it has no reason to exist anywhere after it has been
 * read.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const isSpreadsheet =
      file.mimetype ===
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      file.originalname.toLowerCase().endsWith(".xlsx");
    cb(null, isSpreadsheet);
  },
});

// AGENCY_ADMIN only: this is the owner's own history, and the next step writes
// to the books. No plan gate — moving in is not a paid feature.
router.use(checkAuth(Role.AGENCY_ADMIN), requireActiveSubscription);

router.post("/preview", upload.single("file"), ImportController.preview);

export const ImportRoutes = router;
