import { HajjBookingStatus, HajjPackageType } from "../../../generated/prisma/enums.js";

/// One-way lifecycle. CANCELLED and COMPLETED are final.
export const HAJJ_BOOKING_TRANSITIONS: Record<HajjBookingStatus, HajjBookingStatus[]> = {
  RESERVED: [HajjBookingStatus.CONFIRMED, HajjBookingStatus.CANCELLED],
  CONFIRMED: [HajjBookingStatus.COMPLETED, HajjBookingStatus.CANCELLED],
  CANCELLED: [],
  COMPLETED: [],
};

const BASE_DOCUMENTS = [
  "Passport Copy",
  "Photo",
  "Vaccination Certificate",
  "Mahram Certificate (if applicable)",
  "Medical Fitness Certificate",
];

/// Hajj needs two papers Umrah does not.
const TYPE_EXTRA_DOCUMENTS: Partial<Record<HajjPackageType, string[]>> = {
  HAJJ: ["Hajj Visa Copy", "Ihram Preparation Confirmation"],
};

export const getHajjDocumentPreset = (packageType: HajjPackageType) => [
  ...BASE_DOCUMENTS,
  ...(TYPE_EXTRA_DOCUMENTS[packageType] ?? []),
];

export const hajjBookingSearchableFields = [
  "pilgrimName",
  "passportNumber",
  "munajjimNumber",
  "customer.name",
  "customer.phone",
  "hajjPackage.name",
  "batch.name",
];

export const hajjBookingFilterableFields = [
  "status",
  "customerId",
  "packageId",
  "batchId",
  "makkahRoomId",
  "madinahRoomId",
];
