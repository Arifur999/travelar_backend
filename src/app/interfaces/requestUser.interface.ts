import { Role } from "../../generated/prisma/enums.js";

export interface IRequestUser {
  userId: string;
  role: Role;
  email: string;
  /// Null only for SUPER_ADMIN, who operates above any single tenant.
  agencyId: string | null;
}
