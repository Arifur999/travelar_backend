export interface IUpdateAgencyProfilePayload {
  name?: string;
  /** Null clears the column; undefined leaves it alone. */
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  logo?: string | null;
}
