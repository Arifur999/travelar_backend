import { Role } from "../../../generated/prisma/enums.js";

/** Only the two tenant roles can be handed out from inside an agency. */
export type TeamRole = typeof Role.AGENCY_ADMIN | typeof Role.AGENCY_STAFF;

export interface ICreateMemberPayload {
  name: string;
  email: string;
  /** A temporary password — the member is forced to change it on first login. */
  password: string;
  role?: TeamRole;
}

export interface IUpdateMemberPayload {
  name?: string;
  role?: TeamRole;
}

export interface IUpdateMemberStatusPayload {
  status: "ACTIVE" | "BLOCKED";
}

export interface IResetMemberPasswordPayload {
  newPassword: string;
}
