export const teamSearchableFields = ["name", "email"];

export const teamFilterableFields = ["role", "status"];

/**
 * What a teammate row exposes. Password hashes live on `accounts`, not here,
 * but listing columns explicitly still keeps better-auth internals (image,
 * emailVerified) and the soft-delete bookkeeping out of the response.
 */
export const teamMemberSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  status: true,
  needPasswordChange: true,
  createdAt: true,
  updatedAt: true,
} as const;
