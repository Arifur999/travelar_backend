import { VisaStatus } from "../../../generated/prisma/enums.js";

/// One-way lifecycle. REJECTED and DELIVERED are final.
export const VISA_TRANSITIONS: Record<VisaStatus, VisaStatus[]> = {
  SUBMITTED: [VisaStatus.PROCESSING],
  PROCESSING: [VisaStatus.APPROVED, VisaStatus.REJECTED],
  APPROVED: [VisaStatus.DELIVERED],
  REJECTED: [],
  DELIVERED: [],
};

/// Seeded onto a new case from its visa type. Changing the type later does not
/// re-seed — the agency has usually started collecting papers by then.
export const VISA_DOCUMENT_PRESETS: Record<string, string[]> = {
  tourist: ["Passport Copy", "Photo", "Bank Statement", "Hotel Booking", "Air Ticket"],
  work: ["Passport Copy", "Photo", "Work Permit", "Employment Contract", "Medical Certificate"],
  student: ["Passport Copy", "Photo", "Admission Letter", "Bank Statement", "Academic Transcripts"],
  business: ["Passport Copy", "Photo", "Invitation Letter", "Company Trade License", "Bank Statement"],
  umrah: ["Passport Copy", "Photo", "Vaccination Certificate", "Mahram Certificate (if applicable)"],
  other: ["Passport Copy", "Photo"],
};

export const visaSearchableFields = [
  "country",
  "visaType",
  "applicationNo",
  "customer.name",
  "customer.phone",
  "visaAgent.name",
];

export const visaFilterableFields = [
  "status",
  "customerId",
  "visaAgentId",
  "country",
  "visaType",
  "submittedAt",
];
