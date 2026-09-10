import { v2 as cloudinary, UploadApiResponse } from "cloudinary";
import status from "http-status";
import AppError from "../app/errorHelpers/AppError.js";
import { env } from "./env.js";

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
});

export const uploadToCloudinary = cloudinary;

/** Buffer upload, for files we generate ourselves (PDF invoices). */
export const uploadFileToCloudinary = (buffer: Buffer, fileName: string): Promise<UploadApiResponse> =>
  new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(
        { resource_type: "auto", public_id: fileName, folder: "travelar/generated" },
        (error, result) => {
          if (error || !result) {
            return reject(new AppError(status.INTERNAL_SERVER_ERROR, "Failed to upload file to cloudinary"));
          }
          resolve(result);
        },
      )
      .end(buffer);
  });

export const deleteFileFromCloudinary = async (url: string) => {
  try {
    const match = url.match(/\/v\d+\/(.+?)(?:\.[a-zA-Z0-9]+)+$/);
    const publicId = match?.[1];
    if (!publicId) return;
    await cloudinary.uploader.destroy(publicId);
  } catch (error) {
    console.error("Failed to delete file from cloudinary:", error);
  }
};
