import { Request } from "express";
import { deleteFileFromCloudinary } from "../../config/cloudinary.config.js";

/**
 * Multer has already pushed any uploaded file to Cloudinary by the time a later
 * middleware throws, so a validation failure would otherwise leave orphans
 * behind. Called from globalErrorHandler on every error.
 */
export const deleteUploadedFilesFromGlobalErrorHandler = async (req: Request) => {
  try {
    const urls: string[] = [];

    if (req.file?.path) {
      urls.push(req.file.path);
    }

    if (req.files) {
      if (Array.isArray(req.files)) {
        urls.push(...req.files.map((file) => file.path).filter(Boolean));
      } else {
        for (const group of Object.values(req.files)) {
          urls.push(...(group ?? []).map((file) => file.path).filter(Boolean));
        }
      }
    }

    if (urls.length === 0) return;

    await Promise.all(urls.map((url) => deleteFileFromCloudinary(url)));
    console.log(`Deleted ${urls.length} uploaded file(s) from Cloudinary due to a request error.`);
  } catch (error) {
    // Cleanup must never mask the original error.
    console.error("Failed to clean up uploaded files:", error);
  }
};
