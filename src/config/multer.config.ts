import multer from "multer";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import { uploadToCloudinary } from "./cloudinary.config.js";

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

const storage = new CloudinaryStorage({
  cloudinary: uploadToCloudinary,
  params: async (req, file) => {
    const extension = file.originalname.split(".").pop()?.toLowerCase();
    const base = file.originalname
      .replace(/\.[^/.]+$/, "")
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/^-+|-+$/g, "");

    const uniqueName = `${Math.random().toString(36).substring(2)}-${Date.now()}-${base}`;
    const folder = extension === "pdf" ? "pdfs" : "images";

    return { folder: `travelar/${folder}`, public_id: uniqueName, resource_type: "auto" };
  },
});

// Limits and a filter are not optional: without them any caller can push an
// arbitrarily large file of any type straight into the Cloudinary account.
export const multerUpload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (req, file, cb) => {
    cb(null, ALLOWED_MIME_TYPES.includes(file.mimetype));
  },
});
